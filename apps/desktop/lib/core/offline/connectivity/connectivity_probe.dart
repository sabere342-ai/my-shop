/// The connectivity probe port and probe result types — Master Plan §40.5 C1/C2.
///
/// A probe classifies whether the *configured backend* is reachable: a network
/// interface is insufficient; general internet access does not prove the
/// backend is reachable; and DNS failures, timeouts, and transport failures
/// must map to distinct classes (§40.5). This file defines the interface a
/// concrete transport (e.g., Dart `dart:io` `HttpClient` hitting `/healthz`)
/// implements, plus the pure vocabulary the monitor consumes.
///
/// The probe is bounded, cancellable in spirit (bounded by [timeout]), and
/// designed so its result is the only thing the monitor trusts. No credentials,
/// URLs, headers, or response bodies are stored in [ProbeResult] (§38.28.3).
library;

import 'package:my_shop_desktop/core/offline/connectivity/connectivity_state.dart';

/// High-level classification produced by a probe. The monitor maps this to
/// [BackendConnectivity].
enum ProbeClassification {
  /// The backend answered and passes the contract.
  reachable,

  /// The backend answered but is temporarily unavailable (`5xx`).
  degraded,

  /// The backend could not be reached or its answer is not the expected
  /// contract.
  unreachable,
}

/// The outcome of one reachability probe.
class ProbeResult {
  const ProbeResult._({
    required this.classification,
    this.failureKind,
    this.httpStatus,
    this.retryAfter,
  });

  /// The backend answered with a valid liveness contract.
  const ProbeResult.reachable({int? httpStatus, Duration? retryAfter})
    : this._(
        classification: ProbeClassification.reachable,
        httpStatus: httpStatus,
        retryAfter: retryAfter,
      );

  /// The backend answered with a `5xx`.
  const ProbeResult.degraded({int? httpStatus, Duration? retryAfter})
    : this._(
        classification: ProbeClassification.degraded,
        failureKind: ReachabilityFailureKind.serverError,
        httpStatus: httpStatus,
        retryAfter: retryAfter,
      );

  /// The backend was not reached, or the answer failed the contract.
  const ProbeResult.unreachable({
    required ReachabilityFailureKind failureKind,
    int? httpStatus,
    Duration? retryAfter,
  }) : this._(
         classification: ProbeClassification.unreachable,
         failureKind: failureKind,
         httpStatus: httpStatus,
         retryAfter: retryAfter,
       );

  /// High-level verdict.
  final ProbeClassification classification;

  /// Why it was not reachable, when [classification] is `unreachable` or
  /// `degraded`. May be `null` only when [classification] is `reachable`.
  final ReachabilityFailureKind? failureKind;

  /// HTTP status code from the probe, when present.
  final int? httpStatus;

  /// A server-directed probe delay (from `Retry-After`), if the response
  /// supplied one. The monitor compares this against its probe backoff and
  /// honours the larger delay rather than shortening it (§40.5 C4).
  final Duration? retryAfter;

  @override
  bool operator ==(Object other) {
    return other is ProbeResult &&
        other.classification == classification &&
        other.failureKind == failureKind &&
        other.httpStatus == httpStatus &&
        other.retryAfter == retryAfter;
  }

  @override
  int get hashCode =>
      Object.hash(classification, failureKind, httpStatus, retryAfter);

  @override
  String toString() =>
      'ProbeResult(${classification.name}, failureKind: ${failureKind?.name}, '
      'httpStatus: $httpStatus, retryAfter: $retryAfter)';
}

/// A bounded reachability probe to the configured backend.
///
/// Implementations must be safe, bounded, and cancellable in effect: a timeout
/// must return a `unreachable` result (not hang), and per-probe resources
/// (such as an `HttpClient`) must be closed. The monitor does not retain URLs
/// or headers from results, so a concrete implementation must also redact them
/// from its own diagnostics (§38.28.3).
abstract interface class ConnectivityProbe {
  /// Returns the reachability verdict. Bounded by a timeout (injected by the
  /// implementation). This method is not re-entrant by design: a caller (the
  /// monitor) coalesces concurrent calls.
  Future<ProbeResult> probe();
}
