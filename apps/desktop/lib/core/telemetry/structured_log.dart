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
/// 2. **Scalars only.** A value that is not a `String`, `num`, or `bool` is
///    dropped entirely. A `Map` or `List` — the shape a payload has — never
///    reaches a sink, so "logged by reference" is structural and not a
///    convention about how a call site formats its arguments.
/// 3. **Bounded strings.** A string longer than [maxLogStringLength] or
///    carrying a control character is dropped: an unbounded string is how a
///    payload fragment or an injected newline reaches a log line.
/// 4. **Failure isolation.** A sink that throws is swallowed. Telemetry is
///    passive evidence (§38.28): it must never turn a committed sale or a
///    completed sync pass into a failure, so a broken sink loses a record
///    rather than the business write that produced it.
library;

import 'package:my_shop_desktop/core/telemetry/correlation.dart';

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

/// Copies only allow-listed, bounded scalars from [candidate].
///
/// @param candidate Untrusted shape. May hold a payload, a session, anything.
/// @returns A fresh map holding only keys named in [allowedLogKeys] whose
///   values survived [loggableScalar].
Map<String, Object?> allowlistLogFields(Map<String, Object?> candidate) {
  final Map<String, Object?> safe = <String, Object?>{};
  for (final String key in allowedLogKeys) {
    if (!candidate.containsKey(key)) continue;
    final Object? scalar = loggableScalar(candidate[key]);
    if (scalar != null) safe[key] = scalar;
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
  /// Failure isolated: a throwing sink is swallowed with `return;` so telemetry
  /// can never break the business or sync path that produced the record.
  void log(String event, {Map<String, Object?> fields = const <String, Object?>{}}) {
    if (event.isEmpty) return;
    final TelemetryRecord record = TelemetryRecord(
      event: event,
      timestamp: _clock(),
      fields: allowlistLogFields(fields),
    );
    try {
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
}
