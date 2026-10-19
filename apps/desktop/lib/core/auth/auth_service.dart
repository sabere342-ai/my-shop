/// The authentication flow: login, enrollment, restore, refresh, logout —
/// Master Plan §10, §12, §38.16, §9.3; slices M2-S2/M2-S5 contracts, M2-S7
/// delivery (client half).
///
/// The sequence the flow guarantees, and the invariants it preserves:
///
/// 1. **Login** hands credentials to the server; nothing is stored before
///    the server's own verified answer (§7.3: the client never mints a
///    session). A refusal surfaces the server's problem code; a withheld
///    attempt (no HTTP answer) surfaces "withheld" (§38.11: an attempt that
///    never reached a verdict is never reported as refused, and never as
///    accepted).
/// 2. **Identity** reads `/auth/me` so every id afterwards is server-derived
///    (§9.3): the user, the memberships, the per-session device binding.
/// 3. **Organization selection** is a fact of the verified membership list:
///    exactly one membership selects itself; more than one requires the
///    setup screen (there is no setter that could assert a foreign id).
/// 4. **Enrollment** binds the device: register the installation
///    (idempotent per §12.1), bind the session (re-minting the access token
///    with the `did` claim, M2-S5), install the server-issued binding pair,
///    and establish the offline grace session from the signed authorization
///    snapshot (§38.16.3), verified by the concrete verifier before
///    anything is stored from it. Any enrollment failure fails the sign-in:
///    tokens are wiped, no half-bound session survives (AC-5).
/// 5. **Restore** (boot) reads the keystore — the only token source there
///    is. Tokens absent → signed out. A record the keystore cannot hand
///    back intact → signed out, wiped (fail-closed, §13.4/§13.6). Tokens
///    present but the device binding absent → tokens wiped (an abandoned
///    enrollment is not a session).
/// 6. **Refresh** rotates exactly once per renewed pair (§10.3); a refusal
///    ends the session; a keystore failure after a server-side rotation is
///    the one state that *must* end the session (the presented token is
///    dead, the fresh one is unstoreable).
/// 7. **Logout** wipes the local secrets *first*, then attempts the server
///    revocation; an unreachable server cannot resurrect local state
///    (§38.16.4's local-commitment posture, §13.6).
library;

import 'dart:io';

import 'package:my_shop_desktop/core/api/api_failure.dart';
import 'package:my_shop_desktop/core/api/auth_api.dart';
import 'package:my_shop_desktop/core/api/enrollment_api.dart';
import 'package:my_shop_desktop/core/auth/auth_session.dart';
import 'package:my_shop_desktop/core/auth/installation_identity_vault.dart';
import 'package:my_shop_desktop/core/auth/keystore.dart';
import 'package:my_shop_desktop/core/auth/secure_token_store.dart';
import 'package:my_shop_desktop/core/auth/snapshot_grace_verifier.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_record.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_service.dart';
import 'package:my_shop_desktop/core/offline/outbox/binding_store.dart';

/// Everything the flow composes, injected so tests drive real transitions
/// with fakes (§6.5: no service locator, no global mutable state).
class AuthFlowDependencies {
  AuthFlowDependencies({
    required this.authApi,
    required this.enrollmentApi,
    required this.tokenStore,
    required this.identityVault,
    required this.bindingStore,
    required this.graceService,
    required this.verifier,
  });

  final AuthApi authApi;
  final EnrollmentApi enrollmentApi;
  final SecureTokenStore tokenStore;
  final InstallationIdentityVault identityVault;
  final DeviceBindingStore bindingStore;
  final OfflineGraceService graceService;

  /// The concrete M1b-S8 port implementation (M2-S7 delivery): it builds the
  /// grace record from the signed snapshot's own bytes and refuses a
  /// non-verifying snapshot.
  final SnapshotBackedGraceSignatureVerifier verifier;
}

/// The authentication flow orchestrator. Owns no durable state; every fact
/// goes to a store whose own contract is separately tested.
class AuthService {
  AuthService(this._deps, {String Function()? platformName})
    : _platformName = platformName ?? _operatingPlatform;

  /// The reported platform for §12.1, from the host. Tests inject the value
  /// so both V1 targets are deterministic.
  static String _operatingPlatform() =>
      Platform.isAndroid ? 'android' : 'windows';

  final AuthFlowDependencies _deps;
  final String Function() _platformName;

  /// Signs a user in end to end, per the class contract above.
  Future<SignInResult> signIn({
    required String email,
    required String password,
  }) async {
    final LoginWireResponse tokens;
    try {
      tokens = await _deps.authApi.login(email: email, password: password);
    } on ApiFailure catch (error) {
      return _signInFailure(error);
    }

    final DateTime accessExpiry = DateTime.now().add(
      Duration(seconds: tokens.expiresIn),
    );
    final StoredSessionTokens sessionTokens = StoredSessionTokens(
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: accessExpiry,
    );

    final MeWireResponse identity;
    try {
      identity = await _deps.authApi.me();
      await _saveTokens(tokens, accessExpiry);
    } on ApiFailure catch (error) {
      // The login succeeded but the establishment could not complete: the
      // token pair just received is wiped rather than half-persisted
      // (fail-closed, and the user retries an honest sign-in).
      await _wipeTokens();
      return _signInFailure(error);
    } on SecureKeystoreException catch (error) {
      return SignInResult.withheld(error);
    }

    final String? organizationId = identity.organizations.length == 1
        ? identity.organizations.single
        : null;
    if (organizationId == null) {
      // Multiple memberships: the setup screen chooses one; the enrollment
      // completes in [chooseOrganization].
      return SignInResult.success(
        AuthSession(
          userId: identity.userId,
          email: identity.email,
          sessionId: identity.sessionId,
          organizations: identity.organizations,
          organizationId: null,
          deviceId: identity.deviceId,
          boundTokens: sessionTokens,
        ),
      );
    }

    return _enrollAndFinish(
      email: identity.email,
      userId: identity.userId,
      sessionId: identity.sessionId,
      organizations: identity.organizations,
      organizationId: organizationId,
      refreshToken: tokens.refreshToken,
    );
  }

  /// Completes the flow for a multi-membership account. The choice travels
  /// only into device routes whose organization parameter the guard checks
  /// against the verified membership set (§9.3).
  Future<SignInResult> chooseOrganization({
    required AuthSession session,
    required String organizationId,
  }) async {
    if (!session.organizations.contains(organizationId)) {
      // A screen offering a foreign id is a code defect; this guard keeps a
      // future caller from slipping an assertion through (§9.3).
      return SignInResult.withheld(
        ArgumentError('organization is not among the verified memberships'),
      );
    }
    final StoredTokens? current;
    try {
      current = await _deps.tokenStore.read();
    } on SecureKeystoreException {
      return const SignInResult.withheld(
        'the keystore could not confirm the session tokens',
      );
    }
    if (current == null) {
      return const SignInResult.withheld(
        'session tokens were lost before enrollment',
      );
    }
    return _enrollAndFinish(
      email: session.email,
      userId: session.userId,
      sessionId: session.sessionId,
      organizations: session.organizations,
      organizationId: organizationId,
      refreshToken: current.refreshToken,
    );
  }

  /// Restores the session at boot (flow rule 5).
  Future<RestoreSessionResult> restore() async {
    final StoredTokens? stored;
    try {
      stored = await _deps.tokenStore.read();
    } on SecureKeystoreException {
      return const RestoreSessionResult.keystoreFailure();
    }

    if (stored == null) {
      return const RestoreSessionResult.signedOut();
    }

    final ({String? organizationId, String? deviceId}) binding;
    try {
      binding = await _deps.bindingStore.readBinding();
    } on Exception {
      return const RestoreSessionResult.keystoreFailure();
    }

    if (binding.organizationId == null || binding.deviceId == null) {
      // Tokens without a device binding come from an abandoned enrollment:
      // not a session. The honest state is signed out, with the tokens
      // wiped so they cannot survive as orphaned material.
      await _wipeTokens();
      return const RestoreSessionResult.signedOut();
    }

    // The identity display fields stay empty at boot by design: only server
    // answers carry them (§9.3), and an offline restart has none. The
    // *authorization* facts an offline device acts on live in the grace
    // record (§38.17), not in these strings.
    return RestoreSessionResult.restored(
      AuthSession(
        userId: '',
        email: '',
        sessionId: '',
        organizations: const <String>[],
        organizationId: binding.organizationId,
        deviceId: binding.deviceId,
        boundTokens: StoredSessionTokens(
          accessToken: stored.accessToken,
          refreshToken: stored.refreshToken,
          accessExpiresAt: stored.accessExpiresAtDevice,
        ),
      ),
    );
  }

  /// Refreshes the pair with the server (flow rule 6).
  Future<RefreshOutcome> refresh({required String refreshToken}) async {
    final LoginWireResponse rotated;
    try {
      rotated = await _deps.authApi.refresh(refreshToken: refreshToken);
    } on ApiFailure catch (error) {
      return RefreshOutcome.failure(error);
    }

    final StoredTokens fresh = StoredTokens(
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      accessExpiresAtDevice: DateTime.now().add(
        Duration(seconds: rotated.expiresIn),
      ),
    );

    try {
      await _deps.tokenStore.save(fresh);
    } on SecureKeystoreException catch (error) {
      // The rotation happened server-side, so the presented token is dead
      // and the fresh one is unusable without storage. No session can
      // continue; the fresh family's handle rides [RefreshOutcome] so the
      // controller can revoke it — it is never logged (§13.6).
      return RefreshOutcome.keystoreLost(error, rotated.refreshToken);
    }
    return RefreshOutcome.success(
      StoredSessionTokens(
        accessToken: fresh.accessToken,
        refreshToken: fresh.refreshToken,
        accessExpiresAt: fresh.accessExpiresAtDevice,
      ),
    );
  }

  /// Revokes the session family and wipes local state (flow rule 7).
  Future<void> signOut({required String refreshToken}) async {
    await _deps.tokenStore.clear();
    await _deps.bindingStore.clear();
    await _deps.graceService.clearSession();
    try {
      await _deps.authApi.logout(refreshToken: refreshToken);
    } on ApiFailure {
      // Local state is already clean; the server-side family dies on its
      // idle expiry, and the honest user state is signed-out either way.
    }
  }

  // -------------------------------------------------------------------

  Future<SignInResult> _enrollAndFinish({
    required String email,
    required String userId,
    required String sessionId,
    required List<String> organizations,
    required String organizationId,
    required String refreshToken,
  }) async {
    try {
      final InstallationIdentity installation = await _deps.identityVault
          .ensure();
      final DeviceRecordWire registered = await _deps.enrollmentApi
          .registerDevice(
            organizationId: organizationId,
            installationId: installation.installationId,
            installationSecret: installation.installationSecret,
            platform: _platformName(),
          );
      // §12.2's closed two states: a row that is not ACTIVE must never be
      // adopted by a session. (The server refuses re-activation; this is
      // the client's confirmation independent of any server assumption.)
      if (registered.status != 'ACTIVE') {
        throw const ApiFailure.failure(ApiErrorCode.deviceRevoked);
      }

      final BoundSessionWire boundSession = await _deps.enrollmentApi
          .bindSession(
            organizationId: organizationId,
            deviceId: registered.deviceId,
            installationSecret: installation.installationSecret,
          );

      // Persist the bound pair before the offline session is established:
      // §10.3.1's grace starts at the online authentication, and a duration
      // the device cannot honor is worse than none. If the save fails, the
      // flow unwinds before any binding or grace record exists.
      final DateTime boundExpiry = DateTime.now().add(
        Duration(seconds: boundSession.expiresIn),
      );
      try {
        await _deps.tokenStore.save(
          StoredTokens(
            accessToken: boundSession.accessToken,
            refreshToken:
                refreshToken, // binding never rotates the family (M2-S5)
            accessExpiresAtDevice: boundExpiry,
          ),
        );
      } on SecureKeystoreException catch (error) {
        throw KeystoreBrokenDuringSignIn(error);
      }

      // §38.16.3: the signed material is verified locally before anything
      // is stored from it. The record's device fact is the server-issued
      // bound id from this bind step — never a client-invented id.
      final OfflineGraceRecord? record = _deps.verifier.recordFrom(
        snapshot: (await _deps.enrollmentApi.mintSnapshot(
          organizationId: organizationId,
        )).snapshot,
        deviceId: registered.deviceId,
      );
      if (record == null) {
        throw const SecuritySnapshotRejected();
      }

      await _deps.bindingStore.install(
        organizationId: organizationId,
        deviceId: registered.deviceId,
      );
      final GraceEstablishment establishment = await _deps.graceService
          .establishSession(record);
      if (establishment != GraceEstablishment.established) {
        // Fail-closed: the offline session is refused, and with it the
        // whole sign-in (AC-5's discipline — a half-earned state is not a
        // state). The rollback clears the just-written durable facts.
        await _deps.bindingStore.clear();
        await _deps.graceService.clearSession();
        throw SecuritySnapshotRejected(
          'grace establishment refused: ${establishment.name}',
        );
      }

      return SignInResult.success(
        AuthSession(
          userId: userId,
          email: email,
          sessionId: sessionId,
          organizations: organizations,
          organizationId: organizationId,
          deviceId: registered.deviceId,
          boundTokens: StoredSessionTokens(
            accessToken: boundSession.accessToken,
            refreshToken: refreshToken,
            accessExpiresAt: boundExpiry,
          ),
        ),
      );
    } on ApiFailure catch (error) {
      await _wipeTokens();
      return _signInFailure(error);
    } on SecureKeystoreException catch (error) {
      await _wipeTokens();
      return SignInResult.withheld(error);
    } on SecuritySnapshotRejected catch (error) {
      await _wipeTokens();
      await _rollbackBindingAndGrace();
      return SignInResult.withheld(error);
    } on KeystoreBrokenDuringSignIn catch (error) {
      await _wipeTokens();
      await _rollbackBindingAndGrace();
      return SignInResult.withheld(error.cause);
    }
  }

  /// The grace window and binding writes succeeded but the sign-in is being
  /// refused: no half-earned state survives (AC-5).
  Future<void> _rollbackBindingAndGrace() async {
    try {
      await _deps.bindingStore.clear();
    } on Exception {
      // No durable alternative exists (the binding lives in exactly one
      // place); the sign-in result carries the refusal.
    }
    try {
      await _deps.graceService.clearSession();
    } on Exception {
      // Same posture: one durable home, and the refusal is the outcome.
    }
  }

  SignInResult _signInFailure(ApiFailure error) {
    switch (error.code) {
      case ApiErrorCode.serviceUnavailable when error.httpStatus == null:
        // No HTTP verdict reached the device: withheld, honest about what
        // was not learned. A 503 *document* is a server decision and reads
        // as a refusal.
        return SignInResult.withheld(error);
      default:
        return SignInResult.refused(error);
    }
  }

  Future<void> _saveTokens(
    LoginWireResponse tokens,
    DateTime accessExpiry,
  ) async {
    await _deps.tokenStore.save(
      StoredTokens(
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessExpiresAtDevice: accessExpiry,
      ),
    );
  }

  Future<void> _wipeTokens() async {
    try {
      await _deps.tokenStore.clear();
    } on SecureKeystoreException {
      // Nothing rescues the tokens; there is no fallback store by
      // construction (the governing acceptance). The failure stays visible
      // through the returned outcome.
    }
  }
}

/// The keystore broke after enrollment had already proven the device but
/// before any offline state was earned: the flow rolls back the online
/// session's durable facts rather than store half a session.
class KeystoreBrokenDuringSignIn implements Exception {
  const KeystoreBrokenDuringSignIn(this.cause);

  final Object cause;
}

/// A signed snapshot refused local verification (§38.16.3). A control-class
/// rejection: the material was received, and it failed the device's duty to
/// validate it — never treated as a transport failure.
class SecuritySnapshotRejected implements Exception {
  const SecuritySnapshotRejected([
    this.diagnostic = 'the signed snapshot failed local verification',
  ]);

  final String diagnostic;

  @override
  String toString() => 'SecuritySnapshotRejected($diagnostic)';
}
