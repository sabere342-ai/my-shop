import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_compactor.dart';
import 'package:my_shop_desktop/core/offline/outbox/sync_state.dart';

import 'outbox_test_harness.dart';

void main() {
  late AppDatabase db;
  late OutboxCompactor compactor;

  final DateTime now = DateTime.now();
  final DateTime hundredDaysAgo = now.subtract(const Duration(days: 100));
  final DateTime thirtyDaysAgo = now.subtract(const Duration(days: 30));

  setUp(() async {
    db = openMemoryDatabase();
    compactor = OutboxCompactor(db);
    await seedDeviceBinding(db);
  });

  tearDown(() async {
    await db.close();
  });

  test('F-17: SYNCED rows older than the acknowledgement cutoff are removed',
      () async {
    await seedSyncedRow(db, 'old-1', deviceLocalSequence: 1, ackTime: hundredDaysAgo);
    await seedSyncedRow(db, 'old-2', deviceLocalSequence: 2, ackTime: hundredDaysAgo);
    await seedSyncedRow(db, 'recent', deviceLocalSequence: 3, ackTime: thirtyDaysAgo);

    final report = await compactor.compactSyncedBefore(
      cutoff: now.subtract(const Duration(days: 90)),
      auditFloor: 0,
    );

    expect(report.deleted, 2);
    expect(report.retainedForAudit, 0);
    final survivors = (await db.select(db.outbox).get()).map((r) => r.mutationId);
    expect(survivors, ['recent']);
  });

  test('F-17: the audit floor preserves the newest N completed mutations '
      'even when they are past the cutoff', () async {
    await seedSyncedRow(db, 'oldest', deviceLocalSequence: 1, ackTime: hundredDaysAgo);
    await seedSyncedRow(db, 'middle', deviceLocalSequence: 2, ackTime: hundredDaysAgo);
    await seedSyncedRow(db, 'newest', deviceLocalSequence: 3, ackTime: hundredDaysAgo);

    final report = await compactor.compactSyncedBefore(
      cutoff: now,
      auditFloor: 2,
    );

    expect(report.deleted, 1, reason: 'only the oldest falls below the floor');
    expect(report.retainedForAudit, 2);
    final survivors = (await db.select(db.outbox).get()).map((r) => r.mutationId);
    expect(survivors, ['middle', 'newest'],
        reason: '§38.25: floor honours by acknowledgement, newest kept');
  });

  test('F-17: only SYNCED rows are ever eligible — in-flight work is '
      'untouched even when ancient', () async {
    final ancient = now.subtract(const Duration(days: 400));
    await insertInState(db, 'p1', SyncState.localOnly, deviceLocalSequence: 1, localCreatedAt: ancient);
    await insertInState(db, 'p2', SyncState.pending, deviceLocalSequence: 2, localCreatedAt: ancient);
    await insertInState(db, 'p3', SyncState.syncing, deviceLocalSequence: 3, localCreatedAt: ancient);
    await insertInState(db, 'p4', SyncState.retryableError, deviceLocalSequence: 4, localCreatedAt: ancient);
    await insertInState(db, 'p5', SyncState.conflict, deviceLocalSequence: 5, localCreatedAt: ancient);
    await insertInState(db, 'p6', SyncState.permanentRejected, deviceLocalSequence: 6, localCreatedAt: ancient);
    await seedSyncedRow(db, 'p7', deviceLocalSequence: 7, ackTime: ancient);

    final report = await compactor.compactSyncedBefore(
      cutoff: now,
      auditFloor: 0,
    );

    expect(report.deleted, 1, reason: 'only p7 (SYNCED) may be removed');
    final survivors = (await db.select(db.outbox).get()).map((r) => r.mutationId);
    expect(survivors.toSet(), {'p1', 'p2', 'p3', 'p4', 'p5', 'p6'});
  });

  test('F-17: age is measured from the SYNCED acknowledgement event, '
      'not from local_created_at (§38.25)', () async {
    await seedSyncedRow(
      db,
      'long-pending',
      deviceLocalSequence: 1,
      localCreatedAt: now.subtract(const Duration(days: 200)),
      ackTime: thirtyDaysAgo,
    );

    final report = await compactor.compactSyncedBefore(
      cutoff: now.subtract(const Duration(days: 90)),
      auditFloor: 0,
    );

    expect(report.deleted, 0, reason: 'acknowledged 30 days ago, so it stays');
    expect(await db.select(db.outbox).get(), hasLength(1));
  });

  test('F-17: compaction never touches the audit log (§32.2A append-only)',
      () async {
    await seedSyncedRow(db, 'old', deviceLocalSequence: 1, ackTime: hundredDaysAgo);
    await seedSyncedRow(db, 'new', deviceLocalSequence: 2, ackTime: thirtyDaysAgo);
    final before = (await db.select(db.localAuditEvents).get()).length;

    await compactor.compactSyncedBefore(cutoff: now, auditFloor: 0);

    expect((await db.select(db.localAuditEvents).get()).length, before);
  });

  test('F-17: compactSynced uses the sliced defaults (90 days, floor 1000) '
      'and the floor outranks age', () async {
    expect(OutboxCompactor.defaultRetention, const Duration(days: 90));
    expect(OutboxCompactor.defaultAuditFloor, 1000);

    await seedSyncedRow(db, 'old', deviceLocalSequence: 1, ackTime: hundredDaysAgo);
    await seedSyncedRow(db, 'recent', deviceLocalSequence: 2, ackTime: thirtyDaysAgo);

    final report = await compactor.compactSynced();

    expect(report.scannedSynced, 2);
    expect(report.retainedForAudit, 2,
        reason: 'with only two rows, both sit inside the newest 1 000');
    expect(report.deleted, 0,
        reason: 'the audit floor outranks age (§38.25 "never unbounded")');
    expect(await db.select(db.outbox).get(), hasLength(2));
  });

  test('F-17: past the floor, the defaults delete exactly the overhang', () async {
    for (var i = 1; i <= 5; i++) {
      await seedSyncedRow(db, 'old-$i', deviceLocalSequence: i, ackTime: hundredDaysAgo);
    }
    for (var i = 6; i <= 8; i++) {
      await seedSyncedRow(db, 'recent-$i', deviceLocalSequence: i, ackTime: thirtyDaysAgo);
    }

    final report = await compactor.compactSynced(auditFloor: 5);

    expect(report.scannedSynced, 8);
    expect(report.retainedForAudit, 5);
    expect(report.deleted, 3,
        reason: 'three old rows fall outside the newest five');
    final survivors = (await db.select(db.outbox).get()).map((r) => r.mutationId);
    expect(survivors.toSet(), {
      'old-4',
      'old-5',
      'recent-6',
      'recent-7',
      'recent-8',
    });
  });

  test('F-17: a zero floor means no acknowledgement-floor protection', () async {
    await seedSyncedRow(db, 'old', deviceLocalSequence: 1, ackTime: hundredDaysAgo);
    final report = await compactor.compactSyncedBefore(
      cutoff: now,
      auditFloor: 0,
    );
    expect(report.deleted, 1);
    expect(report.retainedForAudit, 0);
  });

  test('F-17: invalid arguments are refused before any delete', () async {
    await seedSyncedRow(db, 'old', deviceLocalSequence: 1, ackTime: hundredDaysAgo);

    expect(
      () => compactor.compactSyncedBefore(cutoff: now, auditFloor: -1),
      throwsArgumentError,
    );
    expect(
      () => compactor.compactSynced(retention: Duration.zero, auditFloor: 0),
      throwsArgumentError,
    );
    expect(await db.select(db.outbox).get(), hasLength(1));
  });
}
