/// Connectivity monitor — Master Plan §40.5 C1, C2.
///
/// A pure state machine that classifies backend reachability: it neither owns
/// timers nor sync, so it is fully testable with fakes. The monitor:
///
/// * Maps a [ConnectivityProbe] result and [ConnectivityEvidence] from a sync
///   pass into a single [ConnectivitySnapshot].
/// * Enforces a minimum time between probes ([successFreshness]) to avoid
///   traffic storms while idle.
/// * Tracks consecutive failures to drive a probe backoff ladder (via
///   [BackoffPolicy]) and honours a `Retry-After` supplied by the probe.
/// * Coalesces concurrent `checkNow` calls (single-flight).
/// * Avoids duplicate snapshot emissions.
/// * Distinguishes `unknown`, `recovering`, `reachable`, `degraded`, and
///   `unreachable` exactly as the vocabulary requires.
/// * Exposes `timeUntilNextProbe` and keeps the verdict usable for gating sync
///   ([BackendConnectivity.mayAttemptSync], [ConnectivitySnapshot.mayAttemptSync]).
///
/// A device with no probe yet is `unknown`. A probe in flight that was
/// previously non-reachable is `recovering`. A successful probe or a sync
/// acknowledgement produces `reachable`; a `5xx` produces `degraded`; transport
/// failures produce `unreachable` (§40.5).
library;

import 'dart:async';
import 'dart:math';

import 'package:my_shop_desktop/core/offline/connectivity/connectivity_probe.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_state.dart';
import 'package:my_shop_desktop/core/offline/sync/backoff_policy.dart';
import 'package:my_shop_desktop/core/telemetry/error_class.dart';
import 'package:my_shop_desktop/core/telemetry/structured_log.dart';

/// Monitors backend reachability from probe results and sync evidence.
class ConnectivityMonitor {
  ConnectivityMonitor({
    required this.probe,
    this.probeBackoff = const BackoffPolicy(
      baseDelay: Duration(seconds: 5),
      maxDelay: Duration(minutes: 5),
      jitterFraction: 0.25,
    ),
    this.successFreshness = const Duration(minutes: 1),
    this.clock = DateTime.now,
    this.random,
    this.logger,
  });

  final ConnectivityProbe probe;
  final BackoffPolicy probeBackoff;
  final Duration successFreshness;
  final DateTime Function() clock;
  final Random? random;

  /// Structured, redacted diagnostics (§38.28.3). Passive evidence only: a
  /// probe classification is never derived from it.
  final TelemetryLogger? logger;

  ConnectivitySnapshot _snapshot = ConnectivitySnapshot.initial;
  ConnectivitySnapshot? _lastEmitted;
  final StreamController<ConnectivitySnapshot> _changes =
      StreamController<ConnectivitySnapshot>.broadcast();
  bool _disposed = false;
  bool _probeInFlight = false;
  int _consecutiveFailures = 0;
  DateTime? _lastVerifiedAt;
  ReachabilityFailureKind? _lastFailureKind;
  DateTime? _lastFailureAt;
  DateTime? _nextProbeAt;
  BackendConnectivity _connectivity = BackendConnectivity.unknown;
  Future<ConnectivitySnapshot>? _probeFuture;

  /// Current connectivity snapshot.
  ConnectivitySnapshot get snapshot => _snapshot;

  /// Stream of snapshot changes (no duplicate consecutive emissions).
  Stream<ConnectivitySnapshot> get changes => _changes.stream;

  /// Whether a probe is currently in flight.
  bool get probeInFlight => _probeInFlight;

  /// The absolute time the next probe is eligible, if any. `null` before the
  /// first probe (or when a probe is in flight).
  DateTime? get nextProbeAt => _nextProbeAt;

  /// Seconds/minutes until the next probe: `Duration.zero` if a probe is due
  /// now, or if a probe is in flight (the caller should coalesce). Returns
  /// `Duration.zero` when no [nextProbeAt] has been set (first probe due).
  Duration get timeUntilNextProbe {
    if (_probeInFlight) return Duration.zero;
    final DateTime? at = _nextProbeAt;
    if (at == null) return Duration.zero;
    final Duration d = at.difference(clock());
    return d.isNegative ? Duration.zero : d;
  }

  /// Runs a probe, coalescing concurrent calls. If [force] is false and a probe
  /// ran recently, the cached [snapshot] is returned.
  Future<ConnectivitySnapshot> checkNow({bool force = false}) async {
    _assertNotDisposed();
    final Future<ConnectivitySnapshot>? inFlight = _probeFuture;
    if (inFlight != null) return inFlight;
    if (!force && !_isProbeDue()) return _snapshot;
    final Future<ConnectivitySnapshot> run = _runProbe();
    _probeFuture = run;
    try {
      final ConnectivitySnapshot result = await run;
      return result;
    } finally {
      if (identical(_probeFuture, run)) _probeFuture = null;
    }
  }

  /// Records evidence from a completed sync pass, updating the verdict without
  /// necessarily starting a probe (§40.5).
  void recordEvidence(
    ConnectivityEvidence evidence, {
    ReachabilityFailureKind? failureKind,
  }) {
    _assertNotDisposed();
    final DateTime now = clock();
    switch (evidence) {
      case ConnectivityEvidence.reachable:
        _connectivity = BackendConnectivity.reachable;
        _lastVerifiedAt = now;
        _consecutiveFailures = 0;
        _lastFailureKind = null;
        _lastFailureAt = null;
        _nextProbeAt = now.add(successFreshness);
        _probeInFlight = false;
        _emit();
        return;
      case ConnectivityEvidence.degraded:
        final ReachabilityFailureKind kind =
            failureKind ?? ReachabilityFailureKind.serverError;
        _connectivity = BackendConnectivity.degraded;
        _consecutiveFailures++;
        _lastFailureKind = kind;
        _lastFailureAt = now;
        _nextProbeAt = now.add(
          probeBackoff.delayFor(_consecutiveFailures, random: random),
        );
        _probeInFlight = false;
        _emit();
        return;
      case ConnectivityEvidence.unreachable:
        final ReachabilityFailureKind kind =
            failureKind ?? ReachabilityFailureKind.network;
        _connectivity = BackendConnectivity.unreachable;
        _consecutiveFailures++;
        _lastFailureKind = kind;
        _lastFailureAt = now;
        _nextProbeAt = now.add(
          probeBackoff.delayFor(_consecutiveFailures, random: random),
        );
        _probeInFlight = false;
        _emit();
        return;
    }
  }

  /// Disposes the monitor and closes its stream.
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    if (!_changes.isClosed) _changes.close();
  }

  bool _isProbeDue() {
    final DateTime? at = _nextProbeAt;
    if (at == null) return true;
    return !clock().isBefore(at);
  }

  Future<ConnectivitySnapshot> _runProbe() async {
    _assertNotDisposed();
    final DateTime now = clock();
    _probeInFlight = true;
    if (_connectivity != BackendConnectivity.reachable) {
      _connectivity = BackendConnectivity.recovering;
    }
    _emit();
    try {
      final ProbeResult result = await probe.probe();
      if (_disposed) {
        _probeInFlight = false;
        return _snapshot;
      }
      _applyProbeResult(result, now);
      _emit();
      return _snapshot;
    } on Object catch (error) {
      logger?.log(
        SyncLogEvents.connectivityProbeUnexpected,
        fields: <String, Object?>{
          LoggableKeys.component: 'connectivity_monitor',
          LoggableKeys.errorClass: errorClassOf(error),
        },
      );
      if (_disposed) {
        _probeInFlight = false;
        return _snapshot;
      }
      _applyProbeError(ReachabilityFailureKind.unknown, now);
      _emit();
      return _snapshot;
    }
  }

  void _applyProbeResult(ProbeResult result, DateTime now) {
    _probeInFlight = false;
    switch (result.classification) {
      case ProbeClassification.reachable:
        _connectivity = BackendConnectivity.reachable;
        _lastVerifiedAt = now;
        _consecutiveFailures = 0;
        _lastFailureKind = null;
        _lastFailureAt = null;
        _nextProbeAt = now.add(successFreshness);
        _rebuildSnapshot();
        return;
      case ProbeClassification.degraded:
        final ReachabilityFailureKind kind =
            result.failureKind ?? ReachabilityFailureKind.serverError;
        _connectivity = BackendConnectivity.degraded;
        _consecutiveFailures++;
        _lastFailureKind = kind;
        _lastFailureAt = now;
        final Duration delay = _probeDelay(
          _consecutiveFailures,
          result.retryAfter,
        );
        _nextProbeAt = now.add(delay);
        _rebuildSnapshot();
        return;
      case ProbeClassification.unreachable:
        final ReachabilityFailureKind kind =
            result.failureKind ?? ReachabilityFailureKind.unknown;
        _connectivity = BackendConnectivity.unreachable;
        _consecutiveFailures++;
        _lastFailureKind = kind;
        _lastFailureAt = now;
        final Duration delay = _probeDelay(
          _consecutiveFailures,
          result.retryAfter,
        );
        _nextProbeAt = now.add(delay);
        _rebuildSnapshot();
        return;
    }
  }

  void _applyProbeError(ReachabilityFailureKind kind, DateTime now) {
    _probeInFlight = false;
    _connectivity = BackendConnectivity.unreachable;
    _consecutiveFailures++;
    _lastFailureKind = kind;
    _lastFailureAt = now;
    final Duration delay = probeBackoff.delayFor(
      _consecutiveFailures,
      random: random,
    );
    _nextProbeAt = now.add(delay);
    _rebuildSnapshot();
  }

  Duration _probeDelay(int attempt, Duration? serverDirective) {
    final Duration local = probeBackoff.delayFor(attempt, random: random);
    if (serverDirective == null) return local;
    if (serverDirective > local) return serverDirective;
    return local;
  }

  void _rebuildSnapshot() {
    _snapshot = ConnectivitySnapshot(
      connectivity: _connectivity,
      probeInFlight: _probeInFlight,
      lastVerifiedAt: _lastVerifiedAt,
      lastFailureKind: _lastFailureKind,
      lastFailureAt: _lastFailureAt,
      consecutiveFailures: _consecutiveFailures,
      nextProbeAt: _nextProbeAt,
    );
  }

  void _emit() {
    _rebuildSnapshot();
    if (_disposed) return;
    if (_lastEmitted != null && _lastEmitted == _snapshot) return;
    _lastEmitted = _snapshot;
    if (!_changes.isClosed) _changes.add(_snapshot);
  }

  void _assertNotDisposed() {
    if (_disposed) {
      throw StateError('ConnectivityMonitor has been disposed');
    }
  }
}
