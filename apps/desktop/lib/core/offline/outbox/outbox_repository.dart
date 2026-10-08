import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/operation_type.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_errors.dart';
import 'package:my_shop_desktop/core/offline/outbox/sync_state.dart';
import 'package:my_shop_desktop/core/offline/outbox/uuid_v7.dart';

/// What a caller supplies to [OutboxRepository.enqueue] — the business event
/// and its attribution.
///
/// Deliberately *not* here: `organization_id` and `device_id`. §38.8.1 takes
/// them "from device binding (§38.16), never from user input", so the writer
/// reads them from `local_meta` and there is no parameter through which a
/// caller could supply or spoof them.
class OutboxEnqueueCommand {
  const OutboxEnqueueCommand({
    required this.aggregateType,
    required this.aggregateId,
    required this.operationType,
    required this.payload,
    required this.payloadVersion,
    required this.actorUserId,
    required this.actorRoleSnapshot,
  });

  /// Open vocabulary — §38.8.1 ends its list with an ellipsis.
  final String aggregateType;

  final String aggregateId;
  final OperationType operationType;

  /// The complete immutable business event (§38.24). Encoded once at enqueue
  /// and never rewritten (§38.8.2 append-only payload).
  final Map<String, Object?> payload;

  final int payloadVersion;
  final String actorUserId;

  /// Effective permissions at the time of the mutation (§38.17).
  final Map<String, Object?> actorRoleSnapshot;
}

/// The durable outbox writer — Master Plan §38.8, §38.13, §38.10.2.
///
/// The governance rules this class is the *only* sanctioned implementation of:
///
/// * **Enqueue is transactional.** [enqueue] runs inside one drift
///   transaction, so a caller can compose it into the atomic local business
///   transaction of §38.7.1; if the outer transaction rolls back, the outbox
///   row, the audit row, and the sequence allocation all roll back with it.
/// * **There is no delete path.** The class exposes no way to remove a row;
///   the only deletion anywhere is the compactor's governed `SYNCED`-only
///   compaction (§38.8.2, F-17, §38.30.1).
/// * **There is no "mark synced" shortcut.** `SYNCED` is reachable only
///   through [transition], only from `SYNCING` (§38.13), and every transition
///   appends a row to `local_audit_events` (§38.13 "each transition is
///   timestamped and written to the local audit log").
/// * **Updates are bookkeeping-only.** A transition may write exactly four
///   columns: `sync_state`, `attempt_count`, `last_attempt_at`,
///   `last_error_code`. Identity, attribution, timestamps of creation, and
///   the payload are never touched after commit (§38.8.2).
/// * **Ordering is the database's, not the clock's.** `device_local_sequence`
///   is allocated from a `local_meta` counter inside the transaction
///   (§38.10.2), and `local_created_at` carries a persisted monotonic
///   high-water guard (§38.8.1, §38.16.5 backward-jump rule).
class OutboxRepository {
  OutboxRepository(this._db);

  final AppDatabase _db;

  /// `local_meta` keys this module owns.
  static const String organizationIdKey = 'organization_id';
  static const String deviceIdKey = 'device_id';
  static const String sequenceCounterKey = 'device_local_sequence';
  static const String localNowHighWaterKey = 'local_created_at_high_water_ms';

  /// §38.10.1: one push request carries 1–50 mutations.
  static const int maxPushBatchSize = 50;

  /// Commits a mutation to the outbox and promotes it `LOCAL_ONLY → PENDING`
  /// (§38.13) inside a single transaction.
  Future<OutboxData> enqueue(OutboxEnqueueCommand command) {
    _validateCommand(command);
    return _db.transaction(() async {
      final binding = await _readBinding();
      final int sequence = await _allocateSequence();
      final DateTime localCreatedAt = await _allocateLocalNow();
      final String mutationId = generateUuidV7();

      await _db.into(_db.outbox).insert(
            OutboxCompanion.insert(
              mutationId: mutationId,
              organizationId: binding.organizationId,
              deviceId: binding.deviceId,
              actorUserId: command.actorUserId,
              actorRoleSnapshot: jsonEncode(command.actorRoleSnapshot),
              aggregateType: command.aggregateType,
              aggregateId: command.aggregateId,
              operationType: command.operationType.wireName,
              payload: jsonEncode(command.payload),
              payloadVersion: command.payloadVersion,
              deviceLocalSequence: sequence,
              localCreatedAt: localCreatedAt,
              syncState: SyncState.localOnly.wireName,
              deviceIdempotencyKey: mutationId,
            ),
          );

      return _transitionInTxn(
        mutationId: mutationId,
        to: SyncState.pending,
      );
    });
  }

  /// Performs one §38.13 transition, or throws without writing anything.
  ///
  /// [errorCode] is required when entering a failure state (`RETRYABLE_ERROR`,
  /// `CONFLICT`, `PERMANENT_REJECTED`) and forbidden otherwise — it is §38.8.1's
  /// `last_error_code`, a failure classification, not free-form commentary.
  Future<OutboxData> transition({
    required String mutationId,
    required SyncState to,
    String? errorCode,
  }) {
    return _db.transaction(
      () => _transitionInTxn(mutationId: mutationId, to: to, errorCode: errorCode),
    );
  }

  /// The next batch to push: `PENDING` rows in ascending
  /// `device_local_sequence` (§38.10.1 ordering, §38.10.2 total order).
  Future<List<OutboxData>> pendingForPush({int limit = maxPushBatchSize}) {
    if (limit < 1 || limit > maxPushBatchSize) {
      throw ArgumentError.value(
        limit,
        'limit',
        'push batch size must be 1..$maxPushBatchSize (§38.10.1)',
      );
    }
    final query = _db.select(_db.outbox)
      ..where((t) => t.syncState.equals(SyncState.pending.wireName))
      ..orderBy([(t) => OrderingTerm.asc(t.deviceLocalSequence)])
      ..limit(limit);
    return query.get();
  }

  Future<OutboxData?> byId(String mutationId) {
    final query = _db.select(_db.outbox)..where((t) => t.mutationId.equals(mutationId));
    return query.getSingleOrNull();
  }

  /// Like [byId] but throws [OutboxRecordNotFoundException] when absent.
  Future<OutboxData> requireById(String mutationId) async {
    final row = await byId(mutationId);
    if (row == null) throw OutboxRecordNotFoundException(mutationId);
    return row;
  }

  /// Counts by state for the owner's sync console (§38.31.1) and tests.
  /// Every §38.13 state appears, zero included.
  Future<Map<SyncState, int>> countsByState() async {
    final result = <SyncState, int>{
      for (final state in SyncState.values) state: 0,
    };
    final query = _db.selectOnly(_db.outbox)
      ..addColumns([_db.outbox.syncState, countAll()])
      ..groupBy([_db.outbox.syncState]);
    for (final row in await query.get()) {
      final String? wire = row.read<String>(_db.outbox.syncState);
      final int count = row.read<int>(countAll()) ?? 0;
      if (wire != null) result[SyncState.fromWire(wire)] = count;
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // The state machine itself.
  // -------------------------------------------------------------------------

  /// Must be called inside a transaction: validates the §38.13 edge, writes
  /// the bookkeeping columns, and appends the audit event, atomically.
  Future<OutboxData> _transitionInTxn({
    required String mutationId,
    required SyncState to,
    String? errorCode,
  }) async {
    final OutboxData? row = await (_db.select(_db.outbox)
          ..where((t) => t.mutationId.equals(mutationId)))
        .getSingleOrNull();
    if (row == null) throw OutboxRecordNotFoundException(mutationId);

    final SyncState from = SyncState.fromWire(row.syncState);
    if (!canTransition(from, to)) {
      throw IllegalSyncTransitionException(mutationId: mutationId, from: from, to: to);
    }
    if (isErrorState(to) && errorCode == null) {
      throw ArgumentError(
        'errorCode is required when moving $mutationId to ${to.wireName} '
        '(§38.8.1 last_error_code)',
      );
    }
    if (!isErrorState(to) && errorCode != null) {
      throw ArgumentError(
        'errorCode is only valid for failure states, not ${to.wireName}',
      );
    }

    final DateTime eventTime = await _allocateLocalNow();
    int attemptCount = row.attemptCount;
    DateTime? lastAttemptAt = row.lastAttemptAt;
    if (to == SyncState.syncing) {
      // §38.8.1 attempt tracking: entering SYNCING *is* the attempt.
      attemptCount += 1;
      lastAttemptAt = eventTime;
    }

    await (_db.update(_db.outbox)..where((t) => t.mutationId.equals(mutationId)))
        .write(OutboxCompanion(
      syncState: Value(to.wireName),
      attemptCount: Value(attemptCount),
      lastAttemptAt: Value(lastAttemptAt),
      // Never cleared: it is the *last* classification seen (§38.8.1).
      lastErrorCode: Value(errorCode ?? row.lastErrorCode),
    ));

    await _db.into(_db.localAuditEvents).insert(
          LocalAuditEventsCompanion.insert(
            eventTime: eventTime,
            mutationId: mutationId,
            fromState: from.wireName,
            toState: to.wireName,
            attemptCount: attemptCount,
            errorCode: Value(errorCode),
          ),
        );

    return (_db.select(_db.outbox)..where((t) => t.mutationId.equals(mutationId))).getSingle();
  }

  // -------------------------------------------------------------------------
  // local_meta: device binding, gap-free sequence, monotonic clock.
  // -------------------------------------------------------------------------

  void _validateCommand(OutboxEnqueueCommand command) {
    if (command.aggregateType.trim().isEmpty) {
      throw ArgumentError('aggregateType must not be empty (§38.8.1)');
    }
    if (!isUuid(command.aggregateId)) {
      throw ArgumentError(
        'aggregateId must be a UUID (§38.8.1): ${command.aggregateId}',
      );
    }
    if (!isUuid(command.actorUserId)) {
      throw ArgumentError(
        'actorUserId must be a UUID (§38.8.1): ${command.actorUserId}',
      );
    }
    if (command.payloadVersion < 1) {
      throw ArgumentError.value(
        command.payloadVersion,
        'payloadVersion',
        'contract version of the payload must be >= 1 (§38.8.1)',
      );
    }
  }

  /// §38.8.1: `organization_id` and `device_id` from the device binding,
  /// never from user input — read here, validated as UUIDs, and thrown for
  /// when absent rather than defaulted.
  Future<({String organizationId, String deviceId})> _readBinding() async {
    final String? org = await _readMeta(organizationIdKey);
    final String? device = await _readMeta(deviceIdKey);
    if (org == null || org.isEmpty || device == null || device.isEmpty) {
      throw MissingDeviceBindingException(<String>[
        if (org == null || org.isEmpty) organizationIdKey,
        if (device == null || device.isEmpty) deviceIdKey,
      ]);
    }
    if (!isUuid(org)) {
      throw ArgumentError(
        '$organizationIdKey in local_meta is not a UUID: $org (§38.8.1)',
      );
    }
    if (!isUuid(device)) {
      throw ArgumentError(
        '$deviceIdKey in local_meta is not a UUID: $device (§38.8.1)',
      );
    }
    return (organizationId: org, deviceId: device);
  }

  /// Gap-free per-device counter, allocated inside the caller's transaction
  /// (§38.10.2). A rollback returns the number to the counter, because the
  /// counter row lives in the same transaction as the outbox row.
  Future<int> _allocateSequence() async {
    final String? raw = await _readMeta(sequenceCounterKey);
    final int next = (int.tryParse(raw ?? '') ?? 0) + 1;
    await _writeMeta(sequenceCounterKey, '$next');
    return next;
  }

  /// `local_created_at` with the persisted high-water monotonic guard
  /// (§38.8.1 "timestamp with monotonic guard"): a clock that jumps backward
  /// cannot re-issue a timestamp at or below one already handed out
  /// (§38.16.5).
  Future<DateTime> _allocateLocalNow() async {
    final String? raw = await _readMeta(localNowHighWaterKey);
    final int highWater = int.tryParse(raw ?? '') ?? -1;
    int milliseconds = DateTime.now().millisecondsSinceEpoch;
    if (milliseconds <= highWater) milliseconds = highWater + 1;
    await _writeMeta(localNowHighWaterKey, '$milliseconds');
    return DateTime.fromMillisecondsSinceEpoch(milliseconds);
  }

  Future<String?> _readMeta(String key) async {
    final query = _db.select(_db.localMeta)..where((t) => t.key.equals(key));
    final row = await query.getSingleOrNull();
    return row?.value;
  }

  Future<void> _writeMeta(String key, String value) {
    return _db.into(_db.localMeta).insert(
          LocalMetaCompanion.insert(key: key, value: value),
          mode: InsertMode.insertOrReplace,
        );
  }
}
