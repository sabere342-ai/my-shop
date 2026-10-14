/// The single remote-apply entry point — Master Plan §38.12.1, §40.5 (M1b-S7),
/// ADR-038.
///
/// §38.12.1 is a hard rule with a mechanical enforcement (CI stage 24): inside
/// `lib/core/offline/`, **this file is the only place permitted to write to the
/// database on behalf of the server**. Everything a remote change does to local
/// storage goes through [applyRemoteWithoutOutbox] — so the loop-prevention
/// invariants live in exactly one reviewable function instead of being a
/// convention every future call site has to remember.
///
/// The function owns three guarantees and nothing else:
///
/// 1. **The sequence guard (§38.12.1).** A change whose `server_sequence` is not
///    strictly newer than the sequence already applied to that entity is
///    discarded. A stale page therefore cannot undo newer state, and a
///    re-delivered change cannot re-apply (T-O7).
/// 2. **Structural outbox suppression (§38.12.1).** The whole apply runs inside
///    [RemoteApplyScope]; an [OutboxRepository] enqueue attempted anywhere in
///    that context throws [OutboxWriteDuringRemoteApplyException]. A remote
///    change can never become an outgoing mutation.
/// 3. **Atomicity (§38.7.1 by analogy).** The local write and the applied-
///    sequence advance commit in one Drift transaction. If the write fails, the
///    sequence is *not* advanced, no outgoing mutation exists, and the change is
///    simply retryable — a failure can never masquerade as a successful apply.
///
/// What this file deliberately does **not** do: it does not fetch or reconstruct
/// the full state of the changed entity. M1b-S6's pull feed carries change
/// *descriptors*, not payloads (§38.11.2), and full entity retrieval is a later
/// business slice (§38.15). The concrete per-entity write is supplied by the
/// caller as the [apply] operation, which runs inside the boundary; until that
/// slice exists there is no business entity to write, and this boundary does not
/// invent one or call a no-op a successful synchronisation.
library;

import 'package:drift/drift.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/remote_apply_scope.dart';

/// One remote-origin change as the apply boundary consumes it.
///
/// It mirrors the change descriptor §38.11.2's pull page carries:
/// `serverSequence`, `entityType`, `entityId`, and the optional originating
/// `mutationId`. The `serverSequence` is a decimal **string** for the same
/// reason the wire carries it that way — §38.11.1's sequence is a 64-bit value,
/// and a sequence above 2^53 must survive intact (this boundary compares
/// sequences as [BigInt], never as a double).
class RemoteChange {
  const RemoteChange({
    required this.entityType,
    required this.entityId,
    required this.serverSequence,
    this.mutationId,
    this.changedAt,
  });

  /// §38.11.1 `change_log.entity_type` — an open vocabulary.
  final String entityType;

  /// §38.11.1 `change_log.entity_id` — the changed object's local identity.
  final String entityId;

  /// §38.11.1 `server_sequence`, as a non-negative decimal string.
  final String serverSequence;

  /// The originating `mutation_id` when the change came from a device
  /// (§38.11.2 own-echo suppression). Carried for the concrete entity-apply
  /// slice; the guard here does not need it.
  final String? mutationId;

  /// §38.11.1 `change_log.changed_at`, when the transport supplies it.
  final DateTime? changedAt;

  @override
  String toString() =>
      'RemoteChange($entityType/$entityId @ $serverSequence'
      '${mutationId == null ? '' : ', mutation $mutationId'})';
}

/// What one [applyRemoteWithoutOutbox] call did (§38.12.1).
enum RemoteApplyDisposition {
  /// The change was strictly newer than the applied sequence: the [apply]
  /// operation ran and the applied sequence advanced, atomically.
  applied,

  /// The change was not strictly newer than the sequence already applied to
  /// this entity: nothing was written and local state was left exactly as it
  /// was. This is the guard working, not an error — a stale page or a
  /// re-delivery lands here.
  discardedStale,
}

/// The outcome of one [applyRemoteWithoutOutbox] call.
class RemoteApplyResult {
  const RemoteApplyResult({
    required this.change,
    required this.disposition,
    required this.previousSequence,
  });

  /// The change this result describes.
  final RemoteChange change;

  final RemoteApplyDisposition disposition;

  /// The entity's applied sequence before this call, or `null` when this was
  /// the entity's first applied change. Useful for diagnostics and tests.
  final BigInt? previousSequence;

  /// True when [RemoteApplyDisposition.applied].
  bool get wasApplied => disposition == RemoteApplyDisposition.applied;

  @override
  String toString() =>
      'RemoteApplyResult(${disposition.name}, $change, previous: '
      '${previousSequence?.toString() ?? 'none'})';
}

/// The concrete local effect of one remote change.
///
/// Supplied by the caller and executed **inside** the boundary's transaction
/// and suppression context, so it cannot bypass either. This is where the
/// future entity-retrieval slice will write `local_products`, `local_sales`, and
/// so on; until then it is the seam tests exercise with a deterministic fixture.
typedef RemoteApplyOperation = Future<void> Function();

/// Applies one remote-origin change to local storage — the only sanctioned way
/// a server change may be written locally (§38.12.1).
///
/// @param db The local database. The write and the guard advance share one
///   transaction.
/// @param change The change descriptor to apply.
/// @param apply The local effect, run only when the change is newer than the
///   entity's applied sequence.
/// @return Whether the change was applied or discarded as stale.
/// @throws ArgumentError when `change.serverSequence` is not a non-negative
///   decimal integer.
/// @throws OutboxWriteDuringRemoteApplyException when [apply] attempts to
///   enqueue an outgoing mutation — the invariant violation the plan makes a
///   crash (§38.12.1).
Future<RemoteApplyResult> applyRemoteWithoutOutbox(
  AppDatabase db, {
  required RemoteChange change,
  required RemoteApplyOperation apply,
}) {
  final BigInt incoming = _parseSequence(change.serverSequence);
  if (change.entityType.trim().isEmpty) {
    throw ArgumentError.value(change.entityType, 'change.entityType', 'must not be empty');
  }
  if (change.entityId.trim().isEmpty) {
    throw ArgumentError.value(change.entityId, 'change.entityId', 'must not be empty');
  }

  // The suppression context wraps the whole transaction, not just `apply`, so
  // no step of a remote apply — including a future added step — can enqueue an
  // outgoing mutation. `runZoned` tears the context down even on a throw.
  return RemoteApplyScope.run(
    () => db.transaction(() async {
      final BigInt? previous = await _readAppliedSequence(
        db,
        entityType: change.entityType,
        entityId: change.entityId,
      );

      if (previous != null && incoming <= previous) {
        // §38.12.1: a stale page must not roll back newer state.
        return RemoteApplyResult(
          change: change,
          disposition: RemoteApplyDisposition.discardedStale,
          previousSequence: previous,
        );
      }

      // The local effect. If this throws, the transaction rolls back and the
      // applied sequence is not advanced, so the change stays retryable and
      // nothing claims a success that did not happen.
      await apply();

      await db.into(db.remoteAppliedChanges).insert(
            RemoteAppliedChangesCompanion.insert(
              entityType: change.entityType,
              entityId: change.entityId,
              lastAppliedServerSequence: incoming.toString(),
              appliedAt: DateTime.now(),
            ),
            mode: InsertMode.insertOrReplace,
          );

      return RemoteApplyResult(
        change: change,
        disposition: RemoteApplyDisposition.applied,
        previousSequence: previous,
      );
    }),
  );
}

/// The highest `server_sequence` applied to an entity, or `null` if none yet.
Future<BigInt?> _readAppliedSequence(
  AppDatabase db, {
  required String entityType,
  required String entityId,
}) async {
  final RemoteAppliedChange? row = await (db.select(db.remoteAppliedChanges)
        ..where((t) => t.entityType.equals(entityType) & t.entityId.equals(entityId)))
      .getSingleOrNull();
  if (row == null) return null;
  return BigInt.parse(row.lastAppliedServerSequence);
}

/// §38.11.1 `server_sequence`: a non-negative decimal integer, never a double.
final RegExp _sequencePattern = RegExp(r'^\d+$');

BigInt _parseSequence(String value) {
  if (!_sequencePattern.hasMatch(value)) {
    throw ArgumentError.value(
      value,
      'change.serverSequence',
      'must be a non-negative decimal integer (§38.11.1)',
    );
  }
  // BigInt keeps a 64-bit sequence exact past 2^53; a `double` would not.
  return BigInt.parse(value);
}
