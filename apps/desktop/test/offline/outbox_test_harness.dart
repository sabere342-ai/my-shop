import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/operation_type.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';
import 'package:my_shop_desktop/core/offline/outbox/sync_state.dart';

// ---------------------------------------------------------------------------
// Deterministic identities (§38.8.1 requires UUIDs; these are fixed, valid,
// version-4-shaped literals so failures read the same on every machine).
// ---------------------------------------------------------------------------

const String testOrganizationId = '11111111-1111-4111-8111-111111111111';
const String testDeviceId = '22222222-2222-4222-8222-222222222222';
const String testActorUserId = '33333333-3333-4333-8333-333333333333';
const String testAggregateId = '44444444-4444-4444-8444-444444444444';

/// A database on no disk at all — the default for behavioural tests.
AppDatabase openMemoryDatabase() => AppDatabase.forTesting(NativeDatabase.memory());

/// Writes the device binding the writer refuses to work without (§38.8.1).
Future<void> seedDeviceBinding(
  AppDatabase db, {
  String organizationId = testOrganizationId,
  String deviceId = testDeviceId,
}) async {
  await db.into(db.localMeta).insert(
        LocalMetaCompanion.insert(
          key: OutboxRepository.organizationIdKey,
          value: organizationId,
        ),
        mode: InsertMode.insertOrReplace,
      );
  await db.into(db.localMeta).insert(
        LocalMetaCompanion.insert(
          key: OutboxRepository.deviceIdKey,
          value: deviceId,
        ),
        mode: InsertMode.insertOrReplace,
      );
}

/// A typical sale mutation (§38.24.2's payload is business-shaped; the outbox
/// itself only requires a non-trivial JSON object).
OutboxEnqueueCommand testCommand({
  String aggregateType = 'SALE',
  String aggregateId = testAggregateId,
  OperationType operationType = OperationType.create,
  Map<String, Object?> payload = const <String, Object?>{
    'saleNo': 'S-000123',
    'totalMinor': 1250,
  },
  int payloadVersion = 1,
  String actorUserId = testActorUserId,
  Map<String, Object?> actorRoleSnapshot = const <String, Object?>{
    'permissions': <Object?>['sales.create'],
    'permissionsVersion': 3,
  },
}) {
  return OutboxEnqueueCommand(
    aggregateType: aggregateType,
    aggregateId: aggregateId,
    operationType: operationType,
    payload: payload,
    payloadVersion: payloadVersion,
    actorUserId: actorUserId,
    actorRoleSnapshot: actorRoleSnapshot,
  );
}

/// drift persists [DateTime] columns as unix **seconds**
/// (`mapping.dart`: `millisecondsSinceEpoch ~/ 1000`), so every stored
/// timestamp reads back second-truncated. Tests assert at that granularity.
int storedMillis(DateTime value) => (value.millisecondsSinceEpoch ~/ 1000) * 1000;

/// Pins a row in an arbitrary state, bypassing the writer — the way an
/// adversarial or corrupted database row would look (§38.26 T-O21).
Future<void> insertInState(
  AppDatabase db,
  String mutationId,
  SyncState state, {
  int deviceLocalSequence = 99,
  DateTime? localCreatedAt,
  DateTime? lastAttemptAt,
}) {
  return db.into(db.outbox).insert(
        OutboxCompanion.insert(
          mutationId: mutationId,
          organizationId: testOrganizationId,
          deviceId: testDeviceId,
          actorUserId: testActorUserId,
          actorRoleSnapshot: '{"permissions":[]}',
          aggregateType: 'SALE',
          aggregateId: testAggregateId,
          operationType: 'CREATE',
          payload: '{"saleNo":"S-1"}',
          payloadVersion: 1,
          deviceLocalSequence: deviceLocalSequence,
          localCreatedAt: localCreatedAt ?? DateTime.now(),
          syncState: state.wireName,
          deviceIdempotencyKey: mutationId,
          lastAttemptAt: Value(lastAttemptAt),
        ),
      );
}

/// Seeds a completed row plus the SYNCED audit event that defines its
/// acknowledgement time — the reference clock for F-17 compaction.
Future<void> seedSyncedRow(
  AppDatabase db,
  String mutationId, {
  required int deviceLocalSequence,
  required DateTime ackTime,
  DateTime? localCreatedAt,
}) async {
  await insertInState(
    db,
    mutationId,
    SyncState.synced,
    deviceLocalSequence: deviceLocalSequence,
    localCreatedAt: localCreatedAt ?? ackTime,
  );
  await db.into(db.localAuditEvents).insert(
        LocalAuditEventsCompanion.insert(
          eventTime: ackTime,
          mutationId: mutationId,
          fromState: SyncState.syncing.wireName,
          toState: SyncState.synced.wireName,
          attemptCount: 1,
        ),
      );
}
