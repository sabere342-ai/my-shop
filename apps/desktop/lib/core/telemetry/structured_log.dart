/// Structured, redacted client logging — Master Plan §38.28.3.
///
/// §38.28.3 is one sentence with three teeth: logs are **structured**
/// (JSON, both sides), **redacted by construction** (never a token, a
/// password, a session, or a biometric; payload bodies are referenced by
/// `mutation_id`, not copied), and **bounded** (a sync diagnostic is a class,
/// not a message).
///
/// The server already enforces this with an allow-list (`logPayload` over
/// `LOGGABLE_KEYS`). The client cannot reach that code — it is Dart — so this
/// module is the client's mirror of the same control, and it is deliberately
/// the *only* place the client builds a record:
///
/// 1. **Allow-list, not denylist.** [allowlistLogFields] copies only the keys
///    named in [allowedLogKeys]. A field nobody named cannot be logged, so a
///    future call site that passes a whole payload fails closed rather than
///    leaking. Redacting a known secret is a list that is one field behind; an
///    allow-list is bounded by construction.
/// 2. **Per-key value policy.** An allow-listed *key* is not a guarantee about
///    its *value*: a key named `reason` can still carry a credential if a call
///    site passes one. [validatedLogField] classifies each key — an identifier
///    is validated as a §38.28.1 id, a diagnostic must be a member of a closed
///    vocabulary, and a count/status/duration/flag must carry its own Dart
///    type — so an arbitrary string cannot be stored under a "classification".
///    The policy itself lives in `telemetry_policy.dart`.
/// 3. **Scalars only.** A value that is not a `String`, `num`, or `bool` is
///    dropped entirely. A `Map` or `List` — the shape a payload has — never
///    reaches a sink, so "logged by reference" is structural and not a
///    convention about how a call site formats its arguments.
/// 4. **Bounded strings.** A string longer than [maxLogStringLength] or
///    carrying a control character is dropped: an unbounded string is how a
///    payload fragment or an injected newline reaches a log line.
/// 5. **Closed event vocabulary.** [TelemetryLogger.log] refuses an event name
///    that is not one of [SyncLogEvents]. A free-form event is a second channel
///    for a message; the set is closed so a name is added in review.
/// 6. **Failure isolation.** A sink, or the clock, that throws is swallowed.
///    Telemetry is passive evidence (§38.28): it must never turn a committed
///    sale or a completed sync pass into a failure, so a broken sink loses a
///    record rather than the business write that produced it.
library;

import 'package:my_shop_desktop/core/telemetry/correlation.dart';
import 'package:my_shop_desktop/core/telemetry/telemetry_policy.dart';

/// The longest scalar string [allowlistLogFields] will emit.
///
/// A correlation id is already bounded by [maxCorrelationIdLength]; this is the
/// ceiling for every other scalar, so a diagnostic can describe *what happened*
/// but can never smuggle a payload fragment through a field name that was
/// allow-listed for something else.
const int maxLogStringLength = 200;

/// Field names a client telemetry record may carry.
///
/// This is the client mirror of the server's `LOGGABLE_KEYS` (§38.28.3): the
/// §38.28.1 correlation ids plus a short, low-cardinality operational
/// vocabulary. It deliberately holds no credential-shaped name — see the
/// adversarial suite that asserts a secret under an allow-listed key still
/// cannot be logged as a non-scalar.
abstract final class LoggableKeys {
  // §38.28.1 correlation ids.
  static const String traceId = 'traceId';
  static const String mutationId = 'mutationId';
  static const String deviceId = 'deviceId';
  static const String syncBatchId = 'syncBatchId';
  static const String organizationId = 'organizationId';
  static const String userId = 'userId';

  // Bounded, low-cardinality diagnostics.
  static const String component = 'component';
  static const String errorClass = 'errorClass';
  static const String errorCode = 'errorCode';
  static const String reason = 'reason';
  static const String state = 'state';
  static const String outcome = 'outcome';
  static const String fault = 'fault';
  static const String operation = 'operation';
  static const String failureKind = 'failureKind';
  static const String kind = 'kind';
  static const String statusCode = 'statusCode';
  static const String attemptCount = 'attemptCount';
  static const String durationMs = 'durationMs';
  static const String recovered = 'recovered';
  static const String promoted = 'promoted';
  static const String attempted = 'attempted';
  static const String applied = 'applied';
  static const String replayed = 'replayed';
  static const String rejected = 'rejected';
  static const String contradicted = 'contradicted';
  static const String retryable = 'retryable';
  static const String requeued = 'requeued';
}

/// Every key [allowlistLogFields] will copy, as one ordered list.
///
/// Ordered so a record's field order is stable across runs (and therefore a
/// golden or a snapshot comparison is meaningful). Adding a key here is the
/// reviewable act §38.28.3 wants.
const List<String> allowedLogKeys = <String>[
  LoggableKeys.traceId,
  LoggableKeys.mutationId,
  LoggableKeys.deviceId,
  LoggableKeys.syncBatchId,
  LoggableKeys.organizationId,
  LoggableKeys.userId,
  LoggableKeys.component,
  LoggableKeys.errorClass,
  LoggableKeys.errorCode,
  LoggableKeys.reason,
  LoggableKeys.state,
  LoggableKeys.outcome,
  LoggableKeys.fault,
  LoggableKeys.operation,
  LoggableKeys.failureKind,
  LoggableKeys.kind,
  LoggableKeys.statusCode,
  LoggableKeys.attemptCount,
  LoggableKeys.durationMs,
  LoggableKeys.recovered,
  LoggableKeys.promoted,
  LoggableKeys.attempted,
  LoggableKeys.applied,
  LoggableKeys.replayed,
  LoggableKeys.rejected,
  LoggableKeys.contradicted,
  LoggableKeys.retryable,
  LoggableKeys.requeued,
];

/// Returns [value] only when it is a bounded scalar safe to log, else `null`.
///
/// `String`, `num`, and `bool` survive. Everything else — a `Map`, a `List`, a
/// `DateTime`, a record, a function, `null` — is dropped. A `double` that is
/// `NaN` or infinite is dropped: it cannot be serialised to valid JSON.
Object? loggableScalar(Object? value) {
  if (value is String) {
    if (value.length > maxLogStringLength) return null;
    for (final int unit in value.codeUnits) {
      // A control character (including a newline) lets a value forge a log
      // line boundary, so the whole value is refused rather than escaped.
      if (unit < 0x20 || unit == 0x7f) return null;
    }
    return value;
  }
  if (value is bool) return value;
  if (value is int) return value;
  if (value is double) {
    if (value.isNaN || value.isInfinite) return null;
    return value;
  }
  return null;
}

/// Returns [value] only when it is a safe value for the allow-listed [key].
///
/// The generic scalar gate ([loggableScalar]) runs first, so a `Map`, an
/// over-long string, or a non-finite `double` is refused before the key is
/// considered. The key then picks exactly one rule from `telemetry_policy.dart`:
///
/// * a §38.28.1 identifier must satisfy [isSafeCorrelationId];
/// * a diagnostic (`component`, `reason`, `state`, `outcome`, `fault`,
///   `operation`, `failureKind`) must be a member of its closed vocabulary, so
///   an exception message can never be recorded as a "reason";
/// * `errorClass` and `errorCode` are bounded tokens (they are populated only
///   by [errorClassOf] and by contract codes);
/// * a count or a status must be a non-negative `int`, and a duration must be a
///   finite non-negative `num`.
///
/// A key the policy does not name is refused, so a future key added to
/// [allowedLogKeys] without a value rule fails closed.
Object? validatedLogField(String key, Object? value) {
  final Object? scalar = loggableScalar(value);
  if (scalar == null) return null;
  switch (key) {
    case LoggableKeys.traceId:
    case LoggableKeys.mutationId:
    case LoggableKeys.deviceId:
    case LoggableKeys.syncBatchId:
    case LoggableKeys.organizationId:
    case LoggableKeys.userId:
      return isSafeCorrelationId(scalar) ? scalar : null;
    case LoggableKeys.component:
      return closedVocabularyValue(scalar, logComponentNames);
    case LoggableKeys.reason:
      return closedVocabularyValue(scalar, logReasonNames);
    case LoggableKeys.state:
      return closedVocabularyValue(scalar, syncStateNames);
    case LoggableKeys.outcome:
      return closedVocabularyValue(scalar, mutationOutcomeNames);
    case LoggableKeys.fault:
      return closedVocabularyValue(scalar, pushRunFaultNames);
    case LoggableKeys.operation:
      return closedVocabularyValue(scalar, operationNames);
    case LoggableKeys.failureKind:
      return closedVocabularyValue(scalar, reachabilityFailureKindNames);
    case LoggableKeys.errorClass:
    case LoggableKeys.kind:
      return boundedTokenValue(scalar, classTokenPattern);
    case LoggableKeys.errorCode:
      return boundedTokenValue(scalar, upperCodePattern);
    case LoggableKeys.statusCode:
    case LoggableKeys.attemptCount:
      return nonNegativeIntValue(scalar);
    case LoggableKeys.durationMs:
      return finiteNonNegativeNumberValue(scalar);
    case LoggableKeys.recovered:
    case LoggableKeys.promoted:
    case LoggableKeys.attempted:
    case LoggableKeys.applied:
    case LoggableKeys.replayed:
    case LoggableKeys.rejected:
    case LoggableKeys.contradicted:
    case LoggableKeys.retryable:
    case LoggableKeys.requeued:
      return nonNegativeIntValue(scalar);
    default:
      return null;
  }
}

/// Copies only allow-listed keys whose value satisfies [validatedLogField].
///
/// @param candidate Untrusted shape. May hold a payload, a session, anything.
/// @returns A fresh map holding only keys named in [allowedLogKeys] whose
///   values survived both the scalar gate and the per-key value policy.
Map<String, Object?> allowlistLogFields(Map<String, Object?> candidate) {
  final Map<String, Object?> safe = <String, Object?>{};
  for (final String key in allowedLogKeys) {
    if (!candidate.containsKey(key)) continue;
    final Object? value = validatedLogField(key, candidate[key]);
    if (value != null) safe[key] = value;
  }
  return safe;
}

/// One already-redacted structured record.
class TelemetryRecord {
  const TelemetryRecord({
    required this.event,
    required this.timestamp,
    required this.fields,
  });

  /// A stable event name (a modifier-style dotted token, e.g. `sync.push.pass`).
  final String event;

  /// When the record was produced, on the injected clock.
  final DateTime timestamp;

  /// The allow-listed fields. Already filtered by [allowlistLogFields].
  final Map<String, Object?> fields;

  @override
  String toString() => 'TelemetryRecord($event, $fields)';
}

/// Where a redacted [TelemetryRecord] goes.
///
/// A sink is a plain port so the wire format (a JSON line, a Windows event log,
/// a test list) is chosen by the composition root, not by the sync engine.
abstract interface class TelemetrySink {
  /// Writes one record. A sink may throw; the caller isolates the failure.
  void write(TelemetryRecord record);
}

/// The client's structured logger: allow-lists, then writes, then isolates.
///
/// A [TelemetryLogger] is the object a sync seam receives. Holding one is
/// equivalent to holding a log — never a source of truth — so a caller may pass
/// `null` and lose observability rather than correctness.
class TelemetryLogger {
  TelemetryLogger({required this.sink, DateTime Function()? clock})
      : _clock = clock ?? DateTime.now;

  /// The destination. A production composition root wires a JSON-line sink.
  final TelemetrySink sink;

  final DateTime Function() _clock;

  /// Records [event] with [fields], redacted by construction.
  ///
  /// An event name outside [SyncLogEvents] is refused: a free-form event is a
  /// second channel for a message, so the vocabulary is closed.
  ///
  /// Failure isolated end to end: the clock read, the field validation, the
  /// record construction, and the sink write are all inside one guard, so a
  /// throwing clock, a defect in the policy, or a broken sink loses a record
  /// rather than escaping into the business or sync path that produced it.
  void log(String event, {Map<String, Object?> fields = const <String, Object?>{}}) {
    try {
      if (!isKnownLogEvent(event)) return;
      final TelemetryRecord record = TelemetryRecord(
        event: event,
        timestamp: _clock(),
        fields: allowlistLogFields(fields),
      );
      sink.write(record);
    } on Object {
      return;
    }
  }
}

/// The event names the offline path emits, as one reviewable vocabulary.
///
/// A dotted token rather than a sentence: an aggregator groups by event, and a
/// stable name is what a dashboard or an alert binds to.
abstract final class SyncLogEvents {
  /// One completed push pass (including an idle pass).
  static const String pushPass = 'sync.push.pass';

  /// A whole-batch failure, classified by §38.10.4.
  static const String pushBatchFailure = 'sync.push.batch_failure';

  /// One mutation the server permanently refused (payload logged by reference).
  static const String pushMutationRejected = 'sync.push.mutation.rejected';

  /// One §38.9.2 idempotency-bypass alarm (payload logged by reference).
  static const String pushMutationContradiction = 'sync.push.mutation.contradiction';

  /// An unexpected (non-[SyncPushTransportException]) throw from the transport.
  static const String pushTransportUnexpected = 'sync.push.transport.unexpected';

  /// The scheduler's own pass failed unexpectedly.
  static const String schedulerError = 'sync.scheduler.error';

  /// The connectivity probe threw unexpectedly.
  static const String connectivityProbeUnexpected = 'sync.connectivity.probe.unexpected';

  /// The HTTP health probe threw unexpectedly.
  static const String healthProbeError = 'sync.connectivity.health_probe.error';

  /// A §38.16.5 forward clock jump — a recorded local security event.
  static const String clockTamper = 'sync.security.clock_tamper';

  /// Every event name above, as one closed set.
  ///
  /// A new event is added here in review; an unlisted name is refused by
  /// [TelemetryLogger.log] and by the JSON sinks.
  static const Set<String> all = <String>{
    pushPass,
    pushBatchFailure,
    pushMutationRejected,
    pushMutationContradiction,
    pushTransportUnexpected,
    schedulerError,
    connectivityProbeUnexpected,
    healthProbeError,
    clockTamper,
  };
}

/// True when [event] is one of the closed [SyncLogEvents] names.
bool isKnownLogEvent(String event) => SyncLogEvents.all.contains(event);
