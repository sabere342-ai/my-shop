/// The connectivity vocabulary — Master Plan §40.5 (M1b-S9), §38.26 T-O9/T-O22,
/// §38.10.4.
///
/// §40.5 gives M1b-S9 two jobs: **online/offline detection** and the **retry
/// ladder**. This file is the first half: a typed, testable statement of what
/// the client knows about reaching the configured backend, so the scheduler can
/// decide whether to attempt work and a later UI slice can render an offline
/// indicator without inferring anything from a raw socket.
///
/// Three boundaries are deliberate:
///
/// * **A network interface is not a backend.** The vocabulary never says "the
///   device has Wi-Fi"; it says whether *this* backend answered. A device on a
///   captive portal, or on a working internet connection that cannot reach the
///   configured service, is `unreachable` (§40.5, §38.26 T-O9).
/// * **`unknown` is explicit.** A fresh process has not verified anything, and
///   guessing "online" would turn an unverified state into a claim. `unknown`
///   is a real value that a probe must move (§40.5).
/// * **A reachable service is not necessarily a healthy one.** `degraded` is
///   the server that answered with a `5xx`: the transport works, the service is
///   temporarily unavailable — which §38.10.4 retries with backoff rather than
///   treating as a disconnection.
///
/// Nothing here carries a credential, a token, a header, or a payload: the
/// snapshot is deliberately a small classification plus timestamps and counts
/// (§38.28.3, §13.7).
library;

/// What the client knows about reaching the configured backend.
///
/// The values are a *lifecycle*, not a boolean: a device that has never checked
/// is not "online", and a device whose probe is mid-flight is not silently
/// assumed to have recovered.
enum BackendConnectivity {
  /// Never verified, or verified so long ago that the verdict was invalidated.
  /// §40.5: the initial state is named rather than guessed.
  unknown,

  /// A re-check is in flight after a non-reachable verdict. This is not a
  /// health claim: it exists so a UI can say "checking" instead of "offline"
  /// while the outcome is genuinely undecided.
  recovering,

  /// The backend answered a probe (or acknowledged a sync pass). This is the
  /// only state in which the service is verifiably reachable.
  reachable,

  /// The backend answered but with a server error (`5xx`): reachable transport,
  /// temporarily unavailable service. §38.10.4 backs off and retries.
  degraded,

  /// The backend could not be reached: DNS failure, timeout, refused or
  /// unreachable network, or a transport that answered something other than
  /// this service's contract.
  unreachable;

  /// True when the backend is verifiably responding, healthy or not.
  bool get isReachable => this == reachable || this == degraded;

  /// Whether a sync attempt may be started in this state.
  ///
  /// `unknown` is optimistic: a fresh process may attempt a pass, because the
  /// outbox is durable and a failed attempt is safe (§38.9.3). A failed attempt
  /// then produces real evidence and the state stops being unknown. `recovering`
  /// is pessimistic: a verdict is already in flight, so waiting for it is
  /// cheaper than a second doomed request.
  bool get mayAttemptSync =>
      this == reachable || this == degraded || this == unknown;
}

/// Why a reachability check or a sync attempt concluded the backend was not
/// reachable. This is a diagnostic classification, never a message: it names a
/// failure class, not a host, a URL, or a payload (§38.28.3).
enum ReachabilityFailureKind {
  /// Name resolution failed (§38.10.4 "DNS failure").
  dns,

  /// The request exceeded its bound (§38.10.4 "timeout").
  timeout,

  /// The host was reached but refused the connection.
  connectionRefused,

  /// No route to the host: an interface is up but the network is not usable.
  networkUnreachable,

  /// TLS/starttls negotiation failed, so the service was never spoken to.
  tls,

  /// Something answered, but not with this service's contract — a captive
  /// portal or an interception proxy is the canonical case (§40.5).
  unexpectedResponse,

  /// The service answered with a server error (`5xx`): reachable but unhealthy.
  serverError,

  /// The sync transport classified a whole-request failure as a network-class
  /// failure without an HTTP status (§38.10.4). Ambiguous by nature.
  network,

  /// A failure the client can classify no further. Retried like a network
  /// failure because doing nothing would silently stall the queue.
  unknown,
}

/// The evidence a completed sync pass gives the monitor, independent of a probe.
///
/// A sync attempt *is* a reachability test: a `200` proves the backend is up, a
/// `5xx` proves it is up but unhealthy, and a transport failure with no status
/// proves it was not reached. Feeding that back keeps the connectivity verdict
/// honest without spending a second request (§40.5 "no busy-loop", §38.28).
enum ConnectivityEvidence {
  /// The backend answered, or acknowledged the pass.
  reachable,

  /// The backend answered with a server error (`5xx`).
  degraded,

  /// The backend was not reached (network/DNS/timeout class).
  unreachable,
}

/// An immutable view of the connectivity state for the scheduler and a future
/// offline indicator (§40.5 C2).
///
/// It exposes exactly what §40.5 asks a presentation layer to know: the
/// classification, the most recent successful verification, the last failure
/// class, the next eligible probe, and whether a sync attempt is permitted.
class ConnectivitySnapshot {
  const ConnectivitySnapshot({
    required this.connectivity,
    required this.probeInFlight,
    this.lastVerifiedAt,
    this.lastFailureKind,
    this.lastFailureAt,
    this.consecutiveFailures = 0,
    this.nextProbeAt,
  });

  /// The initial state of a process that has verified nothing.
  static const ConnectivitySnapshot initial = ConnectivitySnapshot(
    connectivity: BackendConnectivity.unknown,
    probeInFlight: false,
  );

  /// The current classification.
  final BackendConnectivity connectivity;

  /// True while a probe is running, so a UI can distinguish "checking" from a
  /// settled verdict (see [BackendConnectivity.recovering]).
  final bool probeInFlight;

  /// When the backend was last verified reachable, if ever.
  final DateTime? lastVerifiedAt;

  /// The class of the most recent failure, if any. Retained across a later
  /// success so a dashboard can show what went wrong (§40.5 C2).
  final ReachabilityFailureKind? lastFailureKind;

  /// When the most recent failure was observed, if any.
  final DateTime? lastFailureAt;

  /// Consecutive failures since the last success; drives the probe ladder.
  final int consecutiveFailures;

  /// When the next probe is eligible. `null` only before the first probe.
  final DateTime? nextProbeAt;

  /// True when the backend is verifiably responding (healthy or degraded).
  bool get isReachable => connectivity.isReachable;

  /// Whether the scheduler may attempt a sync pass in this state.
  bool get mayAttemptSync => connectivity.mayAttemptSync;

  /// True when local work is queued while the backend is unreachable — the
  /// "continuing offline" condition a UI reports (§40.5 C7).
  bool get isOffline => connectivity == BackendConnectivity.unreachable;

  @override
  bool operator ==(Object other) {
    return other is ConnectivitySnapshot &&
        other.connectivity == connectivity &&
        other.probeInFlight == probeInFlight &&
        other.lastVerifiedAt == lastVerifiedAt &&
        other.lastFailureKind == lastFailureKind &&
        other.lastFailureAt == lastFailureAt &&
        other.consecutiveFailures == consecutiveFailures &&
        other.nextProbeAt == nextProbeAt;
  }

  @override
  int get hashCode => Object.hash(
    connectivity,
    probeInFlight,
    lastVerifiedAt,
    lastFailureKind,
    lastFailureAt,
    consecutiveFailures,
    nextProbeAt,
  );

  /// A non-secret description: a class name, timestamps and counts only.
  @override
  String toString() =>
      'ConnectivitySnapshot(${connectivity.name}, probeInFlight: $probeInFlight, '
      'lastVerifiedAt: $lastVerifiedAt, lastFailureKind: ${lastFailureKind?.name}, '
      'consecutiveFailures: $consecutiveFailures, nextProbeAt: $nextProbeAt)';
}
