import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:my_shop_desktop/core/api/api_client.dart';
import 'package:my_shop_desktop/core/api/auth_api.dart';
import 'package:my_shop_desktop/core/api/api_failure.dart';
import 'package:my_shop_desktop/core/api/enrollment_api.dart';
import 'package:my_shop_desktop/core/auth/auth_service.dart';
import 'package:my_shop_desktop/core/auth/auth_session.dart';
import 'package:my_shop_desktop/core/auth/installation_identity_vault.dart';
import 'package:my_shop_desktop/core/auth/secure_token_store.dart';
import 'package:my_shop_desktop/core/auth/snapshot_grace_verifier.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_service.dart';
import 'package:my_shop_desktop/core/offline/outbox/binding_store.dart';

import 'auth_test_harness.dart';

/// The authentication flow over a scripted server and an in-memory device.
/// Every durable claim the flow makes is asserted at the durable facts' own
/// homes: the fake keystore, the local database, the grace service, and the
/// requests the scripted server saw.
void main() {
  final SnapshotTestAuthority authority = SnapshotTestAuthority.instance;

  Map<String, Object?> meResponse({List<String>? organizations}) =>
      <String, Object?>{
        'userId': testUserId,
        'email': 'owner@myshop.test',
        'organizations': organizations ?? <String>[testOrganizationId],
        'sessionId': testSessionId,
        'permissionsVersion': 7,
        'expiresAt': DateTime.now()
            .toUtc()
            .add(const Duration(hours: 1))
            .toIso8601String(),
        'deviceId': null,
      };

  /// Wires the client exactly as production composition does, with scripted
  /// HTTP in place of the network and the test authority's key pinned.
  AuthService buildService({
    required ScriptedServer server,
    required RecordingKeystore keystore,
    required AppDatabase db,
    String? pinnedPem,
    OfflineGraceService? graceService,
  }) {
    final ApiClient client = ApiClient(
      ApiClientConfig(baseUrl: Uri.parse('https://server.test')),
      client: server.client(),
    );
    final SnapshotBackedGraceSignatureVerifier verifier =
        SnapshotBackedGraceSignatureVerifier(
          RsaSignedSnapshotVerifier(
            publicKeyPemSpki: pinnedPem ?? authority.spkiPem,
          ),
        );
    return AuthService(
      AuthFlowDependencies(
        authApi: AuthApi(client),
        enrollmentApi: EnrollmentApi(client),
        tokenStore: SecureTokenStore(keystore),
        identityVault: InstallationIdentityVault(keystore),
        bindingStore: DeviceBindingStore(db),
        graceService:
            graceService ?? OfflineGraceService(db, verifier: verifier),
        verifier: verifier,
      ),
      platformName: () => 'windows',
    );
  }

  /// The offline session the flow writes into, built the same way tests can
  /// read it back (the verifier is the same object the flow used).
  OfflineGraceService offlineGraceOf(AppDatabase db) => OfflineGraceService(
    db,
    verifier: SnapshotBackedGraceSignatureVerifier(
      RsaSignedSnapshotVerifier(publicKeyPemSpki: authority.spkiPem),
    ),
  );

  /// The happy-path script: one-membership account, ACTIVE registration,
  /// binding, a verifiable snapshot, and a 204 logout.
  void enableHappyPath(ScriptedServer server) {
    server.route(
      'POST',
      '/api/v1/auth/login',
      (_, _) => jsonOk(<String, Object?>{
        'accessToken': testAccessToken,
        'expiresIn': 300,
        'refreshToken': testRefreshToken,
        'refreshExpiresIn': 43200,
      }),
    );
    server.route('GET', '/api/v1/auth/me', (_, _) => jsonOk(meResponse()));
    server.route(
      'POST',
      '/api/v1/organizations/$testOrganizationId/devices',
      (_, _) => jsonOk(<String, Object?>{
        'deviceId': testDeviceId,
        'status': 'ACTIVE',
      }),
    );
    server.route(
      'POST',
      '/api/v1/organizations/$testOrganizationId/devices/$testDeviceId/bind-session',
      (_, _) => jsonOk(<String, Object?>{
        'accessToken': testBoundAccessToken,
        'expiresIn': 300,
      }),
    );
    server.route(
      'POST',
      '/api/v1/organizations/$testOrganizationId/authorization/snapshot',
      (_, _) => jsonOk(<String, Object?>{
        'snapshot': authority.mint(),
        'expiresAt': DateTime.now()
            .toUtc()
            .add(const Duration(hours: 72))
            .toIso8601String(),
      }),
    );
    server.route(
      'POST',
      '/api/v1/auth/logout',
      (_, _) => http.Response('', 204),
    );
  }

  group('sign-in (AC-3, AC-4)', () {
    test(
      'a successful one-membership sign-in completes the whole establishment',
      () async {
        final ScriptedServer server = ScriptedServer();
        enableHappyPath(server);
        final RecordingKeystore keystore = RecordingKeystore();
        final AppDatabase db = memoryDatabase();
        final AuthService service = buildService(
          server: server,
          keystore: keystore,
          db: db,
        );

        final SignInResult result = await service.signIn(
          email: 'owner@myshop.test',
          password: 'x',
        );

        expect(
          result.kind,
          SignInResultKind.success,
          reason: 'outcome: ${result.failure}',
        );
        final AuthSession session = result.session!;
        expect(session.organizationId, testOrganizationId);
        expect(
          session.deviceId,
          testDeviceId,
          reason: 'the server-issued bound device id',
        );
        expect(session.boundTokens?.accessToken, testBoundAccessToken);
        expect(
          session.boundTokens?.refreshToken,
          testRefreshToken,
          reason: 'binding never rotates the refresh family (M2-S5)',
        );

        // The durable facts: binding installed, offline session established.
        final DeviceBindingStore binding = DeviceBindingStore(db);
        expect(await binding.readBinding(), (
          organizationId: testOrganizationId,
          deviceId: testDeviceId,
        ));
        expect((await binding.presence()).hasOrganization, isTrue);

        final OfflineGraceStatus status = await offlineGraceOf(db).status();
        expect(
          status.hasSession,
          isTrue,
          reason: 'the grace session was earned online',
        );
        expect(status.isReadOnlyForMutations, isFalse);

        final keystoreHoldings = tokenRecordOf(keystore);
        expect(keystoreHoldings?['accessToken'], testBoundAccessToken);
        expect(keystoreHoldings?['refreshToken'], testRefreshToken);

        // The governing acceptance cross-check: no token sentinel anywhere in
        // the local database.
        final String dump = await dumpLocalDatabase(db);
        expect(dump.contains('TOKEN sentry'), isFalse);

        // The server saw the installation credential only as its request body,
        // never in any later read-back; the enrollment requests it needed.
        expect(
          server.received.any(
            (http.Request request) =>
                request.body.contains('installationSecret'),
          ),
          isTrue,
        );
      },
    );

    test(
      'a refused login surfaces the server problem code, never a session',
      () async {
        final ScriptedServer server = ScriptedServer()
          ..route(
            'POST',
            '/api/v1/auth/login',
            (_, _) =>
                problem('UNAUTHENTICATED', status: 401, traceId: 'trace-1'),
          );
        final AuthService service = buildService(
          server: server,
          keystore: RecordingKeystore(),
          db: memoryDatabase(),
        );

        final SignInResult result = await service.signIn(
          email: 'owner@myshop.test',
          password: 'wrong',
        );

        expect(result.kind, SignInResultKind.refused);
        expect(result.failure, isA<ApiFailure>());
        expect(
          (result.failure as ApiFailure).code,
          ApiErrorCode.unauthenticated,
        );
        expect((result.failure as ApiFailure).traceId, 'trace-1');
        expect(result.session, isNull);
      },
    );

    test('a throttled login is a refusal, not a withheld attempt', () async {
      final ScriptedServer server = ScriptedServer()
        ..route(
          'POST',
          '/api/v1/auth/login',
          (_, _) => problem('RATE_LIMITED', status: 429),
        );
      final AuthService service = buildService(
        server: server,
        keystore: RecordingKeystore(),
        db: memoryDatabase(),
      );

      final SignInResult result = await service.signIn(
        email: 'owner@myshop.test',
        password: 'x',
      );
      expect(result.kind, SignInResultKind.refused);
      expect((result.failure as ApiFailure).code, ApiErrorCode.rateLimited);
      expect((result.failure as ApiFailure).httpStatus, 429);
    });

    test(
      'an attempt the transport withheld is honest about the silence',
      () async {
        final ScriptedServer server = ScriptedServer()
          ..route('POST', '/api/v1/auth/login', (_, _) {
            throw http.ClientException(
              'connection dropped',
              Uri.parse('https://server.test'),
            );
          });
        final AuthService service = buildService(
          server: server,
          keystore: RecordingKeystore(),
          db: memoryDatabase(),
        );

        final SignInResult result = await service.signIn(
          email: 'owner@myshop.test',
          password: 'x',
        );
        expect(result.kind, SignInResultKind.withheld);
        final ApiFailure failure = result.failure as ApiFailure;
        expect(failure.code, ApiErrorCode.serviceUnavailable);
        expect(
          failure.httpStatus,
          isNull,
          reason: 'no HTTP verdict ever arrived',
        );
        expect(result.session, isNull);
      },
    );

    test('multi-membership accounts wait at the selection surface; a foreign id is refused', () async {
      final ScriptedServer server = ScriptedServer();
      enableHappyPath(server);
      server.clearRoute(
        'POST',
        '/api/v1/organizations/$testOrganizationId/devices',
      );
      server.clearRoute(
        'POST',
        '/api/v1/organizations/$testOrganizationId/devices/$testDeviceId/bind-session',
      );
      server.clearRoute(
        'POST',
        '/api/v1/organizations/$testOrganizationId/authorization/snapshot',
      );
      server.route(
        'GET',
        '/api/v1/auth/me',
        (_, _) => jsonOk(
          meResponse(
            organizations: <String>[
              testOrganizationId,
              testSecondOrganizationId,
            ],
          ),
        ),
      );
      // Selecting the second membership re-runs enrollment against *its*
      // org-scoped routes, and its snapshot carries its own organization fact.
      server.route(
        'POST',
        '/api/v1/organizations/$testSecondOrganizationId/devices',
        (_, _) => jsonOk(<String, Object?>{
          'deviceId': testDeviceId,
          'status': 'ACTIVE',
        }),
      );
      server.route(
        'POST',
        '/api/v1/organizations/$testSecondOrganizationId/devices/$testDeviceId/bind-session',
        (_, _) => jsonOk(<String, Object?>{
          'accessToken': testBoundAccessToken,
          'expiresIn': 300,
        }),
      );
      server.route(
        'POST',
        '/api/v1/organizations/$testSecondOrganizationId/authorization/snapshot',
        (_, _) => jsonOk(<String, Object?>{
          'snapshot': authority.mint(org: testSecondOrganizationId),
          'expiresAt': DateTime.now()
              .toUtc()
              .add(const Duration(hours: 72))
              .toIso8601String(),
        }),
      );
      final RecordingKeystore keystore = RecordingKeystore();
      final AppDatabase db = memoryDatabase();
      final AuthService service = buildService(
        server: server,
        keystore: keystore,
        db: db,
      );

      final SignInResult first = await service.signIn(
        email: 'o@myshop.test',
        password: 'x',
      );
      expect(first.kind, SignInResultKind.success);
      expect(
        first.session!.organizationId,
        isNull,
        reason: 'the flow does not select',
      );
      expect(
        first.session!.organizations,
        unorderedEquals(<String>[testOrganizationId, testSecondOrganizationId]),
      );

      final SignInResult foreign = await service.chooseOrganization(
        session: first.session!,
        organizationId: '99999999-9999-4999-8999-999999999999',
      );
      expect(
        foreign.kind,
        SignInResultKind.withheld,
        reason: '§9.3: a choice is checkable state, and this one is not a membership',
      );

      final SignInResult chosen = await service.chooseOrganization(
        session: first.session!,
        organizationId: testSecondOrganizationId,
      );
      expect(chosen.kind, SignInResultKind.success);
      expect(chosen.session?.organizationId, testSecondOrganizationId);
    });
  });

  group('restore (AC-2)', () {
    test('an empty keystore restores signed out', () async {
      final AuthService service = buildService(
        server: ScriptedServer(),
        keystore: RecordingKeystore(),
        db: memoryDatabase(),
      );
      final RestoreSessionResult restored = await service.restore();
      expect(restored.session, isNull);
      expect(restored.keystoreFailed, isFalse);
    });

    test('tokens without a device binding are an abandoned enrollment: wiped, signed out', () async {
      final RecordingKeystore keystore = RecordingKeystore();
      final SecureTokenStore store = SecureTokenStore(keystore);
      await store.save(
        StoredTokens(
          accessToken: testAccessToken,
          refreshToken: testRefreshToken,
          accessExpiresAtDevice: DateTime.now().add(const Duration(hours: 1)),
        ),
      );
      final AuthService service = buildService(
        server: ScriptedServer(),
        keystore: keystore,
        db: memoryDatabase(),
      );

      final RestoreSessionResult restored = await service.restore();

      expect(restored.session, isNull);
      expect(restored.keystoreFailed, isFalse);
      expect(
        tokenRecordOf(keystore),
        isNull,
        reason: 'orphaned tokens are wiped, not carried',
      );
    });

    test(
      'tokens plus binding restore into a session (the boot offline session)',
      () async {
        final RecordingKeystore keystore = RecordingKeystore();
        final AppDatabase db = memoryDatabase();
        final SecureTokenStore store = SecureTokenStore(keystore);
        await store.save(
          StoredTokens(
            accessToken: testAccessToken,
            refreshToken: testRefreshToken,
            accessExpiresAtDevice: DateTime.now().add(const Duration(hours: 1)),
          ),
        );
        await DeviceBindingStore(
          db,
        ).install(organizationId: testOrganizationId, deviceId: testDeviceId);
        final AuthService service = buildService(
          server: ScriptedServer(),
          keystore: keystore,
          db: db,
        );

        final RestoreSessionResult restored = await service.restore();

        expect(restored.keystoreFailed, isFalse);
        final AuthSession session = restored.session!;
        expect(session.organizationId, testOrganizationId);
        expect(session.deviceId, testDeviceId);
        expect(session.boundTokens?.accessToken, testAccessToken);
      },
    );

    test(
      'a keystore that cannot hand a record back confirms failure, no session',
      () async {
        final RecordingKeystore keystore = RecordingKeystore()
          ..failReadKeys = <String>{'auth.access_token'};
        final AuthService service = buildService(
          server: ScriptedServer(),
          keystore: keystore,
          db: memoryDatabase(),
        );

        final RestoreSessionResult restored = await service.restore();
        expect(restored.session, isNull);
        expect(
          restored.keystoreFailed,
          isTrue,
          reason: 'fail-closed names the fault honestly',
        );
      },
    );
  });

  group('refresh and rotation (AC-8)', () {
    test('a live rotation is persisted atomically', () async {
      const String rotatedAccess = 'TOKEN sentry-rotated-access-unit-test';
      const String rotatedRefresh = 'TOKEN sentry-rotated-refresh-unit-test';
      final ScriptedServer server = ScriptedServer()
        ..route(
          'POST',
          '/api/v1/auth/refresh',
          (_, _) => jsonOk(<String, Object?>{
            'accessToken': rotatedAccess,
            'expiresIn': 300,
            'refreshToken': rotatedRefresh,
            'refreshExpiresIn': 43200,
          }),
        );
      final RecordingKeystore keystore = RecordingKeystore();
      final AuthService service = buildService(
        server: server,
        keystore: keystore,
        db: memoryDatabase(),
      );

      final RefreshOutcome outcome = await service.refresh(
        refreshToken: testRefreshToken,
      );

      expect(outcome.tokens, isNotNull);
      expect(outcome.familyLost, isFalse);
      final keystoreHoldings = tokenRecordOf(keystore);
      expect(keystoreHoldings?['refreshToken'], rotatedRefresh);
    });

    test(
      'a refused refresh ends with the mapped failure and nothing persisted',
      () async {
        final ScriptedServer server = ScriptedServer()
          ..route(
            'POST',
            '/api/v1/auth/refresh',
            (_, _) => problem('TOKEN_STALE', status: 401),
          );
        final RecordingKeystore keystore = RecordingKeystore();
        final AuthService service = buildService(
          server: server,
          keystore: keystore,
          db: memoryDatabase(),
        );

        final RefreshOutcome outcome = await service.refresh(
          refreshToken: testRefreshToken,
        );

        expect(outcome.tokens, isNull);
        expect(outcome.familyLost, isFalse);
        expect(outcome.failure, isA<ApiFailure>());
        expect((outcome.failure as ApiFailure).code, ApiErrorCode.tokenStale);
        expect(
          tokenRecordOf(keystore),
          isNull,
          reason: 'a refusal persists no fresh pair',
        );
      },
    );

    test(
      'a rotation whose fresh pair cannot be stored cannot continue a session',
      () async {
        const String rotatedRefresh = 'TOKEN sentry-rotated-refresh-unit-test';
        final ScriptedServer server = ScriptedServer()
          ..route(
            'POST',
            '/api/v1/auth/refresh',
            (_, _) => jsonOk(<String, Object?>{
              'accessToken': testAccessToken,
              'expiresIn': 300,
              'refreshToken': rotatedRefresh,
              'refreshExpiresIn': 43200,
            }),
          );
        final RecordingKeystore keystore = RecordingKeystore()
          ..refuseWriteKeys = <String>{'auth.access_token'};
        final AuthService service = buildService(
          server: server,
          keystore: keystore,
          db: memoryDatabase(),
        );

        final RefreshOutcome outcome = await service.refresh(
          refreshToken: testRefreshToken,
        );

        expect(
          outcome.familyLost,
          isTrue,
          reason: 'the presented pair is dead and the fresh one is unstoreable',
        );
        expect(
          outcome.refreshToken,
          rotatedRefresh,
          reason: 'the only handle the flow has on the family',
        );
        expect(tokenRecordOf(keystore), isNull);
      },
    );
  });

  group('sign-out (AC-9)', () {
    test('the local keystore, binding, and grace record die with the action; the server call decides nothing locally', () async {
      final ScriptedServer server = ScriptedServer();
      enableHappyPath(server);
      final RecordingKeystore keystore = RecordingKeystore();
      final AppDatabase db = memoryDatabase();
      final OfflineGraceService grace = offlineGraceOf(db);
      final AuthService service = buildService(
        server: server,
        keystore: keystore,
        db: db,
        graceService: grace,
      );
      final SignInResult signedIn = await service.signIn(
        email: 'o@myshop.test',
        password: 'x',
      );
      expect(signedIn.kind, SignInResultKind.success);
      final DeviceBindingStore binding = DeviceBindingStore(db);

      // The server route for logout is deliberately removed: the family is
      // gone from this script, and the device must still finish clean.
      server.clearRoute('POST', '/api/v1/auth/logout');

      await service.signOut(refreshToken: testRefreshToken);

      expect(
        tokenRecordOf(keystore),
        isNull,
        reason: 'no token byte survives sign-out',
      );
      expect((await binding.presence()).hasOrganization, isFalse);
      final OfflineGraceStatus status = await grace.status();
      expect(status.hasSession, isFalse);
      // The offline gate's read posture never changes with the session.
      expect(status.readsAllowed, isTrue);
    });
  });

  group('enrollment failure rollback (AC-5)', () {
    test(
      'a keystore that breaks at token save rolls the whole sign-in back',
      () async {
        final ScriptedServer server = ScriptedServer();
        enableHappyPath(server);
        final RecordingKeystore keystore = RecordingKeystore()
          ..refuseWriteKeys = <String>{'auth.access_token'};
        final AppDatabase db = memoryDatabase();
        final AuthService service = buildService(
          server: server,
          keystore: keystore,
          db: db,
        );

        final SignInResult result = await service.signIn(
          email: 'o@myshop.test',
          password: 'x',
        );

        expect(result.kind, SignInResultKind.withheld);
        // No half-bound durable state survived the failure.
        final DeviceBindingStore binding = DeviceBindingStore(db);
        expect((await binding.presence()).hasOrganization, isFalse);
        expect((await binding.presence()).hasDevice, isFalse);
        final String dump = await dumpLocalDatabase(db);
        expect(dump.contains('TOKEN sentry'), isFalse);
      },
    );

    test(
      'a snapshot that fails local verification rolls binding and grace back',
      () async {
        final ScriptedServer server = ScriptedServer();
        enableHappyPath(server);
        server.route(
          'POST',
          '/api/v1/organizations/$testOrganizationId/authorization/snapshot',
          // Material signed by a key *other than the deployment's pinned one*:
          // the flow receives it, verifies it, and refuses.
          (_, _) => jsonOk(<String, Object?>{
            'snapshot': SnapshotTestAuthority.foreign().mint(),
            'expiresAt': DateTime.now()
                .toUtc()
                .add(const Duration(hours: 72))
                .toIso8601String(),
          }),
        );
        final RecordingKeystore keystore = RecordingKeystore();
        final AppDatabase db = memoryDatabase();
        final AuthService service = buildService(
          server: server,
          keystore: keystore,
          db: db,
          pinnedPem: authority.spkiPem,
        );

        final SignInResult result = await service.signIn(
          email: 'o@myshop.test',
          password: 'x',
        );

        expect(result.kind, SignInResultKind.withheld);
        expect(
          tokenRecordOf(keystore),
          isNull,
          reason: 'the just-earned pair is wiped, not half-kept',
        );
        final String dump = await dumpLocalDatabase(db);
        expect(dump.contains('TOKEN sentry'), isFalse);
      },
    );
  });
}
