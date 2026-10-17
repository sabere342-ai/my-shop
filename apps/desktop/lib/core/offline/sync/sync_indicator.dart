/// Offline indicator state — Master Plan §40.5 C7.
///
/// Computes a presentation state from connectivity, outbox counts, scheduler
/// status, and a stored server-directed retry deadline. The rules are intended
/// to let a future UI distinguish:
///
/// * Local work continuing offline
/// * Pending synchronization
/// * Synchronization running
/// * Temporarily delayed retry
/// * Authentication requiring attention
/// * Permanently rejected/conflicted records requiring review
/// * Successfully synchronized state
library;

import 'package:my_shop_desktop/core/offline/connectivity/connectivity_state.dart';
import 'package:my_shop_desktop/core/offline/outbox/sync_state.dart';
import 'package:my_shop_desktop/core/offline/sync/sync_scheduler.dart';

/// What a UI indicator should show about the synchronization state (§40.5 C7).
enum SyncIndicatorState {
  /// Nothing is tracked locally. Fresh install or no mutations.
  idle,

  /// No connectivity verdict yet, but there is work? In practice [idle] is
  /// preferred when [totalCount] == 0.
  unknown,

  /// All tracked mutations are SYNCED. The source of truth is the outbox
  /// states; connectivity may be unknown/reachable.
  synchronized,

  /// Work is queued (PENDING, LOCAL_ONLY) and waiting for the next attempt.
  pending,

  /// A sync pass is in flight (SYNCING) or the scheduler reports pass-in-flight.
  syncing,

  /// A transient failure scheduled a retry, or a server-directed deadline is
  /// pending (§40.5 C7: "temporarily delayed retry").
  retryDelayed,

  /// Authentication requires attention (§38.10.4).
  authenticationRequired,

  /// The client is too old and must be upgraded; sync is blocked.
  upgradeRequired,

  /// The server does not support this endpoint; sync is blocked.
  serverUnsupported,

  /// There are `CONFLICT` or `PERMANENT_REJECTED` records requiring review.
  reviewRequired,
}

/// An immutable snapshot for the offline/sync indicator.
class SyncIndicatorSnapshot {
  const SyncIndicatorSnapshot({
    required this.state,
    required this.connectivity,
    required this.pendingCount,
    required this.retryableCount,
    required this.syncingCount,
    required this.reviewCount,
    required this.syncedCount,
    required this.localOnlyCount,
    this.nextAttemptAt,
    this.passInFlight = false,
    this.serverRetryDeadline,
    this.totalCount = 0,
  });

  /// Derived indicator state.
  final SyncIndicatorState state;

  /// Connectivity verdict.
  final BackendConnectivity connectivity;

  /// Count of mutations waiting for their first/next push (PENDING + LOCAL_ONLY).
  final int pendingCount;

  /// Count of mutations in `RETRYABLE_ERROR`.
  final int retryableCount;

  /// Count of mutations currently `SYNCING`.
  final int syncingCount;

  /// Count of records needing review (`CONFLICT` + `PERMANENT_REJECTED`).
  final int reviewCount;

  /// Count of `SYNCED` mutations.
  final int syncedCount;

  /// Count of `LOCAL_ONLY`.
  final int localOnlyCount;

  /// Total mutations tracked.
  final int totalCount;

  /// Next scheduled attempt, if known (from scheduler or deadline).
  final DateTime? nextAttemptAt;

  /// True when a pass is in flight.
  final bool passInFlight;

  /// The stored server-directed deadline, if any.
  final DateTime? serverRetryDeadline;

  /// True when connectivity is unreachable and there is pending work.
  bool get offlineWithPendingWork =>
      connectivity == BackendConnectivity.unreachable &&
      (pendingCount + retryableCount) > 0;

  /// Factory that derives the indicator from the source-of-truths. `now` is
  /// passed so a deadline that is in the future/past can be determined (tests
  /// pass a fixed `now`).
  static SyncIndicatorSnapshot from({
    required ConnectivitySnapshot connectivitySnapshot,
    required Map<SyncState, int> counts,
    required SyncSchedulerStatus schedulerStatus,
    DateTime? serverRetryDeadline,
    DateTime? now,
  }) {
    final DateTime at = now ?? DateTime.now();
    final int localOnlyCountVal = counts[SyncState.localOnly] ?? 0;
    final int pending = counts[SyncState.pending] ?? 0;
    final int syncing = counts[SyncState.syncing] ?? 0;
    final int retryable = counts[SyncState.retryableError] ?? 0;
    final int conflict = counts[SyncState.conflict] ?? 0;
    final int permanentRejected = counts[SyncState.permanentRejected] ?? 0;
    final int synced = counts[SyncState.synced] ?? 0;

    final int total =
        localOnlyCountVal +
        pending +
        syncing +
        retryable +
        conflict +
        permanentRejected +
        synced;
    final int pendingTotal = localOnlyCountVal + pending;
    final int review = conflict + permanentRejected;

    final bool deadlinePending =
        serverRetryDeadline != null && serverRetryDeadline.isAfter(at);

    // Precedence as specified by §40.5 C7.
    SyncIndicatorState state = SyncIndicatorState.synchronized;
    if (total == 0) {
      state = SyncIndicatorState.idle;
    } else {
      if (schedulerStatus.blocked != null) {
        state = schedulerStatus.blocked == SyncBlockedReason.clientTooOld
            ? SyncIndicatorState.upgradeRequired
            : SyncIndicatorState.serverUnsupported;
      } else if (schedulerStatus.authAttention) {
        state = SyncIndicatorState.authenticationRequired;
      } else if (review > 0) {
        state = SyncIndicatorState.reviewRequired;
      } else if (syncing > 0 || schedulerStatus.passInFlight) {
        state = SyncIndicatorState.syncing;
      } else if (retryable > 0 ||
          deadlinePending ||
          (schedulerStatus.nextRunAt != null &&
              schedulerStatus.nextRunAt!.isAfter(at))) {
        state = SyncIndicatorState.retryDelayed;
      } else if (pendingTotal > 0) {
        state = SyncIndicatorState.pending;
      } else {
        state = SyncIndicatorState.synchronized;
      }
    }

    final DateTime? nextAttempt =
        schedulerStatus.nextRunAt ??
        (deadlinePending ? serverRetryDeadline : null);

    return SyncIndicatorSnapshot(
      state: state,
      connectivity: connectivitySnapshot.connectivity,
      pendingCount: pendingTotal,
      retryableCount: retryable,
      syncingCount: syncing,
      reviewCount: review,
      syncedCount: synced,
      localOnlyCount: localOnlyCountVal,
      totalCount: total,
      nextAttemptAt: nextAttempt,
      passInFlight: schedulerStatus.passInFlight,
      serverRetryDeadline: serverRetryDeadline,
    );
  }

  @override
  bool operator ==(Object other) {
    return other is SyncIndicatorSnapshot &&
        other.state == state &&
        other.connectivity == connectivity &&
        other.pendingCount == pendingCount &&
        other.retryableCount == retryableCount &&
        other.syncingCount == syncingCount &&
        other.reviewCount == reviewCount &&
        other.syncedCount == syncedCount &&
        other.localOnlyCount == localOnlyCount &&
        other.totalCount == totalCount &&
        other.nextAttemptAt == nextAttemptAt &&
        other.passInFlight == passInFlight &&
        other.serverRetryDeadline == serverRetryDeadline;
  }

  @override
  int get hashCode => Object.hash(
    state,
    connectivity,
    pendingCount,
    retryableCount,
    syncingCount,
    reviewCount,
    syncedCount,
    localOnlyCount,
    totalCount,
    nextAttemptAt,
    passInFlight,
    serverRetryDeadline,
  );

  @override
  String toString() =>
      'SyncIndicatorSnapshot(${state.name}, connectivity: ${connectivity.name}, '
      'pending:$pendingCount, retryable:$retryableCount, syncing:$syncingCount, '
      'review:$reviewCount, total:$totalCount, next: $nextAttemptAt)';
}
