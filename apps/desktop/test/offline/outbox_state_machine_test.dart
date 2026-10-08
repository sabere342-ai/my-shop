import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_errors.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';
import 'package:my_shop_desktop/core/offline/outbox/sync_state.dart';

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

  Future<OutboxData> enqueueFresh() async {
    await seedDeviceBinding(db);
    return repo.enqueue(testCommand());
  }

  group('§38.13 legal path', () {
    test('enqueue records LOCAL_ONLY → PENDING in the audit log', () async {
      final row = await enqueueFresh();
      expect(row.syncState, 'PENDING');
      expect(row.attemptCount, 0);

      final events = await db.select(db.localAuditEvents).get();
      expect(events, hasLength(1));
      expect(events.single.fromState, 'LOCAL_ONLY');
      expect(events.single.toState, 'PENDING');
      expect(events.single.mutationId, row.mutationId);
      expect(events.single.attemptCount, 0);
      expect(events.single.errorCode, isNull);
      expect(events.single.eventTime, isNotNull);
    });

    test('PENDING → SYNCING → SYNCED with attempt tracking and audit',
        () async {
      final row = await enqueueFresh();

      final syncing = await repo.transition(
        mutationId: row.mutationId,
        to: SyncState.syncing,
      );
      expect(syncing.syncState, 'SYNCING');
      expect(syncing.attemptCount, 1);
      expect(syncing.lastAttemptAt, isNotNull);

      final synced = await repo.transition(
        mutationId: row.mutationId,
        to: SyncState.synced,
      );
      expect(synced.syncState, 'SYNCED');
      expect(synced.attemptCount, 1,
          reason: 'acknowledgement is not an attempt');
      expect(synced.lastErrorCode, isNull);

      final events = await db.select(db.localAuditEvents).get();
      expect(
        events.map((e) => '${e.fromState}->${e.toState}').toList(),
        ['LOCAL_ONLY->PENDING', 'PENDING->SYNCING', 'SYNCING->SYNCED'],
      );
      expect(events.last.attemptCount, 1);
    });

    test('retry cycle: failure records the code, eligibility restores PENDING',
        () async {
      final row = await enqueueFresh();
      await repo.transition(mutationId: row.mutationId, to: SyncState.syncing);

      final failed = await repo.transition(
        mutationId: row.mutationId,
        to: SyncState.retryableError,
        errorCode: 'HTTP_503',
      );
      expect(failed.syncState, 'RETRYABLE_ERROR');
      expect(failed.lastErrorCode, 'HTTP_503');

      final eligible = await repo.transition(
        mutationId: row.mutationId,
        to: SyncState.pending,
      );
      expect(eligible.syncState, 'PENDING');
      expect(eligible.lastErrorCode, 'HTTP_503',
          reason: '§38.8.1: last_error_code is the *last* classification');

      final retried = await repo.transition(
        mutationId: row.mutationId,
        to: SyncState.syncing,
      );
      expect(retried.attemptCount, 2, reason: 'each SYNCING entry counts');
      expect(retried.lastErrorCode, 'HTTP_503');
    });

    test('permanent rejection and conflict require an error code', () async {
      final row = await enqueueFresh();
      await repo.transition(mutationId: row.mutationId, to: SyncState.syncing);

      await expectLater(
        repo.transition(
          mutationId: row.mutationId,
          to: SyncState.permanentRejected,
        ),
        throwsA(isA<ArgumentError>()),
      );
      final rejected = await repo.transition(
        mutationId: row.mutationId,
        to: SyncState.permanentRejected,
        errorCode: 'HTTP_422',
      );
      expect(rejected.syncState, 'PERMANENT_REJECTED');
      expect(rejected.lastErrorCode, 'HTTP_422');
      expect(rejected.attemptCount, 1);

      await expectLater(
        repo.transition(mutationId: row.mutationId, to: SyncState.synced),
        throwsA(isA<IllegalSyncTransitionException>()),
        reason: 'PERMANENT_REJECTED awaits owner resolution (§38.13)',
      );
    });
  });

  group('§38.13 illegal transitions are refused without writing', () {
    test('SYNCED is terminal', () async {
      final row = await enqueueFresh();
      await repo.transition(mutationId: row.mutationId, to: SyncState.syncing);
      await repo.transition(mutationId: row.mutationId, to: SyncState.synced);

      final eventsBefore = (await db.select(db.localAuditEvents).get()).length;
      for (final to in SyncState.values) {
        await expectLater(
          repo.transition(mutationId: row.mutationId, to: to),
          throwsA(isA<IllegalSyncTransitionException>()),
          reason: 'SYNCED has no outgoing edge in §38.13',
        );
      }
      final after = await repo.requireById(row.mutationId);
      expect(after.syncState, 'SYNCED');
      expect((await db.select(db.localAuditEvents).get()).length, eventsBefore,
          reason: 'a refused transition appends no audit event');
    });

    test('PENDING cannot jump straight to SYNCED', () async {
      final row = await enqueueFresh();
      await expectLater(
        repo.transition(mutationId: row.mutationId, to: SyncState.synced),
        throwsA(isA<IllegalSyncTransitionException>()),
      );
      expect((await repo.requireById(row.mutationId)).syncState, 'PENDING');
    });

    test('LOCAL_ONLY only promotes to PENDING', () async {
      const String stuck = '55555555-5555-4555-8555-555555555555';
      await insertInState(db, stuck, SyncState.localOnly);
      for (final to in SyncState.values.where((s) => s != SyncState.pending)) {
        await expectLater(
          repo.transition(mutationId: stuck, to: to),
          throwsA(isA<IllegalSyncTransitionException>()),
        );
      }
      final promoted =
          await repo.transition(mutationId: stuck, to: SyncState.pending);
      expect(promoted.syncState, 'PENDING');
    });

    test('RETRYABLE_ERROR only returns to PENDING', () async {
      const String id = '66666666-6666-4666-8666-666666666666';
      await insertInState(db, id, SyncState.retryableError);
      for (final to in SyncState.values.where((s) => s != SyncState.pending)) {
        await expectLater(
          repo.transition(mutationId: id, to: to),
          throwsA(isA<IllegalSyncTransitionException>()),
        );
      }
    });

    test('CONFLICT and PERMANENT_REJECTED await owner resolution', () async {
      const String conflict = '77777777-7777-4777-8777-777777777777';
      const String rejected = '88888888-8888-4888-8888-888888888888';
      await insertInState(db, conflict, SyncState.conflict, deviceLocalSequence: 1);
      await insertInState(db, rejected, SyncState.permanentRejected, deviceLocalSequence: 2);
      for (final to in SyncState.values) {
        await expectLater(
          repo.transition(mutationId: conflict, to: to),
          throwsA(isA<IllegalSyncTransitionException>()),
        );
        await expectLater(
          repo.transition(mutationId: rejected, to: to),
          throwsA(isA<IllegalSyncTransitionException>()),
        );
      }
    });

    test('an unknown mutation id is not silently created', () async {
      await expectLater(
        repo.transition(
          mutationId: '99999999-9999-4999-8999-999999999999',
          to: SyncState.pending,
        ),
        throwsA(isA<OutboxRecordNotFoundException>()),
      );
    });
  });

  group('bookkeeping-only updates (§38.8.2 append-only payload)', () {
    test('every transition leaves identity, attribution, and payload byte-equal',
        () async {
      final before = await enqueueFresh();

      await repo.transition(mutationId: before.mutationId, to: SyncState.syncing);
      final afterFailure = await repo.transition(
        mutationId: before.mutationId,
        to: SyncState.retryableError,
        errorCode: 'TIMEOUT',
      );
      final afterRetry = await repo.transition(
        mutationId: before.mutationId,
        to: SyncState.pending,
      );

      for (final after in [afterFailure, afterRetry]) {
        expect(after.mutationId, before.mutationId);
        expect(after.organizationId, before.organizationId);
        expect(after.deviceId, before.deviceId);
        expect(after.actorUserId, before.actorUserId);
        expect(after.actorRoleSnapshot, before.actorRoleSnapshot);
        expect(after.aggregateType, before.aggregateType);
        expect(after.aggregateId, before.aggregateId);
        expect(after.operationType, before.operationType);
        expect(after.payload, before.payload,
            reason: '§38.8.2: payload is append-only after commit');
        expect(after.payloadVersion, before.payloadVersion);
        expect(after.deviceLocalSequence, before.deviceLocalSequence);
        expect(after.localCreatedAt, before.localCreatedAt,
            reason: 'creation timestamp is never rewritten');
        expect(after.deviceIdempotencyKey, before.deviceIdempotencyKey);
      }
    });

    test('errorCode is refused on non-failure transitions', () async {
      final row = await enqueueFresh();
      await expectLater(
        repo.transition(
          mutationId: row.mutationId,
          to: SyncState.syncing,
          errorCode: 'WHY_NOT',
        ),
        throwsA(isA<ArgumentError>()),
      );
      expect((await repo.requireById(row.mutationId)).syncState, 'PENDING');

      await repo.transition(mutationId: row.mutationId, to: SyncState.syncing);
      await repo.transition(
        mutationId: row.mutationId,
        to: SyncState.retryableError,
        errorCode: 'HTTP_503',
      );
      await expectLater(
        repo.transition(
          mutationId: row.mutationId,
          to: SyncState.pending,
          errorCode: 'WHY_NOT',
        ),
        throwsA(isA<ArgumentError>()),
        reason: 'RETRYABLE_ERROR → PENDING is a legal edge, so the refusal '
            'must come from the errorCode rule, not the state machine',
      );
      expect((await repo.requireById(row.mutationId)).syncState,
          'RETRYABLE_ERROR');
    });
  });

  test('allowedSyncTransitions matches §38.13 exactly', () {
    expect(canTransition(SyncState.localOnly, SyncState.pending), isTrue);
    expect(canTransition(SyncState.pending, SyncState.syncing), isTrue);
    expect(canTransition(SyncState.syncing, SyncState.synced), isTrue);
    expect(canTransition(SyncState.syncing, SyncState.retryableError), isTrue);
    expect(canTransition(SyncState.syncing, SyncState.pending), isTrue);
    expect(canTransition(SyncState.syncing, SyncState.conflict), isTrue);
    expect(canTransition(SyncState.syncing, SyncState.permanentRejected), isTrue);
    expect(canTransition(SyncState.retryableError, SyncState.pending), isTrue);

    expect(canTransition(SyncState.synced, SyncState.synced), isFalse);
    expect(canTransition(SyncState.pending, SyncState.synced), isFalse);
    expect(canTransition(SyncState.localOnly, SyncState.syncing), isFalse);
    expect(canTransition(SyncState.retryableError, SyncState.syncing), isFalse);
    expect(canTransition(SyncState.conflict, SyncState.pending), isFalse);
    expect(canTransition(SyncState.permanentRejected, SyncState.pending),
        isFalse);
  });
}
