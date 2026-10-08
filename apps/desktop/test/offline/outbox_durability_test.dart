import 'dart:convert';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';
import 'package:my_shop_desktop/core/offline/outbox/sync_state.dart';
import 'package:path/path.dart' as p;

import 'outbox_test_harness.dart';

void main() {
  late Directory tempDir;
  late File dbFile;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('my_shop_m1b_s3_t_o2');
    dbFile = File(p.join(tempDir.path, 'outbox.db'));
  });

  tearDown(() {
    if (tempDir.existsSync()) {
      tempDir.deleteSync(recursive: true);
    }
  });

  AppDatabase openFileDatabase() => AppDatabase.forTesting(NativeDatabase(dbFile));

  test(
      'T-O2: an enqueued outbox row survives an application restart and '
      'reopens exactly where it left off (§38.26)', () async {
    var db = openFileDatabase();
    await seedDeviceBinding(db);
    final repo = OutboxRepository(db);

    final pendingRow = await repo.enqueue(testCommand());
    final syncingRow = await repo.enqueue(testCommand());
    await repo.transition(
      mutationId: syncingRow.mutationId,
      to: SyncState.syncing,
    );

    await db.close();

    db = openFileDatabase();
    addTearDown(() async => db.close());
    final reopened = OutboxRepository(db);

    final pending = await reopened.requireById(pendingRow.mutationId);
    expect(pending.syncState, 'PENDING');
    expect(pending.attemptCount, 0);
    expect(pending.deviceLocalSequence, 1);
    expect(pending.organizationId, testOrganizationId);
    final decoded = jsonDecode(pending.payload) as Map<String, Object?>;
    expect(decoded, testCommand().payload,
        reason: 'the stored payload is byte-identical after restart');

    final syncing = await reopened.requireById(syncingRow.mutationId);
    expect(syncing.syncState, 'SYNCING');
    expect(syncing.attemptCount, 1,
        reason: 'the attempt counter is durable across restarts');
    expect(syncing.lastAttemptAt, isNotNull);

    final counts = await reopened.countsByState();
    expect(counts[SyncState.pending], 1);
    expect(counts[SyncState.syncing], 1);

    final events = await db.select(db.localAuditEvents).get();
    expect(events, hasLength(3),
        reason: 'two enqueues plus one transition, all durable');

    final next = await reopened.enqueue(testCommand());
    expect(next.deviceLocalSequence, 3,
        reason: 'the sequence counter restarts from persisted state (§38.10.2)');
  });

  test('T-O2: the persisted sequence is gap-free after reopening', () async {
    var db = openFileDatabase();
    await seedDeviceBinding(db);
    final repo = OutboxRepository(db);

    final first = await repo.enqueue(testCommand());
    await repo.transition(mutationId: first.mutationId, to: SyncState.syncing);
    await db.close();

    db = openFileDatabase();
    addTearDown(() async => db.close());
    final reopened = OutboxRepository(db);

    final second = await reopened.enqueue(testCommand());
    expect(second.deviceLocalSequence, 2);

    final rows = await db.select(db.outbox).get();
    final sequences = rows.map((r) => r.deviceLocalSequence).toSet();
    expect(sequences.length, rows.length,
        reason: 'device_local_sequence is unique per mutation (§38.8.1)');
  });
}
