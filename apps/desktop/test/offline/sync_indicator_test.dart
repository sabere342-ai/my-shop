import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_state.dart';
import 'package:my_shop_desktop/core/offline/outbox/sync_state.dart';
import 'package:my_shop_desktop/core/offline/sync/sync_indicator.dart';
import 'package:my_shop_desktop/core/offline/sync/sync_scheduler.dart';

/// The §40.5 C7 indicator precedence matrix.
void main() {
  final DateTime now = DateTime.utc(2026, 1, 1, 12);

  ConnectivitySnapshot connectivity(BackendConnectivity value) =>
      ConnectivitySnapshot(connectivity: value, probeInFlight: false);

  SyncSchedulerStatus scheduler({
    bool passInFlight = false,
    bool authAttention = false,
    SyncBlockedReason? blocked,
    DateTime? nextRunAt,
  }) {
    return SyncSchedulerStatus(
      running: true,
      paused: false,
      passInFlight: passInFlight,
      authAttention: authAttention,
      consecutiveFailures: 0,
      blocked: blocked,
      nextRunAt: nextRunAt,
    );
  }

  Map<SyncState, int> counts({
    int localOnly = 0,
    int pending = 0,
    int syncing = 0,
    int retryable = 0,
    int conflict = 0,
    int permanentRejected = 0,
    int synced = 0,
  }) {
    return <SyncState, int>{
      SyncState.localOnly: localOnly,
      SyncState.pending: pending,
      SyncState.syncing: syncing,
      SyncState.retryableError: retryable,
      SyncState.conflict: conflict,
      SyncState.permanentRejected: permanentRejected,
      SyncState.synced: synced,
    };
  }

  SyncIndicatorSnapshot derive({
    BackendConnectivity conn = BackendConnectivity.reachable,
    Map<SyncState, int>? stateCounts,
    SyncSchedulerStatus? status,
    DateTime? serverRetryDeadline,
  }) {
    return SyncIndicatorSnapshot.from(
      connectivitySnapshot: connectivity(conn),
      counts: stateCounts ?? counts(),
      schedulerStatus: status ?? scheduler(),
      serverRetryDeadline: serverRetryDeadline,
      now: now,
    );
  }

  test('an empty outbox is idle regardless of scheduler chatter', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(),
      status: scheduler(passInFlight: true, authAttention: true),
    );
    expect(snapshot.state, SyncIndicatorState.idle);
    expect(snapshot.totalCount, 0);
  });

  test('all-synced work is synchronized', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(synced: 4),
    );
    expect(snapshot.state, SyncIndicatorState.synchronized);
    expect(snapshot.totalCount, 4);
    expect(snapshot.syncedCount, 4);
  });

  test('queued PENDING work is pending', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(pending: 2),
    );
    expect(snapshot.state, SyncIndicatorState.pending);
    expect(snapshot.pendingCount, 2);
  });

  test('LOCAL_ONLY counts toward pending', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(localOnly: 3),
    );
    expect(snapshot.state, SyncIndicatorState.pending);
    expect(snapshot.pendingCount, 3);
    expect(snapshot.localOnlyCount, 3);
  });

  test('a RETRYABLE_ERROR is retryDelayed', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(retryable: 1),
    );
    expect(snapshot.state, SyncIndicatorState.retryDelayed);
    expect(snapshot.retryableCount, 1);
  });

  test('a future server deadline is retryDelayed with nextAttemptAt', () {
    final DateTime deadline = now.add(const Duration(minutes: 5));
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(pending: 1),
      serverRetryDeadline: deadline,
    );
    expect(snapshot.state, SyncIndicatorState.retryDelayed);
    expect(snapshot.serverRetryDeadline, deadline);
    expect(snapshot.nextAttemptAt, deadline);
  });

  test('a past server deadline does not delay', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(pending: 1),
      serverRetryDeadline: now.subtract(const Duration(minutes: 5)),
    );
    expect(snapshot.state, SyncIndicatorState.pending);
  });

  test('a future nextRunAt is retryDelayed with nextAttemptAt', () {
    final DateTime next = now.add(const Duration(seconds: 30));
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(pending: 1),
      status: scheduler(nextRunAt: next),
    );
    expect(snapshot.state, SyncIndicatorState.retryDelayed);
    expect(snapshot.nextAttemptAt, next);
  });

  test('a SYNCING row is syncing', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(syncing: 1),
    );
    expect(snapshot.state, SyncIndicatorState.syncing);
    expect(snapshot.syncingCount, 1);
  });

  test('a pass in flight is syncing even with only synced rows', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(synced: 1),
      status: scheduler(passInFlight: true),
    );
    expect(snapshot.state, SyncIndicatorState.syncing);
    expect(snapshot.passInFlight, isTrue);
  });

  test('a CONFLICT requires review', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(conflict: 1),
    );
    expect(snapshot.state, SyncIndicatorState.reviewRequired);
    expect(snapshot.reviewCount, 1);
  });

  test('a PERMANENT_REJECTED requires review', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(permanentRejected: 1),
    );
    expect(snapshot.state, SyncIndicatorState.reviewRequired);
    expect(snapshot.reviewCount, 1);
  });

  test('auth attention is authenticationRequired', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(pending: 1),
      status: scheduler(authAttention: true),
    );
    expect(snapshot.state, SyncIndicatorState.authenticationRequired);
  });

  test('a client-too-old block is upgradeRequired', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(pending: 1),
      status: scheduler(blocked: SyncBlockedReason.clientTooOld),
    );
    expect(snapshot.state, SyncIndicatorState.upgradeRequired);
  });

  test('a server-unsupported block is serverUnsupported', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(pending: 1),
      status: scheduler(blocked: SyncBlockedReason.serverUnsupported),
    );
    expect(snapshot.state, SyncIndicatorState.serverUnsupported);
  });

  test('precedence: a block outranks review, syncing, and retry delay', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(
        conflict: 1,
        syncing: 1,
        retryable: 1,
        pending: 1,
      ),
      status: scheduler(
        blocked: SyncBlockedReason.clientTooOld,
        passInFlight: true,
        nextRunAt: now.add(const Duration(minutes: 1)),
      ),
    );
    expect(snapshot.state, SyncIndicatorState.upgradeRequired);
  });

  test('precedence: review outranks syncing and retry delay', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(conflict: 1, syncing: 1, retryable: 1),
      status: scheduler(nextRunAt: now.add(const Duration(minutes: 1))),
    );
    expect(snapshot.state, SyncIndicatorState.reviewRequired);
  });

  test('precedence: syncing outranks retry delay', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(syncing: 1, retryable: 1),
      status: scheduler(nextRunAt: now.add(const Duration(minutes: 1))),
    );
    expect(snapshot.state, SyncIndicatorState.syncing);
  });

  test('precedence: retry delay outranks pending', () {
    final SyncIndicatorSnapshot snapshot = derive(
      stateCounts: counts(pending: 1, retryable: 1),
    );
    expect(snapshot.state, SyncIndicatorState.retryDelayed);
  });

  test('offlineWithPendingWork is true only when unreachable with queue', () {
    final SyncIndicatorSnapshot offline = derive(
      conn: BackendConnectivity.unreachable,
      stateCounts: counts(pending: 1),
    );
    expect(offline.offlineWithPendingWork, isTrue);

    final SyncIndicatorSnapshot online = derive(
      conn: BackendConnectivity.reachable,
      stateCounts: counts(pending: 1),
    );
    expect(online.offlineWithPendingWork, isFalse);

    final SyncIndicatorSnapshot empty = derive(
      conn: BackendConnectivity.unreachable,
      stateCounts: counts(),
    );
    expect(empty.offlineWithPendingWork, isFalse);
  });

  test('the connectivity verdict is carried through', () {
    final SyncIndicatorSnapshot snapshot = derive(
      conn: BackendConnectivity.degraded,
      stateCounts: counts(pending: 1),
    );
    expect(snapshot.connectivity, BackendConnectivity.degraded);
    expect(snapshot.state, SyncIndicatorState.pending);
  });
}
