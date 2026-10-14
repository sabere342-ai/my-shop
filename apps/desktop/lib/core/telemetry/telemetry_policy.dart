/// The central client telemetry value policy — Master Plan §38.28.3, §13.1.
///
/// An allow-list of *keys* is not a guarantee about *values*. A key named
/// `reason` or `errorCode` can still carry a credential if the call site passes
/// one: "the key is not credential-shaped" says nothing about what is stored
/// under it. This module is the value half of the control. Every loggable field
/// and every metric label is classified into one of three kinds, and each kind
/// has exactly one rule:
///
/// 1. **Identifiers.** A §38.28.1 correlation id (`trace_id`, `device_id`, …)
///    is validated by [isSafeCorrelationId]: a bounded `[A-Za-z0-9._:-]{1,64}`
///    token. An id that is not safe is dropped, never logged.
/// 2. **Classifications.** A diagnostic field such as `component`, `reason`,
///    `state`, `outcome`, `fault`, `operation`, or `failureKind` carries a
///    *closed* vocabulary value. A value outside the vocabulary is dropped, so
///    an arbitrary exception message can never be recorded as a "reason".
/// 3. **Numeric / boolean.** A count, a status, a duration, or a flag carries
///    its own Dart type. A string in a numeric field is dropped.
///
/// Two classification fields are genuinely open — a Dart runtime class name
/// (`errorClass`) and a server refusal code (`errorCode`) — so they are bounded
/// by a strict identifier pattern rather than a closed set. The residual limit
/// is stated in the slice record rather than hidden: a purely alphanumeric
/// short value that happens to be a valid identifier could still be logged, so
/// these two fields are populated only by [errorClassOf] and by contract codes.
///
/// The policy is deliberately here, in one reviewable place, and consumed by
/// both the record builder ([TelemetryLogger]) and the JSON sinks (defence in
/// depth): a record built by any path, including a direct construction, cannot
/// reach a JSON line with an unsafe value.
library;

/// A bounded Dart class / classification token: a plain identifier up to 64
/// characters, matching what [errorClassOf] emits.
final RegExp classTokenPattern = RegExp(r'^[A-Za-z_][A-Za-z0-9_]{0,63}$');

/// A bounded UPPER_SNAKE code: a §34.3 refusal code or a classification name
/// (`MISSING_OUTCOME`, `IDEMPOTENCY_CONTRADICTION`, …).
final RegExp upperCodePattern = RegExp(r'^[A-Z][A-Z0-9_]{0,63}$');

/// §38.13 sync state names a `state` field or label may carry.
const Set<String> syncStateNames = <String>{
  'LOCAL_ONLY',
  'PENDING',
  'SYNCING',
  'SYNCED',
  'RETRYABLE_ERROR',
  'CONFLICT',
  'PERMANENT_REJECTED',
};

/// §38.9.2 acknowledgement names an `outcome` field or label may carry.
const Set<String> mutationOutcomeNames = <String>{
  'APPLIED',
  'REPLAY',
  'REJECTED',
  'CONTRADICTION',
};

/// §38.10.4 whole-batch fault names a `fault` field may carry.
const Set<String> pushRunFaultNames = <String>{
  'transient',
  'clientTooOld',
  'authenticationRequired',
  'serverUnsupported',
  'permanentBatchRejection',
};

/// Operation names an `operation` field or label may carry.
const Set<String> operationNames = <String>{'PUSH', 'PULL', 'PROBE'};

/// §40.5 reachability failure classes a `failureKind` field or label may carry.
const Set<String> reachabilityFailureKindNames = <String>{
  'dns',
  'timeout',
  'connectionRefused',
  'networkUnreachable',
  'tls',
  'unexpectedResponse',
  'serverError',
  'network',
  'unknown',
};

/// The client components allowed to name themselves in a `component` field.
///
/// A closed set, not a free string: a component name is developer-authored, and
/// a new one is added here in review rather than passed from a call site.
const Set<String> logComponentNames = <String>{
  'sync_scheduler',
  'connectivity_monitor',
  'http_health_probe',
  'offline_grace',
};

/// The reasons allowed in a `reason` field. A closed set, so a diagnostic can
/// never become a channel for a message.
const Set<String> logReasonNames = <String>{'forward_jump'};

/// Returns [value] only when it is a member of [allowed], else `null`.
Object? closedVocabularyValue(Object? value, Set<String> allowed) {
  return value is String && allowed.contains(value) ? value : null;
}

/// Returns [value] only when it is a bounded token matching [pattern].
Object? boundedTokenValue(Object? value, RegExp pattern) {
  return value is String && pattern.hasMatch(value) ? value : null;
}

/// Returns [value] only when it is a non-negative `int`, else `null`.
Object? nonNegativeIntValue(Object? value) {
  return value is int && value >= 0 ? value : null;
}

/// Returns [value] only when it is a finite, non-negative number, else `null`.
///
/// A `NaN` or an infinity cannot be serialised to valid JSON and is refused.
Object? finiteNonNegativeNumberValue(Object? value) {
  if (value is int) return value >= 0 ? value : null;
  if (value is double) {
    if (value.isNaN || value.isInfinite || value.isNegative) return null;
    return value;
  }
  return null;
}
