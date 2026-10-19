/// The composition of the client's authentication capability — the M2-S7
/// half of Master Plan §6.2's `core/auth` ("session store, token refresh,
/// secure credential storage"), assembled here so every dependency stays
/// injectable and no global mutable singleton exists (§6.5, ADR-003).
///
/// Two configuration values come from the build (`--dart-define`), because a
/// client binary is compiled for the deployment it belongs to:
///
/// - `MY_SHOP_API_BASE_URL` — the server origin (§34.1). **Required**: a
///   client without an origin has nothing honest to say; composition fails
///   fast with the define's name in the error, and the error names the
///   define rather than inventing a default.
/// - `MY_SHOP_SNAPSHOT_PUBLIC_KEY` — the deployment's SPKI public key for
///   the signed authorization snapshot (ADR-006). **Optional by design**:
///   without it the client still signs in, but the offline grace record can
///   never be verified, so no offline session is established — the
///   verifier's no-accepting-default rule (M1b-S8 D-2) applied at
///   composition. The shell's grace line stays honestly neutral (§38.31).
///
/// Everything else is construction, in the dependency order the plan fixes:
/// the platform keystore feeds the token vault and the installation vault
/// (§13.6); the transport feeds the identity and enrollment APIs (§7.3); the
/// Drift database feeds the device binding and the offline-grace service
/// (§38.6); the verifier feeds the grace service (§38.16.3, M1b-S8's port
/// with this slice's concrete implementation).
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_shop_desktop/core/api/api_client.dart';
import 'package:my_shop_desktop/core/api/auth_api.dart';
import 'package:my_shop_desktop/core/api/enrollment_api.dart';
import 'package:my_shop_desktop/core/auth/auth_service.dart';
import 'package:my_shop_desktop/core/auth/installation_identity_vault.dart';
import 'package:my_shop_desktop/core/auth/keystore.dart';
import 'package:my_shop_desktop/core/auth/secure_token_store.dart';
import 'package:my_shop_desktop/core/auth/snapshot_grace_verifier.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_service.dart';
import 'package:my_shop_desktop/core/offline/outbox/binding_store.dart';

/// The dart-define naming the server origin (§34.1).
const String apiBaseUrlDefine = 'MY_SHOP_API_BASE_URL';

/// The dart-define carrying the pinned SPKI public key (ADR-006).
const String snapshotPublicKeyDefine = 'MY_SHOP_SNAPSHOT_PUBLIC_KEY';

/// The §13.6 platform keystore.
final Provider<Keystore> keystoreProvider = Provider<Keystore>(
  (Ref ref) => FlutterSecureKeystore(),
);

/// The local Drift database (§38.6). The production constructor opens its
/// own connection lazily; tests override this provider with a memory
/// database (`AppDatabase.forTesting`).
final Provider<AppDatabase> appDatabaseProvider = Provider<AppDatabase>(
  (Ref ref) => AppDatabase(),
);

/// The one authentication capability, fully composed.
final Provider<AuthKit> authKitProvider = Provider<AuthKit>((Ref ref) {
  return AuthKit.compose(
    keystore: ref.watch(keystoreProvider),
    db: ref.watch(appDatabaseProvider),
  );
});

/// The §7.3 transport plus everything reachable through it, as one value.
/// Every member is injectable so tests drive real transitions with fakes
/// (§6.5: no service locator, no global mutable state); [AuthKit.compose] is
/// the production wiring of the same injectable shape.
class AuthKit {
  AuthKit({
    required this.tokenStore,
    required this.identityVault,
    required this.bindingStore,
    required this.apiClient,
    required this.authApi,
    required this.enrollmentApi,
    required this.verifier,
    required this.graceService,
    required this.authService,
  });

  final SecureTokenStore tokenStore;
  final InstallationIdentityVault identityVault;
  final DeviceBindingStore bindingStore;
  final ApiClient apiClient;
  final AuthApi authApi;
  final EnrollmentApi enrollmentApi;
  final SnapshotBackedGraceSignatureVerifier verifier;
  final OfflineGraceService graceService;
  final AuthService authService;

  /// The production composition. [baseUrl] and [snapshotPublicKeyPem]
  /// complete the two dart-defines; test callers construct the kit directly
  /// instead of going through [authKitProvider].
  factory AuthKit.compose({
    required Keystore keystore,
    required AppDatabase db,
    String? baseUrl,
    String? snapshotPublicKeyPem,
  }) {
    // `const String.fromEnvironment` is non-null and empty when the define is
    // absent, so the refusal condition is exactly "nothing was configured".
    final String configuredOrigin =
        baseUrl ?? const String.fromEnvironment(apiBaseUrlDefine);
    if (configuredOrigin.isEmpty) {
      throw StateError(
        'the client origin is not configured: pass --dart-define=$apiBaseUrlDefine=<origin>',
      );
    }
    final Uri? origin = Uri.tryParse(configuredOrigin);
    if (origin == null || !origin.hasScheme || origin.host.isEmpty) {
      throw StateError(
        'the configured client origin is not a valid URI: $configuredOrigin',
      );
    }

    final ApiClient apiClient = ApiClient(ApiClientConfig(baseUrl: origin));
    final AuthApi authApi = AuthApi(apiClient);
    final EnrollmentApi enrollmentApi = EnrollmentApi(apiClient);
    final SecureTokenStore tokenStore = SecureTokenStore(keystore);
    final InstallationIdentityVault identityVault = InstallationIdentityVault(
      keystore,
    );
    final DeviceBindingStore bindingStore = DeviceBindingStore(db);

    final SnapshotBackedGraceSignatureVerifier verifier =
        SnapshotBackedGraceSignatureVerifier(
          RsaSignedSnapshotVerifier(publicKeyPemSpki: snapshotPublicKeyPem),
        );
    final OfflineGraceService graceService = OfflineGraceService(
      db,
      verifier: verifier,
    );

    final AuthFlowDependencies deps = AuthFlowDependencies(
      authApi: authApi,
      enrollmentApi: enrollmentApi,
      tokenStore: tokenStore,
      identityVault: identityVault,
      bindingStore: bindingStore,
      graceService: graceService,
      verifier: verifier,
    );
    final AuthService authService = AuthService(deps);

    return AuthKit(
      tokenStore: tokenStore,
      identityVault: identityVault,
      bindingStore: bindingStore,
      apiClient: apiClient,
      authApi: authApi,
      enrollmentApi: enrollmentApi,
      verifier: verifier,
      graceService: graceService,
      authService: authService,
    );
  }
}
