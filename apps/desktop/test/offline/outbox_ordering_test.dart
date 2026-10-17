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

  test('pendingForPush returns PENDING rows in gap-free sequence order '
      '(§38.10.1: local_sequence, not timestamp)', () async {
    final a = await repo.enqueue(testCommand());
    final b = await repo.enqueue(testCommand());
    final c = await repo.enqueue(testCommand());
    final d = await repo.enqueue(testCommand());

    final batch = await repo.pendingForPush();
    expect(
      batch.map((row) => row.mutationId),
      [a.mutationId, b.mutationId, c.mutationId, d.mutationId],
    );
    expect(
      batch.map((row) => row.deviceLocalSequence),
      [1, 2, 3, 4],
      reason: 'ascending, gap-free, mirrors order sent to the server (§38.8.4)',
    );
  });

  test('rows leave the push window while SYNCING and re-enter on PENDING',
      () async {
    final a = await repo.enqueue(testCommand());
    final b = await repo.enqueue(testCommand());
    final c = await repo.enqueue(testCommand());

    await repo.transition(mutationId: b.mutationId, to: SyncState.syncing);
    expect(
      (await repo.pendingForPush()).map((row) => row.mutationId),
      [a.mutationId, c.mutationId],
      reason: 'only PENDING rows are push-eligible (§38.13)',
    );

    await repo.transition(mutationId: b.mutationId, to: SyncState.pending);
    expect(
      (await repo.pendingForPush()).map((row) => row.mutationId),
      [a.mutationId, b.mutationId, c.mutationId],
    );
  });

  test('SYNCED, RETRYABLE_ERROR, CONFLICT, PERMANENT_REJECTED never '
      'appear in the push window', () async {
    final a = await repo.enqueue(testCommand());
    final b = await repo.enqueue(testCommand());
    final c = await repo.enqueue(testCommand());
    final d = await repo.enqueue(testCommand());

    await repo.transition(mutationId: a.mutationId, to: SyncState.syncing);
    await repo.transition(mutationId: a.mutationId, to: SyncState.synced);
    await repo.transition(mutationId: b.mutationId, to: SyncState.syncing);
    await repo.transition(
      mutationId: b.mutationId,
      to: SyncState.retryableError,
      errorCode: 'HTTP_503',
    );
    await repo.transition(mutationId: c.mutationId, to: SyncState.syncing);
    await repo.transition(
      mutationId: c.mutationId,
      to: SyncState.permanentRejected,
      errorCode: 'HTTP_422',
    );
    await repo.transition(mutationId: d.mutationId, to: SyncState.syncing);
    await repo.transition(
      mutationId: d.mutationId,
      to: SyncState.conflict,
      errorCode: 'HTTP_409',
    );

    expect(await repo.pendingForPush(), isEmpty);
  });

  test('batch size honours the §38.10.1 maximum of 50 and validates bounds',
      () async {
    expect(OutboxRepository.maxPushBatchSize, 50,
        reason: '§38.10.1 pins the transport batch at 50');

    for (var i = 0; i < 55; i++) {
      await repo.enqueue(testCommand());
    }

    expect((await repo.pendingForPush()).length, 50);
    expect((await repo.pendingForPush(limit: 10)).length, 10);
    expect(
      (await repo.pendingForPush(limit: 10)).first.deviceLocalSequence,
      1,
      reason: 'the window always starts at the oldest eligible mutation',
    );

    expect(() => repo.pendingForPush(limit: 0), throwsArgumentError);
    expect(() => repo.pendingForPush(limit: 51), throwsArgumentError);
    expect(() => repo.pendingForPush(limit: -1), throwsArgumentError);
  });

  test('countsByState accounts for every state with no drift', () async {
    final a = await repo.enqueue(testCommand());
    final b = await repo.enqueue(testCommand());
    await repo.transition(mutationId: a.mutationId, to: SyncState.syncing);
    await repo.transition(mutationId: a.mutationId, to: SyncState.synced);
    await repo.transition(mutationId: b.mutationId, to: SyncState.syncing);
    await repo.transition(
      mutationId: b.mutationId,
      to: SyncState.retryableError,
      errorCode: 'TIMEOUT',
    );

    final counts = await repo.countsByState();
    expect(counts, hasLength(SyncState.values.length));
    expect(counts.keys, containsAll(SyncState.values));
    expect(counts.values.fold<int>(0, (sum, n) => sum + n), 2);
    expect(counts[SyncState.synced], 1);
    expect(counts[SyncState.retryableError], 1);
    expect(counts[SyncState.localOnly], 0);
  });
}
