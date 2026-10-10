import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'package:my_shop_desktop/core/offline/db/migrations/local_schema_version.dart';

part 'app_database.g.dart';

class LocalMeta extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();

  @override
  Set<Column> get primaryKey => {key};
}

/// The durable outbox — Master Plan §38.8.1's required field list, one column
/// per row of that table.
///
/// Rules that belong to the schema itself rather than to the writer:
///
/// * `mutation_id` is the primary key (§38.8.1 `mutation_id`), a client-
///   generated UUIDv7.
/// * `device_local_sequence` is unique (§38.10.2): the per-device counter is
///   gap-free, so two rows can never share a sequence, and the unique index is
///   what makes that enforceable by the database rather than by app logic.
/// * `device_idempotency_key` is unique too: it duplicates `mutation_id`
///   (§38.8.1) so the server idempotency key is derivable offline, and the
///   index keeps the duplication honest.
/// * `sync_state` is indexed: every outbox scan — push selection, the owner's
///   pending counts, compaction — filters on it (§38.6 "Indexed on every
///   column used by a guard, an outbox scan, or a sync cursor").
/// * `payload` is append-only after commit (§38.8.2). No update path in the
///   writer touches it.
class Outbox extends Table {
  TextColumn get mutationId => text()();

  /// §38.8.1: tenant scope, from the device binding, never user input.
  TextColumn get organizationId => text()();

  TextColumn get deviceId => text()();

  TextColumn get actorUserId => text()();

  /// JSON: effective permissions at the time of the mutation (§38.17).
  TextColumn get actorRoleSnapshot => text()();

  /// Open vocabulary — §38.8.1 ends its list with an ellipsis.
  TextColumn get aggregateType => text()();

  TextColumn get aggregateId => text()();

  /// Stored as the §38.8.1 wire name (`CREATE`, `VOID`, `RETURN`, `REVERSE`).
  TextColumn get operationType => text()();

  /// JSON, append-only after commit (§38.8.2).
  TextColumn get payload => text()();

  IntColumn get payloadVersion => integer()();

  IntColumn get deviceLocalSequence => integer()();

  DateTimeColumn get localCreatedAt => dateTime()();

  /// Stored as the §38.13 wire name (`LOCAL_ONLY` … `PERMANENT_REJECTED`).
  TextColumn get syncState => text()();

  IntColumn get attemptCount => integer().withDefault(const Constant(0))();

  TextColumn get lastErrorCode => text().nullable()();

  DateTimeColumn get lastAttemptAt => dateTime().nullable()();

  TextColumn get deviceIdempotencyKey => text()();

  @override
  Set<Column> get primaryKey => {mutationId};

  @override
  List<Set<Column>> get uniqueKeys => [
        {deviceLocalSequence},
        {deviceIdempotencyKey},
      ];
}

/// The append-only local audit log (§32.2A), carrying §38.13's promise that
/// "each transition is timestamped and written to the local audit log".
///
/// One row per sync-state transition. Nothing in the schema or the writer
/// updates or deletes these rows: they are the device-side history the owner's
/// sync console and the server's mirrored audit events reason over later
/// (M2-S6), and an audit trail that can be rewritten is not an audit trail.
class LocalAuditEvents extends Table {
  IntColumn get id => integer().autoIncrement()();

  DateTimeColumn get eventTime => dateTime()();

  TextColumn get mutationId => text()();

  TextColumn get fromState => text()();

  TextColumn get toState => text()();

  /// The outbox `attempt_count` as of the transition, so retry accounting can
  /// be reconstructed from the log alone.
  IntColumn get attemptCount => integer()();

  TextColumn get errorCode => text().nullable()();
}

@DriftDatabase(tables: [LocalMeta, Outbox, LocalAuditEvents])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_openConnection());

  /// Test constructor: the executor is supplied by the caller, so tests can
  /// run against an in-memory database or a file they control (§38.6.6).
  AppDatabase.forTesting(super.executor);

  /// Local schema version (§38.6.2). v1 created `local_meta` (M1b-S1); v2
  /// adds the durable outbox and its audit log (M1b-S3).
  @override
  int get schemaVersion => 2;

  @override
  MigrationStrategy get migration {
    return MigrationStrategy(
      onCreate: (Migrator m) async {
        await m.createAll();
        await recordLocalSchemaVersion(this, schemaVersion);
      },
      onUpgrade: (Migrator m, int from, int to) async {
        // Forward-only and additive (§38.6.2): v2 exists only to add the two
        // tables above. Every v1 row in `local_meta` is left untouched, so
        // the backup-before-migration rule (§38.6.2) does not apply — this is
        // a purely additive migration.
        if (from < 2 && to >= 2) {
          await m.createTable(outbox);
          await m.createTable(localAuditEvents);
          await recordLocalSchemaVersion(this, to);
        }
      },
    );
  }

  static LazyDatabase _openConnection() {
    return LazyDatabase(() async {
      final dir = await getApplicationDocumentsDirectory();
      final file = File(p.join(dir.path, 'my_shop_local.db'));
      return NativeDatabase.createInBackground(
        file,
        logStatements: false,
        setup: (rawDb) {
          rawDb.execute('PRAGMA foreign_keys = ON');
          rawDb.execute('PRAGMA journal_mode = WAL');
          rawDb.execute('PRAGMA synchronous = FULL');
        },
      );
    });
  }
}
