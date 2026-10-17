import 'dart:convert';
import 'dart:math';

import 'package:drift/drift.dart' hide isNull;
import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/operation_type.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_errors.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';
import 'package:my_shop_desktop/core/offline/outbox/sync_state.dart';
import 'package:my_shop_desktop/core/offline/outbox/uuid_v7.dart';

import 'outbox_test_harness.dart';

void main() {
  late AppDatabase db;
  late OutboxRepository repo;

  setUp(() {
    db = openMemoryDatabase();
    repo = OutboxRepository(db);
  });

  tearDown(() async {
    await db.close();
  });

  Future<String> meta(String key) async {
    final query = db.select(db.localMeta)..where((t) => t.key.equals(key));
    final row = await query.getSingleOrNull();
    return row?.value ?? '';
  }

  /// Every required §38.8.1 field lands on the row, with the §38.13
  /// `LOCAL_ONLY → PENDING` promotion applied by the writer.
  test('enqueue writes every §38.8.1 field with contract wire names', () async {
    await seedDeviceBinding(db);
    final outbox = await repo.enqueue(testCommand());

    expect(isUuidV7(outbox.mutationId), isTrue);
    expect(outbox.organizationId, testOrganizationId);
    expect(outbox.deviceId, testDeviceId);
    expect(outbox.actorUserId, testActorUserId);
    expect(outbox.aggregateType, 'SALE');
    expect(outbox.aggregateId, testAggregateId);
    expect(outbox.operationType, 'CREATE');
    expect(outbox.payloadVersion, 1);
    expect(outbox.syncState, 'PENDING');
    expect(outbox.attemptCount, 0);
    expect(outbox.lastErrorCode, isNull);
    expect(outbox.lastAttemptAt, isNull);
    expect(outbox.deviceIdempotencyKey, outbox.mutationId,
        reason: '§38.8.1: the idempotency key is mutation_id, duplicated');

    final Map<String, Object?> payload =
        jsonDecode(outbox.payload) as Map<String, Object?>;
    expect(payload, testCommand().payload);
    final Map<String, Object?> snapshot =
        jsonDecode(outbox.actorRoleSnapshot) as Map<String, Object?>;
    expect(snapshot, testCommand().actorRoleSnapshot);
  });

  test('local_created_at honors the persisted monotonic high-water guard',
      () async {
    await seedDeviceBinding(db);
    final int futureMs = DateTime.now().millisecondsSinceEpoch + 60000;
    await db.into(db.localMeta).insert(
          LocalMetaCompanion.insert(
            key: OutboxRepository.localNowHighWaterKey,
            value: '$futureMs',
          ),
          mode: InsertMode.insertOrReplace,
        );

    final first = await repo.enqueue(testCommand());
    final second = await repo.enqueue(testCommand());

    // Stored at second granularity (drift unix-seconds mapping), so the guard
    // is asserted at the precision the database can hold.
    expect(first.localCreatedAt.millisecondsSinceEpoch,
        greaterThanOrEqualTo((futureMs ~/ 1000) * 1000));
    expect(second.localCreatedAt.millisecondsSinceEpoch,
        greaterThanOrEqualTo((futureMs ~/ 1000) * 1000));
    expect(second.localCreatedAt.isBefore(first.localCreatedAt), isFalse,
        reason: 'a backward clock must never re-issue an earlier timestamp');
    expect(await meta(OutboxRepository.localNowHighWaterKey), isNotEmpty);
  });

  test('device_local_sequence is gap-free and survives in local_meta',
      () async {
    await seedDeviceBinding(db);
    final a = await repo.enqueue(testCommand());
    final b = await repo.enqueue(testCommand());
    final c = await repo.enqueue(testCommand());

    expect([a.deviceLocalSequence, b.deviceLocalSequence, c.deviceLocalSequence],
        [1, 2, 3]);
    expect(await meta(OutboxRepository.sequenceCounterKey), '3');
  });

  test('a rolled-back transaction returns its sequence numbers to the counter',
      () async {
    await seedDeviceBinding(db);

    await expectLater(
      db.transaction(() async {
        await repo.enqueue(testCommand());
        await repo.enqueue(testCommand());
        throw StateError('simulated business-transaction failure');
      }),
      throwsStateError,
    );

    expect(await db.select(db.outbox).get(), isEmpty,
        reason: 'no outbox row may survive a rolled-back transaction (§38.7.1)');
    expect(await db.select(db.localAuditEvents).get(), isEmpty);
    expect(await meta(OutboxRepository.sequenceCounterKey), '',
        reason: 'the counter is part of the same transaction (§38.10.2)');

    final survivor = await repo.enqueue(testCommand());
    expect(survivor.deviceLocalSequence, 1,
        reason: 'rollback must leave no gap (§38.10.2)');
  });

  test('the database enforces sequence uniqueness, not only the app', () async {
    await seedDeviceBinding(db);
    final first = await repo.enqueue(testCommand());

    Future<void> duplicate() => db.into(db.outbox).insert(
          OutboxCompanion.insert(
            mutationId: generateUuidV7(),
            organizationId: testOrganizationId,
            deviceId: testDeviceId,
            actorUserId: testActorUserId,
            actorRoleSnapshot: '{}',
            aggregateType: 'SALE',
            aggregateId: testAggregateId,
            operationType: 'CREATE',
            payload: '{}',
            payloadVersion: 1,
            deviceLocalSequence: first.deviceLocalSequence,
            localCreatedAt: DateTime.now(),
            syncState: SyncState.pending.wireName,
            deviceIdempotencyKey: generateUuidV7(),
          ),
        );

    await expectLater(
      duplicate(),
      throwsA(predicate((Object e) => e.toString().contains('UNIQUE constraint failed'))),
    );
  });

  test('enqueue without device binding refuses rather than invents ids',
      () async {
    await expectLater(
      repo.enqueue(testCommand()),
      throwsA(isA<MissingDeviceBindingException>()),
    );
    expect(await db.select(db.outbox).get(), isEmpty);

    await seedDeviceBinding(db, deviceId: '');
    await expectLater(
      repo.enqueue(testCommand()),
      throwsA(isA<MissingDeviceBindingException>()),
    );
    expect(await db.select(db.outbox).get(), isEmpty);
  });

  test('a non-UUID binding value is rejected (§38.8.1 never from user input)',
      () async {
    await seedDeviceBinding(db, organizationId: 'not-a-uuid');
    await expectLater(
      repo.enqueue(testCommand()),
      throwsA(isA<ArgumentError>()),
    );
    expect(await db.select(db.outbox).get(), isEmpty);
  });

  test('command validation rejects malformed attribution before any write',
      () async {
    await seedDeviceBinding(db);

    expect(() => repo.enqueue(testCommand(aggregateId: 'nope')),
        throwsArgumentError);
    expect(() => repo.enqueue(testCommand(actorUserId: '42')),
        throwsArgumentError);
    expect(() => repo.enqueue(testCommand(payloadVersion: 0)),
        throwsArgumentError);
    expect(() => repo.enqueue(testCommand(aggregateType: '   ')),
        throwsArgumentError);
    expect(await db.select(db.outbox).get(), isEmpty);
  });

  test('operation_type admits exactly the closed set of §38.8.1', () {
    expect(
      OperationType.values.map((op) => op.wireName),
      ['CREATE', 'VOID', 'RETURN', 'REVERSE'],
      reason: 'mirrors OPERATION_TYPES of the M1b-S2 sync contract',
    );
    expect(OperationType.fromWire('RETURN'), OperationType.returnOperation);
    expect(
      () => OperationType.fromWire('DELETE'),
      throwsA(isA<UnknownOperationTypeException>()),
    );
  });

  test('sync_state vocabulary is pinned to the seven §38.13 states', () {
    expect(
      SyncState.values.map((s) => s.wireName),
      [
        'LOCAL_ONLY',
        'PENDING',
        'SYNCING',
        'SYNCED',
        'RETRYABLE_ERROR',
        'CONFLICT',
        'PERMANENT_REJECTED',
      ],
      reason: 'mirrors SYNC_STATES of the M1b-S2 sync contract, in order',
    );
    expect(
      () => SyncState.fromWire('IS_SYNCED'),
      throwsA(isA<UnknownSyncStateException>()),
    );
  });

  test('operation_type round-trips every value through the writer', () async {
    await seedDeviceBinding(db);
    for (final operation in OperationType.values) {
      final row = await repo.enqueue(testCommand(operationType: operation));
      expect(row.operationType, operation.wireName);
      expect(OperationType.fromWire(row.operationType), operation);
    }
  });

  test('UUIDv7 is version-7, unique, and time-ordered', () {
    final String sample = generateUuidV7(
      time: DateTime.fromMillisecondsSinceEpoch(1767225600000, isUtc: true),
      random: Random(42),
    );
    expect(isUuidV7(sample), isTrue, reason: 'version nibble 7, variant 10xx');

    final earlier = generateUuidV7(
      time: DateTime.fromMillisecondsSinceEpoch(1767225600000, isUtc: true),
      random: Random(1),
    );
    final later = generateUuidV7(
      time: DateTime.fromMillisecondsSinceEpoch(1767225601000, isUtc: true),
      random: Random(2),
    );
    expect(earlier.compareTo(later), lessThan(0),
        reason: '48-bit millisecond prefix sorts in time order');

    final ids = <String>{for (var i = 0; i < 10000; i++) generateUuidV7()};
    expect(ids.length, 10000, reason: 'no collisions under a burst');
  });
}
