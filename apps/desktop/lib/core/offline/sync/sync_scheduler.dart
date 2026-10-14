/// Connectivity-and-backoff scheduler — Master Plan §40.5 C3, C6, C8, §38.10.4.
///
/// The scheduler orchestrates the single push pass: it drives probes/retries,
/// enforces the server-directed deadline, coalesces concurrent triggers, applies
/// spacing to avoid busy loops, blocks for "client too old" / "unsupported server"
/// (no auto storm), maps sync faults to connectivity evidence, and persists
/// the server `Retry-After` deadline. It reuses the existing S5 infrastructure
/// ([BackoffPolicy], [PushOrchestrator], [OutboxRepository]) and keeps timers
/// injectable for deterministic tests.
///
/// Non-negotiable behaviour (§40.5 C6, I-8):
/// * `Retry-After` honoured (server directive wins; cannot be shortened).
/// * No busy-loop: a minimum [minRunSpacing] applies, backoff ceilings are
///   capped, and blocked states don't self-retry.
/// * No duplicate concurrent sync runs (passes are serialized; re-entrant
///   triggers coalesce).
/// * No skipped retry deadlines (enforced by [RetryDeadlineStore] + timers).
/// * Doesn't wake unnecessarily while idle (no timer when no work).
/// * Authentication does not create request storms (ladder capped).
/// * Client too old / server unsupported preserve records and block auto-retry.
library;

import 'dart:async';
import 'dart:math';

import 'package:my_shop_desktop/core/offline/connectivity/connectivity_monitor.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_state.dart';
import 'package:my_shop_desktop/core/offline/outbox/retry_deadline_store.dart';
import 'package:my_shop_desktop/core/offline/outbox/sync_state.dart';
import 'package:my_shop_desktop/core/offline/sync/backoff_policy.dart';
import 'package:my_shop_desktop/core/offline/sync/push_orchestrator.dart';
import 'package:my_shop_desktop/core/offline/sync/scheduler_timer.dart';

/// Reason the scheduler is blocked from automatic retries (§40.5 C6).
enum SyncBlockedReason { clientTooOld, serverUnsupported }

/// Snapshot of scheduler state for the indicator and for tests.
class SyncSchedulerStatus {
  const SyncSchedulerStatus({
    required this.running,
    required this.paused,
    required this.passInFlight,
    required this.authAttention,
    required this.consecutiveFailures,
    this.blocked,
    this.nextRunAt,
    this.lastRunAt,
    this.lastFault,
  });

  final bool running;
  final bool paused;
  final bool passInFlight;
  final bool authAttention;
  final int consecutiveFailures;
  final SyncBlockedReason? blocked;
  final DateTime? nextRunAt;
  final DateTime? lastRunAt;
  final PushRunFault? lastFault;

  bool get hasScheduledWake =>
      nextRunAt != null && !passInFlight && running && !paused;

  @override
  bool operator ==(Object other) {
    return other is SyncSchedulerStatus &&
        other.running == running &&
        other.paused == paused &&
        other.passInFlight == passInFlight &&
        other.authAttention == authAttention &&
        other.consecutiveFailures == consecutiveFailures &&
        other.blocked == blocked &&
        other.nextRunAt == nextRunAt &&
        other.lastRunAt == lastRunAt &&
        other.lastFault == lastFault;
  }

  @override
  int get hashCode => Object.hash(
    running,
    paused,
    passInFlight,
    authAttention,
    consecutiveFailures,
    blocked,
    nextRunAt,
    lastRunAt,
    lastFault,
  );

  @override
  String toString() =>
      'SyncSchedulerStatus(running:$running, paused:$paused, passInFlight:$passInFlight, '
      'auth:$authAttention, fails:$consecutiveFailures, blocked:${blocked?.name}, next: $nextRunAt, last: $lastRunAt, fault:${lastFault?.name})';
}

/// Drives push passes against the durable outbox (§38.10).
class SyncScheduler {
  SyncScheduler({
    required this.orchestrator,
    required this.connectivity,
    required this.deadlineStore,
    this.blockedRecheckInterval = const Duration(minutes: 15),
    this.minRunSpacing = const Duration(milliseconds: 250),
    BackoffPolicy? backoff,
    this.timerFactory = const SystemRetryTimerFactory(),
    this.clock = DateTime.now,
    this.random,
    this.logger,
  }) : _backoff = backoff ?? orchestrator.backoff;

  final PushOrchestrator orchestrator;
  final ConnectivityMonitor connectivity;
  final RetryDeadlineStore deadlineStore;
  final Duration blockedRecheckInterval;
  final Duration minRunSpacing;
  final BackoffPolicy _backoff;
  final RetryTimerFactory timerFactory;
  final DateTime Function() clock;
  final Random? random;
  final void Function(String, dynamic)? logger;

  bool _started = false;
  bool _paused = false;
  bool _disposed = false;
  bool _evaluating = false;
  bool _passInFlight = false;
  bool _rerunRequested = false;
  bool _authAttention = false;
  RetryTimer? _timer;
  DateTime? _nextRunAt;
  DateTime? _lastRunAt;
  int _consecutiveFailures = 0;
  SyncBlockedReason? _blocked;
  PushRunFault? _lastFault;
  final StreamController<SyncSchedulerStatus> _changes =
      StreamController<SyncSchedulerStatus>.broadcast();

  SyncSchedulerStatus get status => SyncSchedulerStatus(
    running: _started && !_disposed,
    paused: _paused,
    passInFlight: _passInFlight,
    authAttention: _authAttention,
    consecutiveFailures: _consecutiveFailures,
    blocked: _blocked,
    nextRunAt: _nextRunAt,
    lastRunAt: _lastRunAt,
    lastFault: _lastFault,
  );

  Stream<SyncSchedulerStatus> get changes => _changes.stream;

  Future<void> start() async {
    _assertNotDisposed();
    if (_started) return;
    _started = true;
    _paused = false;
    // Establish an explicit connectivity verdict at boot.
    await connectivity.checkNow();
    await _evaluate();
  }

  Future<void> trigger() async {
    _assertNotDisposed();
    if (!_started || _paused) return;
    if (_passInFlight || _evaluating) {
      _rerunRequested = true;
      _emit();
      return;
    }
    _cancelTimer();
    await _evaluate();
  }

  Future<void> pause() async {
    if (_disposed) return;
    if (!_paused) {
      _paused = true;
      _cancelTimer();
      _nextRunAt = null;
      _emit();
    }
  }

  Future<void> resume() async {
    _assertNotDisposed();
    if (_paused) {
      _paused = false;
      _started = true;
      await _evaluate();
    }
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _cancelTimer();
    _nextRunAt = null;
    if (!_changes.isClosed) await _changes.close();
  }

  Future<void> _evaluate() async {
    if (_disposed || _paused || !_started) return;
    if (_evaluating) {
      _rerunRequested = true;
      _emit();
      return;
    }
    _evaluating = true;
    try {
      // 1. Nothing to do? Don't schedule wakeups while idle.
      if (!await _hasWork()) {
        _setNextRun(null);
        _emit();
        return;
      }

      // 2. Connectivity gate: if not allowed, probe and wait.
      ConnectivitySnapshot snapshot = connectivity.snapshot;
      if (!snapshot.mayAttemptSync) {
        snapshot = await connectivity.checkNow();
        if (!snapshot.mayAttemptSync) {
          _setNextRun(clock().add(connectivity.timeUntilNextProbe));
          _emit();
          return;
        }
      }

      // 3. Server-directed deadline.
      final DateTime now = clock();
      final DateTime? deadline = await deadlineStore.read();
      if (deadline != null && now.isBefore(deadline)) {
        _setNextRun(deadline);
        _emit();
        return;
      }

      // 4. Spacing: don't run immediately after a previous pass.
      final DateTime? last = _lastRunAt;
      if (last != null) {
        final DateTime earliest = last.add(minRunSpacing);
        if (now.isBefore(earliest)) {
          _setNextRun(earliest);
          _emit();
          return;
        }
      }

      // 5. Run one pass.
      await _runPass();
    } finally {
      _evaluating = false;
      if (!_disposed && _rerunRequested) {
        _rerunRequested = false;
        // A trigger arrived during/around the pass: coalesce with spacing.
        _setNextRun(clock().add(minRunSpacing));
      }
      if (!_disposed) _emit();
    }
  }

  Future<void> _runPass() async {
    if (_disposed) return;
    _passInFlight = true;
    _emit();
    PushRunResult result;
    try {
      result = await orchestrator.runOnce();
    } on Object catch (error) {
      _passInFlight = false;
      _consecutiveFailures++;
      _lastFault = PushRunFault.transient;
      _lastRunAt = clock();
      _blocked = null;
      _authAttention = false;
      connectivity.recordEvidence(
        ConnectivityEvidence.unreachable,
        failureKind: ReachabilityFailureKind.network,
      );
      await deadlineStore.clear();
      final Duration delay = _backoff.delayFor(
        _consecutiveFailures,
        random: random,
      );
      _setNextRun(clock().add(delay));
      logger?.call('sync-scheduler.orchestrator-error', error.toString());
      return;
    }

    _passInFlight = false;
    final DateTime now = clock();
    _lastRunAt = now;
    _lastFault = result.fault;
    _consecutiveFailures = (result.fault == null)
        ? 0
        : _consecutiveFailures + 1;

    // Evidence → connectivity.
    connectivity.recordEvidence(
      _evidenceFor(result),
      failureKind: _evidenceFailureKind(result),
    );

    // Deadline persistence/clear.
    final Duration? directive = result.serverRetryAfter;
    if (directive != null) {
      await deadlineStore.write(now.add(directive));
    } else {
      await deadlineStore.clear();
    }

    // Blocked states.
    if (result.fault == PushRunFault.clientTooOld) {
      _blocked = SyncBlockedReason.clientTooOld;
      _authAttention = false;
    } else if (result.fault == PushRunFault.serverUnsupported) {
      _blocked = SyncBlockedReason.serverUnsupported;
      _authAttention = false;
    } else {
      _blocked = null;
      _authAttention = result.fault == PushRunFault.authenticationRequired;
    }

    if (_blocked != null) {
      _setNextRun(now.add(blockedRecheckInterval));
      return;
    }
    if (result.fault != null) {
      final Duration delay =
          result.retryAfter ??
          _backoff.delayFor(_consecutiveFailures, random: random);
      _setNextRun(now.add(delay));
      return;
    }
    // Success: no fault.
    if (result.attempted >= orchestrator.batchSize) {
      _setNextRun(now.add(minRunSpacing));
      return;
    }
    // Fewer than batch size sent → backlog likely drained.
    _setNextRun(null);
  }

  Future<bool> _hasWork() async {
    final Map<SyncState, int> counts = await orchestrator.outbox
        .countsByState();
    int work = 0;
    for (final SyncState s in const [
      SyncState.localOnly,
      SyncState.pending,
      SyncState.syncing,
      SyncState.retryableError,
    ]) {
      work += counts[s] ?? 0;
    }
    return work > 0;
  }

  ConnectivityEvidence _evidenceFor(PushRunResult result) {
    if (result.fault == null) return ConnectivityEvidence.reachable;
    final int? status = result.httpStatus;
    if (status == null) return ConnectivityEvidence.unreachable;
    if (status >= 500) return ConnectivityEvidence.degraded;
    return ConnectivityEvidence.reachable;
  }

  ReachabilityFailureKind _evidenceFailureKind(PushRunResult result) {
    if (result.fault == null) return ReachabilityFailureKind.serverError;
    final int? status = result.httpStatus;
    if (status == null) return ReachabilityFailureKind.network;
    if (status >= 500) return ReachabilityFailureKind.serverError;
    // 429 and other 4xx: the server answered, so the backend is reachable even
    // though the request was refused.
    return ReachabilityFailureKind.network;
  }

  void _setNextRun(DateTime? at) {
    _cancelTimer();
    _nextRunAt = null;
    if (at == null) return;
    if (_disposed || _paused || !_started) return;
    final Duration delay = at.difference(clock());
    final Duration bounded = delay.isNegative ? Duration.zero : delay;
    _nextRunAt = clock().add(bounded);
    _schedule(bounded);
  }

  void _schedule(Duration delay) {
    if (_disposed || _paused || !_started) return;
    _cancelTimer();
    _timer = timerFactory.schedule(delay, () {
      _timer = null;
      if (_disposed || _paused) return;
      unawaited(_evaluate());
    });
  }

  void _cancelTimer() {
    _timer?.cancel();
    _timer = null;
  }

  void _emit() {
    if (_disposed || _changes.isClosed) return;
    _changes.add(status);
  }

  void _assertNotDisposed() {
    if (_disposed) throw StateError('SyncScheduler has been disposed');
  }
}
