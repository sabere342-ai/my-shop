import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/api/api_client.dart';
import 'package:my_shop_desktop/core/api/settings_api.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/settings/settings_snapshot_cache.dart';
import 'package:my_shop_desktop/features/settings/data/settings_repository.dart';

import 'settings_test_harness.dart';

/// Unit coverage of the settings repository's closed outcome classes (A4,
/// A6, A7, A8) — the load-and-save honesty the screens render:
///
/// - a §22.3 live answer also deposits the versioned §38.18 cache;
/// - a withheld attempt (no HTTP answer) falls back to the cache;
/// - a **server decision** (401/403/409/400) never falls back to cached data
///   (denied is never softened into offline success, mission §7);
/// - a save's refused/withheld/conflict/saved categories are distinct.
void main() {
  late ScriptedServer server;
  late SettingsApi api;
  late AppDatabase db;
  late SettingsSnapshotCache cache;
  late SettingsRepository repository;

  setUp(() {
    server = ScriptedServer();
    api = SettingsApi(
      ApiClient(
        ApiClientConfig(baseUrl: Uri.parse('https://server.test')),
        client: server.client(),
      ),
    );
    db = memoryDatabase();
    cache = SettingsSnapshotCache(db);
    repository = SettingsRepository(api, cache, now: () => DateTime.utc(2026, 5, 1, 12));
  });

  tearDown(() async => db.close());

  Future<void> seedCache({int version = 5}) => cache.save(
        payloadJson: settingsPayload(settingsVersion: version),
        fetchedAt: DateTime.utc(2026, 4, 30),
        fetchedByUserId: testUserId,
      );

  group('load outcomes', () {
    test('a 2xx GET answers live and updates the cache (transport-verbatim)',
        () async {
      routeStandard(
        server: server,
        settings: settingsPayload(settingsVersion: 11),
      );

      final SettingsLoadOutcome outcome = await repository.load(
        organizationId: testOrganizationId,
        actorUserId: testUserId,
      );

      expect(outcome, isA<SettingsLive>());
      expect((outcome as SettingsLive).settings.settingsVersion, 11);

      // §22.3: the read-through cache holds exactly what the server said.
      final SettingsCacheRead held = await cache.load(
        organizationId: testOrganizationId,
      );
      expect(
        (held as SettingsCacheHit).snapshot.settings.settingsVersion,
        11,
      );
    });

    test('a withheld attempt with no cached row is an honest load failure '
        '(the §38.18 fresh-offline-device state)', () async {
      // No routes at all: the transport withholds.
      final SettingsLoadOutcome outcome = await repository.load(
        organizationId: testOrganizationId,
        actorUserId: testUserId,
      );
      expect(outcome, isA<SettingsLoadFailed>());
      final SettingsLoadFailed failed = outcome as SettingsLoadFailed;
      expect(failed.cacheCorruptionReason, isNull);
      expect(failed.failure.httpStatus, isNull,
          reason: 'a transport refusal carries no HTTP answer');
    });

    test('a withheld attempt with a cached row answers cached, with the '
        'cached version and fetch time', () async {
      await seedCache(version: 5);
      final SettingsLoadOutcome outcome = await repository.load(
        organizationId: testOrganizationId,
        actorUserId: testUserId,
      );
      expect(outcome, isA<SettingsCached>());
      final CachedSettingsSnapshot snapshot =
          (outcome as SettingsCached).snapshot;
      expect(snapshot.settings.settingsVersion, 5);
      expect(snapshot.fetchedAt.toUtc(), DateTime.utc(2026, 4, 30));
    });

    test('a server denial (403) is denied — never softened to cached data, '
        'even when a row is cached', () async {
      await seedCache(version: 5);
      server.route('GET', settingsPath, (_, _) {
        return problem('PERMISSION_DENIED', status: 403);
      });

      final SettingsLoadOutcome outcome = await repository.load(
        organizationId: testOrganizationId,
        actorUserId: testUserId,
      );
      expect(outcome, isA<SettingsDenied>());
      expect(
        (outcome as SettingsDenied).failure.code.name,
        'permissionDenied',
      );
      expect(
        (outcome).failure.httpStatus,
        403,
      );
      // And explicitly: the denial did not read the cache as data.
      final SettingsCacheRead held = await cache.load(
        organizationId: testOrganizationId,
      );
      expect(held, isA<SettingsCacheHit>(),
          reason: 'the cache row still exists (untouched), but the outcome '
              'the repository returned is denial, never its data');
    });

    test('a 401 refusal is a denial too', () async {
      server.route('GET', settingsPath, (_, _) {
        return problem('UNAUTHENTICATED', status: 401);
      });
      final SettingsLoadOutcome outcome = await repository.load(
        organizationId: testOrganizationId,
        actorUserId: testUserId,
      );
      expect(outcome, isA<SettingsDenied>());
    });

    test('a 5xx the client cannot treat as a decision falls back to the cache',
        () async {
      await seedCache(version: 5);
      server.route('GET', settingsPath, (_, _) {
        return problem('SERVICE_UNAVAILABLE', status: 503);
      });
      final SettingsLoadOutcome outcome = await repository.load(
        organizationId: testOrganizationId,
        actorUserId: testUserId,
      );
      expect(outcome, isA<SettingsCached>());
    });

    test('a corruption cache hits report themselves by name', () async {
      await cache.save(
        payloadJson: settingsPayload(settingsVersion: 5),
        fetchedAt: DateTime.utc(2026, 4, 30),
        fetchedByUserId: testUserId,
      );
      await db.customStatement(
        'UPDATE settings_snapshots SET payload_json = ? WHERE organization_id = ?',
        <String>['{"trunc', testOrganizationId],
      );
      server.route('GET', settingsPath, (_, _) {
        return problem('SERVICE_UNAVAILABLE', status: 503);
      });
      final SettingsLoadOutcome outcome = await repository.load(
        organizationId: testOrganizationId,
        actorUserId: testUserId,
      );
      expect(outcome, isA<SettingsLoadFailed>());
      expect(
        (outcome as SettingsLoadFailed).cacheCorruptionReason,
        isNotNull,
      );
    });
  });

  group('save outcomes', () {
    test('a 2xx PUT answers saved with the canonical row and updates the cache',
        () async {
      routeStandard(
        server: server,
        settings: settingsPayload(settingsVersion: 11),
      );
      server.route('PUT', settingsPath, (request, _) {
        final Map<String, Object?> sent = bodyOf(request);
        expect(sent['settingsVersion'], 7);
        return jsonOk(settingsPayload(settingsVersion: 11));
      });

      final SettingsSaveOutcome outcome = await repository.update(
        organizationId: testOrganizationId,
        actorUserId: testUserId,
        body: <String, Object?>{'settingsVersion': 7, 'organizationName': 'x'},
      );
      expect(outcome, isA<SettingsSaved>());
      expect((outcome as SettingsSaved).settings.settingsVersion, 11);
      final SettingsCacheRead held = await cache.load(
        organizationId: testOrganizationId,
      );
      expect((held as SettingsCacheHit).snapshot.settings.settingsVersion, 11);
    });

    test('a canonical row for another organization is refused, never displayed',
        () async {
      // A server fault answer would be impossible under tenant isolation
      // (§9.2); this simulates the pathological case and proves the
      // repository refuses to display another tenant's row as this one's.
      server.route('PUT', settingsPath, (request, _) {
        expect(bodyOf(request)['settingsVersion'], 7);
        return jsonOk(
          settingsPayload(
            settingsVersion: 9,
            organizationId: testSecondOrganizationId,
          ),
        );
      });
      final SettingsSaveOutcome outcome = await repository.update(
        organizationId: testOrganizationId,
        actorUserId: testUserId,
        body: <String, Object?>{'settingsVersion': 7},
      );
      expect(outcome, isA<SettingsSaveRefused>());
      // And nothing foreign was cached.
      final SettingsCacheRead held = await cache.load(
        organizationId: testOrganizationId,
      );
      expect(held, isA<SettingsCacheMiss>());
    });

    test('a 409 SETTINGS_VERSION_CONFLICT answers conflict (draft stays '
        "the caller's)", () async {
      routeStandard(server: server, settings: settingsPayload());
      server.route('PUT', settingsPath, (_, _) {
        return problem('SETTINGS_VERSION_CONFLICT', status: 409);
      });
      final SettingsSaveOutcome outcome = await repository.update(
        organizationId: testOrganizationId,
        actorUserId: testUserId,
        body: <String, Object?>{'settingsVersion': 7},
      );
      expect(outcome, isA<SettingsSaveConflict>());
      expect((outcome as SettingsSaveConflict).failure.code.name,
          'settingsVersionConflict');
    });

    test('a withheld save answers withheld — an honest non-success that '
        'keeps the draft', () async {
      // No route: the transport withholds the attempt.
      final SettingsSaveOutcome outcome = await repository.update(
        organizationId: testOrganizationId,
        actorUserId: testUserId,
        body: <String, Object?>{'settingsVersion': 7},
      );
      expect(outcome, isA<SettingsSaveWithheld>());
      // And the local data changed because the send never did.
      final SettingsCacheRead held = await cache.load(
        organizationId: testOrganizationId,
      );
      expect(held, isA<SettingsCacheMiss>());
    });

    test('a 503 with no HTTP answer class is withheld, a 503 decision maps '
        'to the same withheld class', () async {
      server.route('PUT', settingsPath, (_, _) {
        return problem('SERVICE_UNAVAILABLE', status: 503);
      });
      final SettingsSaveOutcome outcome = await repository.update(
        organizationId: testOrganizationId,
        actorUserId: testUserId,
        body: <String, Object?>{'settingsVersion': 7},
      );
      expect(outcome, isA<SettingsSaveWithheld>());
    });

    test('a validation refusal answers refused', () async {
      routeStandard(server: server, settings: settingsPayload());
      server.route('PUT', settingsPath, (_, _) {
        return problem('VALIDATION_FAILED', status: 400);
      });
      final SettingsSaveOutcome outcome = await repository.update(
        organizationId: testOrganizationId,
        actorUserId: testUserId,
        body: <String, Object?>{'settingsVersion': 7},
      );
      expect(outcome, isA<SettingsSaveRefused>());
    });

    test('a permission refusal on the write answers refused (a server '
        'decision, never an offline state)', () async {
      routeStandard(server: server, settings: settingsPayload());
      server.route('PUT', settingsPath, (_, _) {
        return problem('PERMISSION_DENIED', status: 403);
      });
      final SettingsSaveOutcome outcome = await repository.update(
        organizationId: testOrganizationId,
        actorUserId: testUserId,
        body: <String, Object?>{'settingsVersion': 7},
      );
      expect(outcome, isA<SettingsSaveRefused>());
    });
  });

  group('§38.18 concurrency proof (A8-extension)', () {
    test('conflict-then-reload is reachable: the winner stays canonical '
        'while the version token keeps blocking stale writes', () async {
      // The winner's write was already applied; every stale attempt 409s.
      routeStandard(
        server: server,
        settings: settingsPayload(settingsVersion: 21),
      );
      server.route('PUT', settingsPath, (_, _) {
        return problem('SETTINGS_VERSION_CONFLICT', status: 409);
      });

      final SettingsSaveOutcome blocked = await repository.update(
        organizationId: testOrganizationId,
        actorUserId: testUserId,
        body: <String, Object?>{'settingsVersion': 7},
      );
      expect(blocked, isA<SettingsSaveConflict>());

      final SettingsLoadOutcome reloaded = await repository.load(
        organizationId: testOrganizationId,
        actorUserId: testUserId,
      );
      expect((reloaded as SettingsLive).settings.settingsVersion, 21,
          reason: 'the reload carries the winning version; the caller '
              'rebases its draft against it');
    });
  });
}
