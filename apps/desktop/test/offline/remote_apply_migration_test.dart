import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:path/path.dart' as p;

// Master Plan §38.6, §40.5 (M1b-S7), T-O19.
//
// M1b-S7 raises the local schema to v3 by adding the applied-sequence guard
// table (`remote_applied_changes`). The migration is forward-only and
// additive: it creates one table and rewrites the version stamp, leaving every
// existing row — including the durable outbox — exactly as it was.
//
// The migrated stamp assertions below pin the schema *current* at M3-S4 (v4,
// which appends the §38.18 settings-snapshot table); the seeded files are
// still v1/v2, so every open runs the whole forward-only chain 2 → 3 → 4.
void main() {
  group('T-O19: local schema migration v2 → v3 (§38.6, M1b-S7)', () {
    late Directory tempDir;
    late File dbFile;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('my_shop_m1b_s7_t_o19');
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

    /// A raw executor for [file] seeded to look like an installed M1b-S3 (v2)
    /// device, so drift's `onUpgrade` runs against a real v2 file. With
    /// [migrateFromV1] it is seeded as a v1 file instead, exercising both
    /// forward-only steps in one open.
    NativeDatabase seedDatabase(File file, {bool migrateFromV1 = false}) {
      var seeded = false;
      return NativeDatabase(
        file,
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
          if (!migrateFromV1) {
            raw.execute(
              'CREATE TABLE outbox ('
              'mutation_id TEXT NOT NULL PRIMARY KEY, '
              'organization_id TEXT NOT NULL, '
              'device_id TEXT NOT NULL, '
              'actor_user_id TEXT NOT NULL, '
              'actor_role_snapshot TEXT NOT NULL, '
              'aggregate_type TEXT NOT NULL, '
              'aggregate_id TEXT NOT NULL, '
              'operation_type TEXT NOT NULL, '
              'payload TEXT NOT NULL, '
              'payload_version INTEGER NOT NULL, '
              'device_local_sequence INTEGER NOT NULL, '
              'local_created_at INTEGER NOT NULL, '
              'sync_state TEXT NOT NULL, '
              'attempt_count INTEGER NOT NULL DEFAULT 0, '
              'last_error_code TEXT, '
              'last_attempt_at INTEGER, '
              'device_idempotency_key TEXT NOT NULL, '
              'UNIQUE (device_local_sequence), '
              'UNIQUE (device_idempotency_key));',
            );
            raw.execute(
              'CREATE TABLE local_audit_events ('
              'id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, '
              'event_time INTEGER NOT NULL, '
              'mutation_id TEXT NOT NULL, '
              'from_state TEXT NOT NULL, '
              'to_state TEXT NOT NULL, '
              'attempt_count INTEGER NOT NULL, '
              'error_code TEXT);',
            );
            raw.execute(
              "INSERT INTO outbox (mutation_id, organization_id, device_id, "
              'actor_user_id, actor_role_snapshot, aggregate_type, aggregate_id, '
              'operation_type, payload, payload_version, device_local_sequence, '
              'local_created_at, sync_state, device_idempotency_key) '
              "VALUES ('v2-mutation', 'o', 'd', 'u', '{}', 'SALE', 'a', "
              "'CREATE', '{}', 1, 1, 0, 'PENDING', 'v2-mutation');",
            );
          }
          raw.execute(
            "INSERT INTO local_meta (key, value) "
            "VALUES ('seed_key', '${migrateFromV1 ? 'v1' : 'v2'}-survivor');",
          );
          raw.execute(
            "INSERT INTO local_meta (key, value) "
            "VALUES ('local_schema_version', '${migrateFromV1 ? 1 : 2}');",
          );
          raw.execute('PRAGMA user_version = ${migrateFromV1 ? 1 : 2};');
        },
      );
    }

    test('a v2 database is upgraded in place, adding the guard table with data '
        'intact', () async {
      final db = AppDatabase.forTesting(seedDatabase(dbFile));
      addTearDown(() async => db.close());

      expect(await userVersion(db), 4,
          reason: 'opening a v2 file must run the forward-only steps '
              '(2 → 3 → 4; M3-S4 appends the v4 step)');

      final metaRows = await db.select(db.localMeta).get();
      expect(
        {for (final row in metaRows) row.key: row.value},
        {
          'seed_key': 'v2-survivor',
          'local_schema_version': '4',
        },
        reason: '§38.6.2: the version row is rewritten, all other rows survive',
      );

      final outboxRows = await db.select(db.outbox).get();
      expect(outboxRows, hasLength(1),
          reason: 'the durable outbox survives the migration unchanged');
      expect(outboxRows.single.mutationId, 'v2-mutation');
      expect(outboxRows.single.syncState, 'PENDING');
      expect(await db.select(db.localAuditEvents).get(), isEmpty);

      expect(await db.select(db.remoteAppliedChanges).get(), isEmpty,
          reason: 'the guard table is created empty; no sequence is faked');
    });

    test('the v3 guard table is writable and stores a 64-bit sequence as a '
        'decimal string', () async {
      final db = AppDatabase.forTesting(seedDatabase(dbFile));
      addTearDown(() async => db.close());
      expect(await userVersion(db), 4);

      await db.into(db.remoteAppliedChanges).insert(
            RemoteAppliedChangesCompanion.insert(
              entityType: 'PRODUCT',
              entityId: 'p1',
              lastAppliedServerSequence: '9007199254740993',
              appliedAt: DateTime.now(),
            ),
          );
      final row = await db.select(db.remoteAppliedChanges).getSingle();
      expect(row.lastAppliedServerSequence, '9007199254740993',
          reason: '2^53 + 1 survives exactly; a numeric column would not');
    });

    test('a fresh database stamps local_schema_version = 4 (the current '
        'schema)', () async {
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

    test('a v1 database upgrades all the way to v3', () async {
      final db = AppDatabase.forTesting(seedDatabase(dbFile, migrateFromV1: true));
      addTearDown(() async => db.close());

      expect(await userVersion(db), 4,
          reason: 'v1 → v2 → v3 → v4 runs every forward-only step');
      expect(await db.select(db.outbox).get(), isEmpty);
      expect(await db.select(db.localAuditEvents).get(), isEmpty);
      expect(await db.select(db.remoteAppliedChanges).get(), isEmpty);

      final metaRows = await db.select(db.localMeta).get();
      expect(
        {for (final row in metaRows) row.key: row.value},
        {
          'seed_key': 'v1-survivor',
          'local_schema_version': '4',
        },
      );
    });
  });
}
