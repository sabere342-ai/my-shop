/// The §38.13 sync state machine — the vocabulary, the edges, and the
/// exceptions that guard them.
///
/// "There is no `isSynced` boolean." A local mutation moves through an
/// explicit lifecycle; every edge below is taken from §38.13's table, and the
/// writer in `outbox_repository.dart` refuses any edge the table does not
/// list. Wire names are the exact UPPER_SNAKE values `sync.contract.ts`
/// publishes (M1b-S2), so the local table, the state machine, and the server
/// contract cannot drift apart silently.
library;

/// §38.13's seven states.
enum SyncState {
  /// Committed locally, not yet eligible to push (§38.13).
  localOnly('LOCAL_ONLY'),

  /// Eligible to push — the normal resting state of an offline sale.
  pending('PENDING'),

  /// In flight.
  syncing('SYNCING'),

  /// Server acknowledged. Terminal for that mutation.
  synced('SYNCED'),

  /// Transient failure; scheduled retry with backoff.
  retryableError('RETRYABLE_ERROR'),

  /// Applied locally and server-side, but the server state differs in a way
  /// needing owner review (§38.13).
  conflict('CONFLICT'),

  /// Server refused permanently. Never silently dropped (§38.13).
  permanentRejected('PERMANENT_REJECTED');

  const SyncState(this.wireName);

  /// The §38.13 / contract name stored in `outbox.sync_state`.
  final String wireName;

  /// Parses a stored or wire name, rejecting anything outside the contract.
  static SyncState fromWire(String value) {
    for (final state in SyncState.values) {
      if (state.wireName == value) return state;
    }
    throw UnknownSyncStateException(value);
  }
}

/// The complete edge set of §38.13, as data.
///
/// * `LOCAL_ONLY → PENDING`: promotion once the mutation is eligible to push.
/// * `PENDING → SYNCING`: a push attempt begins.
/// * `SYNCING → SYNCED | RETRYABLE_ERROR | PENDING | CONFLICT |
///   PERMANENT_REJECTED`: every outcome of an attempt. §38.13's `SYNCING` row
///   names the first three explicitly; `CONFLICT` and `PERMANENT_REJECTED`
///   are reached from `SYNCING` as well, because F-12 and §38.10.4 place both
///   outcomes during the push and §38.13 defines only their *next* step
///   (owner resolution).
/// * `SYNCED`: terminal — no outgoing edge (§38.8.2, acknowledgement is the
///   only way in and nothing is the way out).
/// * `RETRYABLE_ERROR → PENDING`: the backoff ladder makes it eligible again.
/// * `CONFLICT → {}` / `PERMANENT_REJECTED → {}`: owner resolution (§38.13).
///   No resolution path exists in M1b-S3, so the edges are added by the slice
///   that builds one.
const Map<SyncState, Set<SyncState>> allowedSyncTransitions =
    <SyncState, Set<SyncState>>{
  SyncState.localOnly: <SyncState>{SyncState.pending},
  SyncState.pending: <SyncState>{SyncState.syncing},
  SyncState.syncing: <SyncState>{
    SyncState.synced,
    SyncState.retryableError,
    SyncState.pending,
    SyncState.conflict,
    SyncState.permanentRejected,
  },
  SyncState.synced: <SyncState>{},
  SyncState.retryableError: <SyncState>{SyncState.pending},
  SyncState.conflict: <SyncState>{},
  SyncState.permanentRejected: <SyncState>{},
};

/// True when §38.13 permits the edge `from → to`.
bool canTransition(SyncState from, SyncState to) {
  return allowedSyncTransitions[from]?.contains(to) ?? false;
}

/// The three states whose arrival records a failure classification
/// (§38.8.1 `last_error_code`): they require an error code on entry.
bool isErrorState(SyncState state) {
  return state == SyncState.retryableError ||
      state == SyncState.conflict ||
      state == SyncState.permanentRejected;
}

/// A `sync_state` string outside §38.13 — a corrupted or hand-edited row.
class UnknownSyncStateException implements Exception {
  UnknownSyncStateException(this.value);

  final String value;

  @override
  String toString() => 'UnknownSyncStateException: "$value" is not a §38.13 sync state';
}

/// A transition §38.13 does not list. The write never happens: the writer
/// validates the edge before touching the row (§38.8.2, §38.13).
class IllegalSyncTransitionException implements Exception {
  IllegalSyncTransitionException({
    required this.mutationId,
    required this.from,
    required this.to,
  });

  final String mutationId;
  final SyncState from;
  final SyncState to;

  @override
  String toString() =>
      'IllegalSyncTransitionException: $mutationId cannot move '
      '${from.wireName} → ${to.wireName} (§38.13)';
}
