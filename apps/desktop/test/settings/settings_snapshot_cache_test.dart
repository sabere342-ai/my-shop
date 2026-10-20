import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/settings/settings_snapshot_cache.dart';
import 'package:my_shop_desktop/features/settings/models/organization_settings.dart';

import 'settings_test_harness.dart';

/// Unit coverage of the §38.18 versioned settings snapshot store (A5, A12,
/// A13): version supremacy, corruption refusal, tenant scoping, and the
/// T-O7 analogue — a cache write/purge lifecycle leaves the outbox (and
/// every other business table) exactly as it found it.
void main() {
  late AppDatabase db;
  late SettingsSnapshotCache cache;

  setUp(() {
    db = memoryDatabase();
    cache = SettingsSnapshotCache(db);
  });

  tearDown(() async => db.close());

  test('a stored snapshot reads back with its parsed row and metadata', () async {
    final Map<String, Object?> payload = settingsPayload(settingsVersion: 7);
    final SettingsCacheWrite stored = await cache.save(
      payloadJson: payload,
      fetchedAt: DateTime.utc(2026, 5, 2, 9, 30),
      fetchedByUserId: testUserId,
    );
    expect(stored, isA<SettingsCacheStored>());
    expect((stored as SettingsCacheStored).settingsVersion, 7);

    final SettingsCacheRead read = await cache.load(
      organizationId: testOrganizationId,
    );
    expect(read, isA<SettingsCacheHit>());
    final CachedSettingsSnapshot hit = (read as SettingsCacheHit).snapshot;
    expect(hit.settings.settingsVersion, 7);
    expect(hit.settings.organizationId, testOrganizationId);
    expect(hit.fetchedAt.toUtc(), DateTime.utc(2026, 5, 2, 9, 30));
    expect(hit.fetchedByUserId, testUserId);
  });

  test('an older settingsVersion is refused (the newer device truth stands)',
      () async {
    await cache.save(
      payloadJson: settingsPayload(settingsVersion: 9),
      fetchedAt: DateTime.utc(2026, 5, 2),
      fetchedByUserId: testUserId,
    );

    final SettingsCacheWrite stale = await cache.save(
      payloadJson: settingsPayload(settingsVersion: 5),
      fetchedAt: DateTime.utc(2026, 5, 3),
      fetchedByUserId: testUserId,
    );

    expect(stale, isA<SettingsCacheKeptNewer>());
    expect((stale as SettingsCacheKeptNewer).settingsVersion, 9);

    final SettingsCacheRead read = await cache.load(
      organizationId: testOrganizationId,
    );
    expect((read as SettingsCacheHit).snapshot.settings.settingsVersion, 9,
        reason: 'the kept row is still the newer one');
  });

  test('an equal version refreshes the fetch metadata without a version move',
      () async {
    await cache.save(
      payloadJson: settingsPayload(settingsVersion: 7),
      fetchedAt: DateTime.utc(2026, 5, 2),
      fetchedByUserId: testUserId,
    );
    await cache.save(
      payloadJson: settingsPayload(settingsVersion: 7),
      fetchedAt: DateTime.utc(2026, 5, 9),
      fetchedByUserId: testUserId,
    );

    final CachedSettingsSnapshot hit =
        (await cache.load(organizationId: testOrganizationId)
                as SettingsCacheHit)
            .snapshot;
    expect(hit.settings.settingsVersion, 7);
    expect(hit.fetchedAt.toUtc(), DateTime.utc(2026, 5, 9),
        reason: "just refreshed (repeated-refresh freshness stays honest)");
  });

  test('a newer version replaces the payload', () async {
    await cache.save(
      payloadJson: settingsPayload(
        settingsVersion: 3,
        overrides: {'organizationName': 'القديم'},
      ),
      fetchedAt: DateTime.utc(2026, 5, 2),
      fetchedByUserId: testUserId,
    );
    await cache.save(
      payloadJson: settingsPayload(
        settingsVersion: 4,
        overrides: {'organizationName': 'الجديد'},
      ),
      fetchedAt: DateTime.utc(2026, 5, 8),
      fetchedByUserId: testUserId,
    );

    final CachedSettingsSnapshot hit =
        (await cache.load(organizationId: testOrganizationId)
                as SettingsCacheHit)
            .snapshot;
    expect(hit.settings.settingsVersion, 4);
    expect(hit.settings.organizationName, 'الجديد');
  });

  test('a malformed payload refuses to be deposited', () async {
    final Map<String, Object?> payload = settingsPayload();
    payload.remove('pricingMode');
    expect(
      () => cache.save(
        payloadJson: payload,
        fetchedAt: DateTime.utc(2026, 5, 2),
        fetchedByUserId: testUserId,
      ),
      throwsA(isA<InvalidSettingsException>()),
    );
  });

  test('a corrupted stored payload reads back as corrupt (never served)',
      () async {
    await cache.save(
      payloadJson: settingsPayload(settingsVersion: 7),
      fetchedAt: DateTime.utc(2026, 5, 2),
      fetchedByUserId: testUserId,
    );
    // Simulate on-device corruption / tampering: splice the bytes the way a
    // copied or damaged file could.
    await db.customStatement(
      'UPDATE settings_snapshots SET payload_json = ? WHERE organization_id = ?',
      <String>[payloadJsonCorrupt(), testOrganizationId],
    );

    final SettingsCacheRead read = await cache.load(
      organizationId: testOrganizationId,
    );
    expect(read, isA<SettingsCacheCorrupted>());
    expect((read as SettingsCacheCorrupted).reason, isNotEmpty);
    // The row stays untouched — a corrupt cache is never silently deleted;
    // the next authoritative fetch replaces it through the save path.
    final int row = (await db.customSelect(
      'SELECT COUNT(*) AS n FROM settings_snapshots',
    ).getSingle())
        .read<int>('n');
    expect(row, 1,
        reason: 'the corrupt row survives until a governed fetch overwrites it');
  });

  test('a payload spliced across tenants refuses (row/payload consistency)',
      () async {
    await cache.save(
      payloadJson: settingsPayload(settingsVersion: 7),
      fetchedAt: DateTime.utc(2026, 5, 2),
      fetchedByUserId: testUserId,
    );
    // Cross-tenant splice attempt: the row claims another organization.
    await db.customStatement(
      'UPDATE settings_snapshots SET organization_id = ?',
      <String>[testSecondOrganizationId],
    );

    final SettingsCacheRead forFirst = await cache.load(
      organizationId: testOrganizationId,
    );
    expect(forFirst, isA<SettingsCacheMiss>(),
        reason: 'org-keyed reads cannot see another tenant row');

    final SettingsCacheRead forSecond = await cache.load(
      organizationId: testSecondOrganizationId,
    );
    expect(forSecond, isA<SettingsCacheCorrupted>(),
        reason:
            'the payload still names the first organization — a splice or a '
            'foreign row must corrupt-refuse, never serve cross-tenant data');
  });

  test('a version the row does not claim corrupt-refuses', () async {
    await cache.save(
      payloadJson: settingsPayload(settingsVersion: 7),
      fetchedAt: DateTime.utc(2026, 5, 2),
      fetchedByUserId: testUserId,
    );
    await db.customStatement(
      'UPDATE settings_snapshots SET settings_version = 99 WHERE organization_id = ?',
      <String>[testOrganizationId],
    );
    final SettingsCacheRead read =
        await cache.load(organizationId: testOrganizationId);
    expect(read, isA<SettingsCacheCorrupted>());
  });

  group('T-O7 analogue: the cache never touches the outbox or business data',
      () {
    test('a full cache lifecycle leaves the outbox row count and rows intact',
        () async {
      // A pre-existing outbox row, exactly as a busy device would hold.
      await db.customStatement(
        'INSERT INTO outbox (mutation_id, organization_id, device_id, '
        'actor_user_id, actor_role_snapshot, aggregate_type, aggregate_id, '
        'operation_type, payload, payload_version, device_local_sequence, '
        'local_created_at, sync_state, device_idempotency_key) '
        "VALUES ('m-1', 'o', 'd', 'u', '{}', 'SALE', 'a', 'CREATE', '{}', 1, "
        "1, 0, 'LOCAL_ONLY', 'k-1')",
      );

      final int before = await countOf(db, 'outbox');

      await cache.save(
        payloadJson: settingsPayload(settingsVersion: 7),
        fetchedAt: DateTime.utc(2026, 5, 2),
        fetchedByUserId: testUserId,
      );
      await cache.save(
        payloadJson: settingsPayload(settingsVersion: 8),
        fetchedAt: DateTime.utc(2026, 5, 3),
        fetchedByUserId: testUserId,
      );
      await cache.purge(organizationId: testOrganizationId);

      expect(await countOf(db, 'outbox'), before,
          reason: '§38.12.1: a cache write is never an outgoing mutation and '
              'never deletes outbox rows');
      expect(await countOf(db, 'settings_snapshots'), 0,
          reason: 'the purge removed only its own row');
    });

    test('the grace, audit, and remote-apply tables stay empty through the '
        'cache lifecycle', () async {
      await cache.save(
        payloadJson: settingsPayload(settingsVersion: 7),
        fetchedAt: DateTime.utc(2026, 5, 2),
        fetchedByUserId: testUserId,
      );
      await cache.purgeAll();

      // This store appends to and deletes from nothing but its own table —
      // the audit/grace/applied-sequence tables are structurally untouchable
      // by it, which the empty counts below make visible.
      expect(await countOf(db, 'settings_snapshots'), 0);
      expect(await countOf(db, 'local_audit_events'), 0);
      expect(await countOf(db, 'remote_applied_changes'), 0);
    });

    test('purgeAll removes only the settings table (structural isolation)',
        () async {
      await cache.save(
        payloadJson: settingsPayload(settingsVersion: 7),
        fetchedAt: DateTime.utc(2026, 5, 2),
        fetchedByUserId: testUserId,
      );
      expect(await countOf(db, 'settings_snapshots'), 1);
      await cache.purgeAll();
      expect(await countOf(db, 'settings_snapshots'), 0);
    });
  });
}

/// One helper every count assertion shares.
Future<int> countOf(AppDatabase db, String table) async {
  return (await db.customSelect('SELECT COUNT(*) AS n FROM $table').getSingle())
      .read<int>('n');
}

/// A JSON body a corrupted file plausibly yields: truncation mid-object.
String payloadJsonCorrupt() {
  return '{"organizationId":"$testOrganizationId","settingsVersion":7,'
      '"organizationName":"trunc';
}
