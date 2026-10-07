import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

part 'app_database.g.dart';

class LocalMeta extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();

  @override
  Set<Column> get primaryKey => {key};
}

@DriftDatabase(tables: [LocalMeta])
class AppDatabase extends _ {
  AppDatabase() : super(_openConnection());

  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration {
    return MigrationStrategy(
      onCreate: (Migrator m) async {
        await m.createAll();
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
