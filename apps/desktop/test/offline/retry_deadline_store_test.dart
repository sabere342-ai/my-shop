import 'package:drift/drift.dart' hide isNull, isNotNull;
import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/retry_deadline_store.dart';

import 'outbox_test_harness.dart';

void main() {
  late AppDatabase db;
  late RetryDeadlineStore store;

  setUp(() {
    db = openMemoryDatabase();
    store = RetryDeadlineStore(db);
  });

  tearDown(() async {
    await db.close();
  });

  Future<void> writeRaw(String value) {
    return db
        .into(db.localMeta)
        .insert(
          LocalMetaCompanion.insert(
            key: RetryDeadlineStore.serverRetryDeadlineKey,
            value: value,
          ),
          mode: InsertMode.insertOrReplace,
        );
  }

  test('an empty store reads null', () async {
    expect(await store.read(), isNull);
  });

  test('a written deadline round-trips by epoch milliseconds', () async {
    final DateTime deadline = DateTime.utc(2026, 1, 1, 12, 5);
    await store.write(deadline);
    final DateTime? read = await store.read();
    expect(read, isNotNull);
    expect(read!.millisecondsSinceEpoch, deadline.millisecondsSinceEpoch);
  });

  test('clear removes the deadline', () async {
    await store.write(DateTime.utc(2026, 1, 1, 12, 5));
    await store.clear();
    expect(await store.read(), isNull);
  });

  test('a later write replaces the earlier one', () async {
    await store.write(DateTime.utc(2026, 1, 1, 12, 5));
    final DateTime later = DateTime.utc(2026, 1, 1, 12, 30);
    await store.write(later);
    final DateTime? read = await store.read();
    expect(read!.millisecondsSinceEpoch, later.millisecondsSinceEpoch);
  });

  test('a corrupt value falls back to null', () async {
    await writeRaw('not-a-number');
    expect(await store.read(), isNull);
  });

  test('a blank value falls back to null', () async {
    await writeRaw('');
    expect(await store.read(), isNull);
  });

  test('a zero sentinel falls back to null', () async {
    await writeRaw('0');
    expect(await store.read(), isNull);
  });

  test('a negative sentinel falls back to null', () async {
    await writeRaw('-1000');
    expect(await store.read(), isNull);
  });
}
