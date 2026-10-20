import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:path/path.dart' as p;

// T-O19, from the M1b-S3 slice, kept current with the local schema.
//
// The target version moves forward as later slices add tables; this file owns
// the **v1 → current** upgrade path, while each slice that bumps the version
// adds its own `from → to` test (M1b-S7's v2 → v3 lives in
// `remote_apply_migration_test.dart`, M3-S4's v3 → v4 lives in
// `settings_snapshot_migration_test.dart`). Today the current version is v4
// (M3-S4 added the §38.18 settings snapshot table), so a v1 file upgrades
// v1 → v2 → v3 → v4 in one open.
void main() {
  group('T-O19: local schema migration v1 → v4 (§38.6)', () {
    late Directory tempDir;
    late File dbFile;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('my_shop_m1b_s3_t_o19');
      dbFile = File(p.join(tempDir.path, 'desktop.db'));
    });

    tearDown(() {
      if (tempDir.existsSync()) {
        tempDir.deleteSync(recursive: true);
      }
    });

    Future<int> userVersion(AppDatabase db) async {
      final row = await db.customSelect('PRAGMA user_version').getSingle();
      return row.read<int>('user_version');
    }

    test('a v1 database is upgraded in place with its data intact', () async {
      var seeded = false;
      final executor = NativeDatabase(
        dbFile,
        setup: (raw) {
          if (seeded) {
            return;
          }
          seeded = true;
          raw.execute(
            'CREATE TABLE local_meta ('
            'key TEXT NOT NULL PRIMARY KEY, '
            'value TEXT NOT NULL);',
          );
          raw.execute(
            "INSERT INTO local_meta (key, value) "
            "VALUES ('seed_key', 'v1-survivor');",
          );
          raw.execute(
            "INSERT INTO local_meta (key, value) "
            "VALUES ('local_schema_version', '1');",
          );
          raw.execute('PRAGMA user_version = 1;');
        },
      );

      final db = AppDatabase.forTesting(executor);
      addTearDown(() async => db.close());

      expect(await userVersion(db), 4,
          reason: 'opening a v1 file must run onUpgrade(1 → 4)');

      final metaRows = await db.select(db.localMeta).get();
      expect(
        {for (final row in metaRows) row.key: row.value},
        {
          'seed_key': 'v1-survivor',
          'local_schema_version': '4',
        },
        reason: '§38.6.2: the version row is rewritten, all other rows survive',
      );

      expect(await db.select(db.outbox).get(), isEmpty);
      expect(await db.select(db.localAuditEvents).get(), isEmpty);
      expect(await db.select(db.remoteAppliedChanges).get(), isEmpty);
      expect(await db.select(db.settingsSnapshots).get(), isEmpty);

      await db.customStatement(
        'INSERT INTO outbox (mutation_id, organization_id, device_id, '
        'actor_user_id, actor_role_snapshot, aggregate_type, aggregate_id, '
        'operation_type, payload, payload_version, device_local_sequence, '
        'local_created_at, sync_state, device_idempotency_key) '
        "VALUES ('m', 'o', 'd', 'u', '{}', 'SALE', 'a', 'CREATE', '{}', 1, "
        "1, 0, 'LOCAL_ONLY', 'k')",
      );
      final count =
          await db.customSelect('SELECT COUNT(*) AS n FROM outbox').getSingle();
      expect(count.read<int>('n'), 1,
          reason: 'the migrated schema accepts new rows');
    });

    test('a fresh database stamps local_schema_version = 4', () async {
      final db = AppDatabase.forTesting(NativeDatabase(dbFile));
      addTearDown(() async => db.close());

      expect(await userVersion(db), 4);
      final version = await db.customSelect(
        "SELECT value FROM local_meta WHERE key = 'local_schema_version'",
      ).getSingle();
      expect(version.read<String>('value'), '4');
    });

    test('a second open does not re-run or duplicate the version stamp',
        () async {
      var db = AppDatabase.forTesting(NativeDatabase(dbFile));
      await db.customSelect('SELECT 1').getSingle();
      await db.close();

      db = AppDatabase.forTesting(NativeDatabase(dbFile));
      addTearDown(() async => db.close());
      expect(await userVersion(db), 4);

      final stamps = await db.customSelect(
        "SELECT value FROM local_meta WHERE key = 'local_schema_version'",
      ).get();
      expect(stamps, hasLength(1),
          reason: 'insertOrReplace keeps exactly one version row');
      expect(stamps.single.read<String>('value'), '4');
    });
  });
}
