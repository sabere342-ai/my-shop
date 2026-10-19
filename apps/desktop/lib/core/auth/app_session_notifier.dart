/// The session controller — the Riverpod face of the authentication flow
/// (Master Plan §6.4, §6.6, §10.3, §38.16, §40.6 M2-S7).
///
/// One [Notifier] owns the session state the whole client reads:
///
/// - the router guard watches it through the derived `navigationSession`
///   provider, so a session change *is* a routing decision (§6.6);
/// - the shell's calm status line reads the offline-grace status of the
///   same signed-in session (§38.31: one calm line, never a sync retrofit);
/// - the sign-in and organization-setup screens drive it through the
///   methods below, each an honest [SignInResult] with no swallowed error
///   (§34.2).
///
/// Boot (§38.16.2: "there is no offline first-run"): `build` starts at
/// `bootPending` and restores from the keystore. Until the restore answers,
/// the router holds `notProvisioned` (the honest first frame). A restored
/// session keeps its device binding (§38.8.1); the keystore is the only
/// token source it was restored from (the governing acceptance), and
/// nothing here stores a token anywhere else.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_shop_desktop/core/api/api_failure.dart';
import 'package:my_shop_desktop/core/api/auth_api.dart';
import 'package:my_shop_desktop/core/auth/auth_composition.dart';
import 'package:my_shop_desktop/core/auth/auth_service.dart';
import 'package:my_shop_desktop/core/auth/auth_session.dart';
import 'package:my_shop_desktop/core/auth/keystore.dart';
import 'package:my_shop_desktop/core/auth/session_state.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_service.dart';

/// The identity probe's outcome, as one closed value (§34.2: no untyped
/// exception ever crosses this boundary as a business fact). The shell and
/// tests branch on it; the sign-in screens never see it.
sealed class MeWireOutcome {
  const MeWireOutcome();

  const factory MeWireOutcome.noSession() = MeNoSession;

  const factory MeWireOutcome.identity(AuthSession session) = MeIdentity;

  const factory MeWireOutcome.familyChanged() = MeFamilyChanged;

  const factory MeWireOutcome.ended() = MeSessionEnded;

  const factory MeWireOutcome.unreachable(ApiFailure failure) = MeUnreachable;
}

/// No signed-in session exists to probe.
final class MeNoSession extends MeWireOutcome {
  const MeNoSession();
}

/// The probe succeeded and the session is re-filled from the server answer.
final class MeIdentity extends MeWireOutcome {
  const MeIdentity(this.session);

  final AuthSession session;
}

/// A different refresh family is live server-side (§10.3); the presented
/// session was ended.
final class MeFamilyChanged extends MeWireOutcome {
  const MeFamilyChanged();
}

/// The session ended during the probe (refusal, revocation, keystore loss).
final class MeSessionEnded extends MeWireOutcome {
  const MeSessionEnded();
}

/// The identity surface was unreachable and the session stands untouched.
final class MeUnreachable extends MeWireOutcome {
  const MeUnreachable(this.failure);

  final ApiFailure failure;
}

/// The session state of the whole client. Tests override [authKitProvider]
/// (and [appDatabaseProvider]) to drive this controller with fakes.
final NotifierProvider<AppSessionNotifier, AppSessionState> appSessionProvider =
    NotifierProvider<AppSessionNotifier, AppSessionState>(
      AppSessionNotifier.new,
    );

/// The offline-grace status the shell's calm line reads (§38.31: one line,
/// never a sync retrofit). It re-reads the service when the session state
/// changes, so a sign-in or sign-out moves the line with the session.
final FutureProvider<OfflineGraceStatus> appGraceStatusProvider =
    FutureProvider<OfflineGraceStatus>((Ref ref) {
      return ref.watch(appSessionProvider.notifier).graceStatus();
    });

class AppSessionNotifier extends Notifier<AppSessionState> {
  @override
  AppSessionState build() {
    // The restore rides a microtask so the first frame is synchronous and
    // honest: bootPending now, the keystore's answer next.
    Future<void>(() async {
      await restoreAtBoot();
    });
    return const AppSessionState.bootPending();
  }

  AuthService get _auth => ref.watch(authKitProvider).authService;

  /// The transport publishes the session's working token (§13.6: the
  /// keystore is the durable home; this is the in-memory copy for calls).
  void _publishToken(String? accessToken) {
    ref.watch(authKitProvider).apiClient.tokenSource.update(accessToken);
  }

  Future<void> restoreAtBoot() async {
    final RestoreSessionResult restored = await _auth.restore();
    switch (restored) {
      case RestoreSessionResult(keystoreFailed: true):
        state = const AppSessionState.signedOut(
          exitReason: SessionExitReason.keystoreFailure,
        );
      case RestoreSessionResult(session: null):
        state = const AppSessionState.signedOut();
      case RestoreSessionResult(session: final AuthSession session):
        _publishToken(session.boundTokens?.accessToken);
        state = AppSessionState.signedIn(session);
    }
  }

  /// Runs the sign-in flow and, on success, publishes the session.
  Future<SignInResult> signIn({
    required String email,
    required String password,
  }) async {
    final SignInResult result = await _auth.signIn(
      email: email,
      password: password,
    );
    switch (result.kind) {
      case SignInResultKind.success:
        final AuthSession session = result.session!;
        _publishToken(session.boundTokens?.accessToken);
        state = AppSessionState.signedIn(session);
      case SignInResultKind.refused:
      case SignInResultKind.withheld:
        break;
    }
    return result;
  }

  /// Completes a multi-membership sign-in. On success the session is
  /// published with the chosen, verified organization.
  Future<SignInResult> chooseOrganization({
    required AuthSession session,
    required String organizationId,
  }) async {
    final SignInResult result = await _auth.chooseOrganization(
      session: session,
      organizationId: organizationId,
    );
    switch (result.kind) {
      case SignInResultKind.success:
        final AuthSession bound = result.session!;
        _publishToken(bound.boundTokens?.accessToken);
        state = AppSessionState.signedIn(bound);
      case SignInResultKind.refused:
      case SignInResultKind.withheld:
        break;
    }
    return result;
  }

  /// Signs out: the local wipe happens inside the flow *before* the server
  /// revocation is attempted (§38.16.4's local commitment), and the
  /// transport's bearer is dropped with the tokens.
  Future<void> signOut() async {
    final String? refreshToken = state.session?.boundTokens?.refreshToken;
    await _auth.signOut(refreshToken: refreshToken ?? '');
    _publishToken(null);
    state = const AppSessionState.signedOut(
      exitReason: SessionExitReason.signedOut,
    );
  }

  /// Ends the session after a refused refresh or identity call
  /// (§10.3's revocation semantics, honoured client-side): tokens wiped,
  /// binding and grace cleared, honest reason surfaced.
  Future<void> endSession(SessionExitReason reason) async {
    final String? refreshToken = state.session?.boundTokens?.refreshToken;
    await _auth.signOut(refreshToken: refreshToken ?? '');
    _publishToken(null);
    state = AppSessionState.signedOut(exitReason: reason);
  }

  /// The identity probe with the one-retry refresh contract (§10.3
  /// AC-"refreshed and retried once"): a 401 `TOKEN_STALE`/`TOKEN_EXPIRED`
  /// refreshes once and retries; a second refusal ends the session.
  Future<MeWireOutcome> refreshIdentity() async {
    final AuthSession? session = state.session;
    if (session == null) {
      return const MeWireOutcome.noSession();
    }
    try {
      final MeWireResponse identity = await ref
          .watch(authKitProvider)
          .authApi
          .me();
      if (identity.sessionId != session.sessionId) {
        // A different refresh family answered: the presented family is no
        // longer the live one. End the session honestly.
        await endSession(SessionExitReason.refused);
        return const MeWireOutcome.familyChanged();
      }
      final AuthSession filled = AuthSession(
        userId: identity.userId,
        email: identity.email,
        sessionId: identity.sessionId,
        organizations: identity.organizations,
        organizationId: session.organizationId,
        deviceId: identity.deviceId ?? session.deviceId,
        boundTokens: session.boundTokens,
      );
      state = AppSessionState.signedIn(filled);
      return MeWireOutcome.identity(filled);
    } on ApiFailure catch (error) {
      if (_isRecoverableTokenFailure(error)) {
        final RefreshOutcome refreshed = await _refreshTokens();
        switch (refreshed) {
          case RefreshOutcome(tokens: final StoredSessionTokens fresh):
            return _meAfterRefresh(session, fresh);
          case RefreshOutcome(familyLost: true):
            await endSession(SessionExitReason.keystoreFailure);
            return const MeWireOutcome.ended();
          case RefreshOutcome(failure: _):
            await endSession(SessionExitReason.refused);
            return const MeWireOutcome.ended();
        }
      }
      if (_isSessionEndingFailure(error)) {
        await endSession(SessionExitReason.refused);
        return const MeWireOutcome.ended();
      }
      return MeWireOutcome.unreachable(error);
    } on SecureKeystoreException {
      await endSession(SessionExitReason.keystoreFailure);
      return const MeWireOutcome.ended();
    }
  }

  Future<MeWireOutcome> _meAfterRefresh(
    AuthSession stale,
    StoredSessionTokens fresh,
  ) async {
    final AuthSession renewed = AuthSession(
      userId: stale.userId,
      email: stale.email,
      sessionId: stale.sessionId,
      organizations: stale.organizations,
      organizationId: stale.organizationId,
      deviceId: stale.deviceId,
      boundTokens: fresh,
    );
    _publishToken(fresh.accessToken);
    try {
      final MeWireResponse identity = await ref
          .watch(authKitProvider)
          .authApi
          .me();
      final AuthSession filled = AuthSession(
        userId: identity.userId,
        email: identity.email,
        sessionId: identity.sessionId,
        organizations: identity.organizations,
        organizationId: renewed.organizationId,
        deviceId: identity.deviceId ?? renewed.deviceId,
        boundTokens: fresh,
      );
      state = AppSessionState.signedIn(filled);
      return MeWireOutcome.identity(filled);
    } on ApiFailure catch (error) {
      // After one successful refresh the retry must succeed or the session
      // ends; there is no second refresh (§10.3's one-retry contract).
      await endSession(SessionExitReason.refused);
      return MeWireOutcome.unreachable(error);
    }
  }

  Future<RefreshOutcome> _refreshTokens() async {
    final String? refreshToken = state.session?.boundTokens?.refreshToken;
    return _auth.refresh(refreshToken: refreshToken ?? '');
  }

  static bool _isRecoverableTokenFailure(ApiFailure error) {
    return error.code == ApiErrorCode.tokenExpired ||
        error.code == ApiErrorCode.tokenStale ||
        error.code == ApiErrorCode.unauthenticated;
  }

  static bool _isSessionEndingFailure(ApiFailure error) {
    return error.code == ApiErrorCode.deviceRevoked ||
        error.code == ApiErrorCode.notFound;
  }

  /// The offline-grace status of the signed-in session, for the shell's
  /// calm line (§38.31). Delegates to the M1b-S8 service; this controller
  /// never re-implements admission (T-O17's discipline).
  Future<OfflineGraceStatus> graceStatus() =>
      ref.watch(authKitProvider).graceService.status();
}
