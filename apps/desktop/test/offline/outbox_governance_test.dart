import 'package:drift/drift.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';
import 'package:my_shop_desktop/core/offline/outbox/sync_state.dart';

import 'outbox_test_harness.dart';

void main() {
  late AppDatabase db;
  late OutboxRepository repo;

  setUp(() async {
    db = openMemoryDatabase();
    repo = OutboxRepository(db);
    await seedDeviceBinding(db);
  });

  tearDown(() async {
    await db.close();
  });

  test('T-O21: SYNCED is unreachable from every state except SYNCING', () async {
    const String prefix = 'aaaaaaaa-aaaa-4aaa-8aaa-';
    var counter = 0;
    for (final from in SyncState.values) {
      if (from == SyncState.syncing) continue;
      final String mutationId = '$prefix${'${counter++}'.padLeft(12, '0')}';
      await insertInState(db, mutationId, from, deviceLocalSequence: counter);

      final eventsBefore =
          (await db.select(db.localAuditEvents).get()).length;
      await expectLater(
        repo.transition(mutationId: mutationId, to: SyncState.synced),
        throwsA(isA<IllegalSyncTransitionException>()),
        reason: 'no code path marks a mutation synced except a server ack '
            'arriving during push (§38.13)',
      );
      expect((await repo.requireById(mutationId)).syncState, from.wireName);
      expect(
        (await db.select(db.localAuditEvents).get()).length,
        eventsBefore,
        reason: 'a refused transition appends no audit event',
      );
    }
  });

  test('T-O21: one audit event per transition, in chain order, with the '
      'attempt count the row carries', () async {
    final first = await repo.enqueue(testCommand());
    await repo.transition(mutationId: first.mutationId, to: SyncState.syncing);
    await repo.transition(mutationId: first.mutationId, to: SyncState.synced);

    final second = await repo.enqueue(testCommand());
    await repo.transition(mutationId: second.mutationId, to: SyncState.syncing);
    await repo.transition(
      mutationId: second.mutationId,
      to: SyncState.retryableError,
      errorCode: 'HTTP_503',
    );
    await repo.transition(mutationId: second.mutationId, to: SyncState.pending);
    await repo.transition(mutationId: second.mutationId, to: SyncState.syncing);

    final events = await db.select(db.localAuditEvents).get();
    expect(events, hasLength(8),
        reason: '2 enqueues + 6 transitions = 8 events, no gaps, no doubles');

    List<String> chain(String mutationId) => events
        .where((e) => e.mutationId == mutationId)
        .map((e) => '${e.fromState}->${e.toState}')
        .toList();

    expect(chain(first.mutationId), [
      'LOCAL_ONLY->PENDING',
      'PENDING->SYNCING',
      'SYNCING->SYNCED',
    ]);
    expect(chain(second.mutationId), [
      'LOCAL_ONLY->PENDING',
      'PENDING->SYNCING',
      'SYNCING->RETRYABLE_ERROR',
      'RETRYABLE_ERROR->PENDING',
      'PENDING->SYNCING',
    ]);
  });

  test('T-O21: attemptCount in the audit log equals the row attemptCount at '
      'that moment', () async {
    final row = await repo.enqueue(testCommand());
    await repo.transition(mutationId: row.mutationId, to: SyncState.syncing);
    await repo.transition(
      mutationId: row.mutationId,
      to: SyncState.retryableError,
      errorCode: 'TIMEOUT',
    );
    await repo.transition(mutationId: row.mutationId, to: SyncState.pending);
    final second = await repo.transition(mutationId: row.mutationId, to: SyncState.syncing);

    final events = await (db.select(db.localAuditEvents)
          ..orderBy([
            (t) => OrderingTerm.asc(t.eventTime),
            (t) => OrderingTerm.asc(t.id),
          ]))
        .get();
    expect(events.map((e) => e.attemptCount), [0, 1, 1, 1, 2]);
    expect(second.attemptCount, 2);
  });
}
