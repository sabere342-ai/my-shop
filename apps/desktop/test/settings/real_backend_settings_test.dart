// My Shop — M3-S4 real-backend gated settings integration.
//
// This suite drives the *real* client stack (AuthApi → AuthorizationApi →
// SettingsApi → SettingsRepository → SettingsSnapshotCache) against a locally
// running My Shop API. It is env-gated: it runs only when every variable below
// is present and is skipped cleanly otherwise, so ordinary offline test runs,
// CI, and the predecessor suites are never coupled to a server process.
//
// Required environment (see docs/governance/MY_SHOP_M3_S4_SLICE_RECORD.md §8):
//   MY_SHOP_E2E_URL       base URL of the live API, e.g. http://127.0.0.1:3017
//   MY_SHOP_E2E_EMAIL     the provisioned owner's email
//   MY_SHOP_E2E_PASSWORD  the provisioned owner's password (>= 12 chars)
//
// What it proves, end to end, without any scripted server:
// 1. login answers the accepted M2-S2 token wire and the transport injects it;
// 2. the verified identity answers the session's organization (§9.3);
// 3. the effective authorization answer marks the seed owner (§22.2 key);
// 4. GET settings answers §22.2 typed settings (strictly parsed client-side);
// 5. a PUT carrying only the touched field + version token persists and the
//    canonical post-write answer is the new truth (version advanced);
// 6. a stale version token answers 409 SETTINGS_VERSION_CONFLICT (§38.18),
//    classified by the repository as a conflict — never softened;
// 7. the versioned local cache holds exactly the saved snapshot afterwards,
//    the §38.18 offline display source (server-owned, read-only on the client);
// 8. the original name is restored, leaving the database as it was found.

import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/api/api_client.dart';
import 'package:my_shop_desktop/core/api/api_failure.dart';
import 'package:my_shop_desktop/core/api/auth_api.dart';
import 'package:my_shop_desktop/core/api/authorization_api.dart';
import 'package:my_shop_desktop/core/api/settings_api.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/settings/settings_snapshot_cache.dart';
import 'package:my_shop_desktop/features/settings/data/settings_repository.dart';
import 'package:my_shop_desktop/features/settings/models/organization_settings.dart';

/// The suite runs only under the local real-backend gate.
final bool _e2eGatePresent =
    Platform.environment['MY_SHOP_E2E_URL'] != null &&
    Platform.environment['MY_SHOP_E2E_EMAIL'] != null &&
    Platform.environment['MY_SHOP_E2E_PASSWORD'] != null;

const String _skipReason =
    'real-backend gated suite: MY_SHOP_E2E_URL / MY_SHOP_E2E_EMAIL / '
    'MY_SHOP_E2E_PASSWORD must all be set, naming a live local API; '
    'ordinary runs are skipped by design.';

void main() {
  if (!_e2eGatePresent) {
    // The honest absence was a decision, not an oversight (mission §7): the
    // skip reason names the variables, so a lost gate is discoverable.
    stdout.writeln('SKIP: $_skipReason');
    return;
  }

  late AppDatabase db;
  late ApiClient client;
  late String apiBase;
  late String email;
  late String password;

  setUp(() {
    apiBase = Platform.environment['MY_SHOP_E2E_URL']!;
    email = Platform.environment['MY_SHOP_E2E_EMAIL']!;
    password = Platform.environment['MY_SHOP_E2E_PASSWORD']!;
    db = AppDatabase.forTesting(NativeDatabase.memory());
    client = ApiClient(
      // A generous budget: the gate names a *local* API, but a booting
      // Postgres or a cold argon2 verification must not classify as a
      // transport withholding while the run is still being set up.
      ApiClientConfig(
        baseUrl: Uri.parse(apiBase),
        timeout: const Duration(seconds: 60),
      ),
    );
    addTearDown(client.dispose);
    addTearDown(() async => db.close());
  });

  test(
    'login → owner authorization → typed settings → versioned write, '
    '409 on a stale token, and the cache holds the saved row',
    timeout: const Timeout(Duration(minutes: 3)),
    () async {
      // 1. Login on the real identity surface; the token pair travels from
      // the server's accepted M2-S2 wire, and the transport bears it.
      final LoginWireResponse session = await AuthApi(client).login(
        email: email,
        password: password,
      );
      client.tokenSource.update(session.accessToken);
      expect(session.expiresIn, greaterThan(0));

      // 2. The verified identity answers the organization the session owns
      // (§9.3: tenant scope from credentials, never from a request body).
      final MeWireResponse me = await AuthApi(client).me();
      expect(me.email, email);
      expect(me.organizations, isNotEmpty);
      final String organizationId = me.organizations.single;
      final String userId = me.userId;

      // 3. The effective set marks the seed owner (§22.2's only key).
      final EffectiveAuthorization effective = await AuthorizationApi(
        client,
      ).me(organizationId: organizationId);
      expect(effective.isOwner, isTrue);
      expect(effective.organizationId, organizationId);

      // 4. Authoritative GET → live answer, and the cache records exactly
      // what the server said, at the version it said.
      final SettingsSnapshotCache cache = SettingsSnapshotCache(db);
      final SettingsRepository repository = SettingsRepository(
        SettingsApi(client),
        cache,
      );
      final SettingsLoadOutcome load = await repository.load(
        organizationId: organizationId,
        actorUserId: userId,
      );
      final SettingsLive live = load as SettingsLive;
      final OrganizationSettings initial = live.settings;
      expect(initial.organizationId, organizationId);
      expect(initial.currency.wire, 'EGP');
      expect(initial.settingsVersion, greaterThanOrEqualTo(1));

      final CachedSettingsSnapshot cachedBefore =
          ((await cache.load(
        organizationId: organizationId,
      )) as SettingsCacheHit)
              .snapshot;
      expect(cachedBefore.settings.settingsVersion, initial.settingsVersion);

      // 5. The changed organization name — only the touched field plus the
      // §38.18 token travels (§34.1 field-authorized partial update).
      const String renamed = 'Flutter E2E م3-س4';
      final Map<String, Object?> renameBody = <String, Object?>{
        'organizationName': renamed,
        'settingsVersion': initial.settingsVersion,
      };
      final SettingsSaveOutcome saved = await repository.update(
        organizationId: organizationId,
        actorUserId: userId,
        body: renameBody,
      );
      final SettingsSaved persisted = saved as SettingsSaved;
      expect(persisted.settings.organizationName, renamed);
      expect(persisted.settings.settingsVersion, initial.settingsVersion + 1);

      // The truth on the server is the canonical post-write answer: re-read.
      final SettingsLoadOutcome reread = await repository.load(
        organizationId: organizationId,
        actorUserId: userId,
      );
      final OrganizationSettings nowLive = (reread as SettingsLive).settings;
      expect(nowLive.organizationName, renamed);
      expect(nowLive.settingsVersion, persisted.settings.settingsVersion);

      // 6. §38.18 concurrency: the now-stale token answers the 409 problem,
      // classified as a conflict — never refused, offline, or success.
      final SettingsSaveOutcome conflict = await repository.update(
        organizationId: organizationId,
        actorUserId: userId,
        body: renameBody, // the pre-write version, now stale
      );
      final SettingsSaveConflict stale = conflict as SettingsSaveConflict;
      expect(stale.failure.code, ApiErrorCode.settingsVersionConflict);
      expect(stale.failure.httpStatus, 409);

      // 7. The versioned cache holds exactly the saved snapshot — not the
      // refused draft, not the pre-write row.
      final CachedSettingsSnapshot cachedAfter = ((await cache.load(
        organizationId: organizationId,
      )) as SettingsCacheHit)
          .snapshot;
      expect(cachedAfter.settings.organizationName, renamed);
      expect(
        cachedAfter.settings.settingsVersion,
        persisted.settings.settingsVersion,
      );
      expect(cachedAfter.fetchedByUserId, userId);

      // 8. Restore the original name so the database is left as it was
      // found; a failed restore fails the suite loudly.
      final SettingsSaveOutcome restored = await repository.update(
        organizationId: organizationId,
        actorUserId: userId,
        body: <String, Object?>{
          'organizationName': initial.organizationName,
          'settingsVersion': persisted.settings.settingsVersion,
        },
      );
      expect(
        (restored as SettingsSaved).settings.organizationName,
        initial.organizationName,
      );
    },
  );
}
