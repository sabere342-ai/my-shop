import 'package:drift/drift.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';

/// Advances `local_schema_version` in `local_meta` — Master Plan §38.6.2's
/// "a single integer in a `local_meta` table, advanced by Drift".
///
/// The row is written on every schema change, including `onCreate`, so a fresh
/// install and an upgraded install both report the version they actually are.
/// The write lives in this `/migrations/` module because it is migration
/// bookkeeping, not outbox behaviour: the offline guards (§37.2 stage 24)
/// keep database writes out of the schema file itself, and migration DDL is
/// the declared exemption.
Future<void> recordLocalSchemaVersion(AppDatabase db, int version) {
  return db.into(db.localMeta).insert(
        LocalMetaCompanion.insert(
          key: 'local_schema_version',
          value: '$version',
        ),
        mode: InsertMode.insertOrReplace,
      );
}
