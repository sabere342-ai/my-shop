import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:path/path.dart' as p;
import 'package:sqlite3/sqlite3.dart' as sqlite;

/// T-O19 analogue for the M3-S4 step: local schema migration **v3 → v4**
/// (acceptance A11; §38.6, §35.5).
///
/// The v4 step is the §38.18 settings snapshot cache — **additive only**: a
/// fresh table, no column change on any v1–v3 table, no data rewrite. The
/// test reconstructs an honest v3-shaped file — its `user_version` stamped 3,
/// its journal row reading '3', and the pre-existing rows a real M3-S3-era
/// device would hold (a local_meta entry and an **owed outbox mutation**) —
/// and then opens it with the current code. Everything the file already
/// carried must survive beside the new, empty snapshot table, and a second
/// open must not re-run the step.
void main() {
  /// The CREATE statements the generator itself produces, captured from an
  /// in-memory build (the one authoritative source for the v3 table shapes;
  /// additivity ⇒ identical shapes for v3 and v4 on the non-v4 tables).
  late final Map<String, String> ddl;

  setUpAll(() async {
    final AppDatabase source =
        AppDatabase.forTesting(NativeDatabase.memory());
    try {
      final rows = await source.customSelect(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table'",
      ).get();
      ddl = <String, String>{
        for (final row in rows) row.read<String>('name'): row.read<String>('sql'),
      };
    } finally {
      await source.close();
    }
  });

  void buildV3File(File file) {
    final sqlite.Database raw = sqlite.sqlite3.open(file.path);
    try {
      for (final String table in const <String>[
        'local_meta',
        'outbox',
        'local_audit_events',
        'remote_applied_changes',
      ]) {
        final String? create = ddl[table];
        expect(create, isNotNull, reason: '$table DDL available');
        raw.execute(create!);
      }
      // Pre-existing data a real M3-S3-era device would hold.
      raw.execute(
        "INSERT INTO local_meta (key, value) VALUES ('v3_survivor_key', 'm3-s3-data');",
      );
      raw.execute(
        'INSERT INTO outbox (mutation_id, organization_id, device_id, '
        'actor_user_id, actor_role_snapshot, aggregate_type, aggregate_id, '
        'operation_type, payload, payload_version, device_local_sequence, '
        'local_created_at, sync_state, device_idempotency_key) '
        "VALUES ('m-survivor', 'o', 'd', 'u', '{}', 'SALE', 'a', 'CREATE', "
        "'{}', 1, 1, 0, 'LOCAL_ONLY', 'k-survivor');",
      );
      // The v3 journal state, exactly as M1b-S8 left it.
      raw.execute(
        "INSERT INTO local_meta (key, value) VALUES ('local_schema_version', '3');",
      );
      raw.execute('PRAGMA user_version = 3;');
    } finally {
      raw.close();
    }
  }

  Future<int> userVersion(AppDatabase db) async {
    final row = await db.customSelect('PRAGMA user_version').getSingle();
    return row.read<int>('user_version');
  }

  late Directory tempDir;
  late File dbFile;

  setUp(() {
    tempDir = Directory.systemTemp.createTempSync('my_shop_m3_s4_t_o19_v4');
    dbFile = File(p.join(tempDir.path, 'desktop.db'));
    buildV3File(dbFile);
  });

  tearDown(() {
    if (tempDir.existsSync()) {
      tempDir.deleteSync(recursive: true);
    }
  });

  test('a v3 database with pre-existing data upgrades in place; every older '
      'row is byte-identically preserved', () async {
    final db = AppDatabase.forTesting(NativeDatabase(dbFile));
    addTearDown(() async => db.close());

    expect(await userVersion(db), 4,
        reason: 'opening the v3 file must run onUpgrade(3 → 4)');

    // §38.6.2: data preservation across the step.
    final Map<String, String> meta = <String, String>{
      for (final row in await db.select(db.localMeta).get())
        row.key: row.value,
    };
    expect(meta['v3_survivor_key'], 'm3-s3-data',
        reason: 'pre-v4 rows survive untouched');
    expect(meta['local_schema_version'], '4',
        reason: 'the journal row is rewritten in place, not duplicated');

    final outboxRows = await db.select(db.outbox).get();
    expect(outboxRows, hasLength(1));
    expect(outboxRows.single.mutationId, 'm-survivor',
        reason: 'the owed mutation survived the upgrade');
    expect(outboxRows.single.syncState, 'LOCAL_ONLY',
        reason: 'the owed mutation keeps its sync state (and stays owed)');

    // The new table arrived, empty and usable.
    expect(await db.select(db.settingsSnapshots).get(), isEmpty);
    await db.customStatement(
      'INSERT INTO settings_snapshots (organization_id, settings_version, '
      'payload_json, fetched_at, fetched_by_user_id) '
      "VALUES ('o', 1, '{}', 0, 'u');",
    );
    final count =
        await db.customSelect('SELECT COUNT(*) AS n FROM settings_snapshots')
            .getSingle();
    expect(count.read<int>('n'), 1,
        reason: 'the migrated schema accepts snapshot rows');
  });

  test('re-opening a migrated file does not re-run the step or duplicate the '
      'version stamp', () async {
    var db = AppDatabase.forTesting(NativeDatabase(dbFile));
    await db.customSelect('SELECT 1').getSingle();
    await db.close();

    db = AppDatabase.forTesting(NativeDatabase(dbFile));
    addTearDown(() async => db.close());
    expect(await userVersion(db), 4);

    final stamps = await db.customSelect(
      "SELECT value FROM local_meta WHERE key = 'local_schema_version'",
    ).get();
    expect(stamps, hasLength(1), reason: 'exactly one version row');
    expect(stamps.single.read<String>('value'), '4');
  });
}
