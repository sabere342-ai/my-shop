import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_record.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_store.dart';

import 'grace_test_harness.dart';

// Master Plan §38.16.2, §38.16.5, §39.6 (`local_meta`), §40.5 (M1b-S8).
//
// Everything the offline session must survive a restart with lives in the
// existing `local_meta` key/value table: the signed record, the establishment
// instant, the clock high-water, the re-validation flag, and the tamper count.
// Storing it there is what makes M1b-S8 a **no-schema-change** slice (§38.6.2).

final DateTime _establishedAt = DateTime.utc(2026, 3, 1, 12, 0, 0, 123);

OfflineGraceRecord _record() =>
    buildGraceRecord(issuedAt: testGraceIssuedAt, expiresAt: testGraceExpiresAt);

void main() {
  late AppDatabase db;
  late OfflineGraceStore store;

  setUp(() {
    db = openMemoryDatabase();
    store = OfflineGraceStore(db);
  });

  tearDown(() async {
    await db.close();
  });

  group('no schema change (§38.6.2, §39.6)', () {
    test('the local schema version is unchanged and there is no grace table',
        () async {
      expect(db.schemaVersion, 3,
          reason: 'M1b-S8 adds no local schema (v1 local_meta, v2 outbox, v3 guard)');
      expect(
        db.allTables.map((table) => table.actualTableName).where((name) => name.contains('grace')),
        isEmpty,
        reason: 'the session lives in local_meta, not a new table',
      );
    });

    test('the session is stored under the module-owned local_meta key', () async {
      await store.saveSession(record: _record(), deviceWallEstablishedAt: _establishedAt);
      expect(await hasMetaKey(db, OfflineGraceStore.sessionKey), isTrue);
    });
  });

  group('session round-trip (§38.16.3)', () {
    test('no session reads back as null', () async {
      expect(await store.readSession(), isNull);
    });

    test('the record and establishment instant round-trip exactly', () async {
      final OfflineGraceRecord record = _record();
      await store.saveSession(record: record, deviceWallEstablishedAt: _establishedAt);

      final StoredOfflineGrace? stored = await store.readSession();
      expect(stored, isNotNull);
      final StoredOfflineGrace session = stored!;
      expect(session.record.userId, record.userId);
      expect(session.record.organizationId, record.organizationId);
      expect(session.record.deviceId, record.deviceId);
      expect(session.record.permissions, record.permissions);
      expect(session.record.permissionsVersion, record.permissionsVersion);
      expect(session.record.issuedAt.toUtc(), record.issuedAt.toUtc());
      expect(session.record.expiresAt.toUtc(), record.expiresAt.toUtc());
      expect(session.record.signature, record.signature);
      expect(session.deviceWallEstablishedAt.toUtc(), _establishedAt.toUtc(),
          reason: 'the establishment instant survives at millisecond precision');
    });

    test('a second save replaces the first atomically', () async {
      await store.saveSession(record: _record(), deviceWallEstablishedAt: _establishedAt);
      final DateTime later = _establishedAt.add(const Duration(minutes: 5));
      await store.saveSession(record: _record(), deviceWallEstablishedAt: later);

      final StoredOfflineGrace session = (await store.readSession())!;
      expect(session.deviceWallEstablishedAt.toUtc(), later.toUtc());
    });

    test('clearSession removes the session and resets the flag', () async {
      await store.saveSession(record: _record(), deviceWallEstablishedAt: _establishedAt);
      await store.setRequiresRevalidation(required: true);

      await store.clearSession();

      expect(await store.readSession(), isNull);
      expect(await store.readRequiresRevalidation(), isFalse);
    });

    test('a malformed stored value is refused, never silently accepted',
        () async {
      for (final String bad in <String>[
        'not json',
        '[]',
        '{"record":{}}',
        '{"record":{},"deviceWallEstablishedAtMs":"soon"}',
      ]) {
        await writeRawMeta(db, OfflineGraceStore.sessionKey, bad);
        await expectLater(
          store.readSession(),
          throwsA(isA<FormatException>()),
          reason: 'a corrupt session must fail closed: $bad',
        );
      }
    });
  });

  group('clock state is durable and monotonic (§38.16.5)', () {
    test('the high-water only ever moves forward', () async {
      final DateTime early = DateTime.utc(2026, 3, 1, 12);
      final DateTime middle = early.add(const Duration(hours: 2));
      final DateTime late = middle.add(const Duration(hours: 2));

      expect(await store.readClockHighWater(), isNull);

      await store.raiseClockHighWater(middle);
      expect((await store.readClockHighWater())!.toUtc(), middle);

      await store.raiseClockHighWater(early); // a rewound value is ignored
      expect((await store.readClockHighWater())!.toUtc(), middle);

      await store.raiseClockHighWater(late);
      expect((await store.readClockHighWater())!.toUtc(), late);
    });

    test('the re-validation flag round-trips', () async {
      expect(await store.readRequiresRevalidation(), isFalse);
      await store.setRequiresRevalidation(required: true);
      expect(await store.readRequiresRevalidation(), isTrue);
      await store.setRequiresRevalidation(required: false);
      expect(await store.readRequiresRevalidation(), isFalse);
    });

    test('the tamper count is durable and increments', () async {
      expect(await store.readClockTamperCount(), 0);
      expect(await store.recordClockTamper(), 1);
      expect(await store.recordClockTamper(), 2);
      expect(await store.readClockTamperCount(), 2);
    });
  });

  group('the session envelope is atomic', () {
    test('the record and its establishment instant share one key', () async {
      await store.saveSession(record: _record(), deviceWallEstablishedAt: _establishedAt);

      final String? raw = await rawMeta(db, OfflineGraceStore.sessionKey);
      expect(raw, isNotNull);
      final Object? decoded = jsonDecode(raw!);
      expect(decoded, isA<Map<String, Object?>>());
      final Map<String, Object?> envelope = (decoded! as Map<String, Object?>);
      expect(envelope.keys, containsAll(<String>['record', 'deviceWallEstablishedAtMs']),
          reason: 'one value carries both, so a session is written or not at all');
    });
  });
}
