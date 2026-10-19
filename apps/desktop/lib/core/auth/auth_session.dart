/// The authenticated session value and its store — Master Plan §6.10,
/// §10.3, §40.6 M2-S7.
///
/// The session is an **in-memory** immutable value. Its durable facts live in
/// exactly two places, with one ownership rule each:
///
/// - **Tokens** (access, refresh) — the platform keystore only
///   ([SecureTokenStore], the slice's governing acceptance).
/// - **The device binding** (server-issued organization + device ids) — the
///   outbox module's `local_meta` keys only ([DeviceBindingStore], §38.8.1).
///
/// Nothing here persists a token into a database and nothing persists a
/// binding into the keystore; each fact lives where its owning contract
/// says it does. The offline-grace record (M1b-S8) keeps its own place in
/// `local_meta` and is written only by its own store.
///
/// The ids the session carries are **server-derived** (§9.3): the user and
/// organization ids shown to the user arrive from `GET /auth/me` (read from
/// server state, never from the request) and from the enrollment responses;
/// the session never exposes a setter that would let a screen assert an
/// identity into existence.
library;

/// A signed-in account as the client sees it after restore-through-server.
class AuthSession {
  const AuthSession({
    required this.userId,
    required this.email,
    required this.sessionId,
    required this.organizations,
    required this.organizationId,
    this.deviceId,
    this.boundTokens,
  });

  /// The verified user (the token `sub`, re-filled from `/auth/me`).
  final String userId;

  /// The display mail (server-canonicalized; §10.1).
  final String email;

  /// The refresh-token family this access token belongs to (§10.3).
  final String sessionId;

  /// The verified memberships (§9.3: server-derived).
  final List<String> organizations;

  /// The organization this device's session works in.
  ///
  /// For a bound device this is the binding's organization (T-11: the device
  /// cannot switch organization offline). Before enrollment it is the
  /// selection made from [organizations].
  final String? organizationId;

  /// The server-issued id of the device the session is bound to (M2-S5),
  /// when binding holds.
  final String? deviceId;

  /// The in-memory token pair. It has exactly one durable home (the keystore);
  /// this is the working copy for the transport's `Bearer` source.
  final StoredSessionTokens? boundTokens;

  /// Copies with bound tokens restored after enrollment re-mints.
  AuthSession withTokens(StoredSessionTokens tokens) {
    return AuthSession(
      userId: userId,
      email: email,
      sessionId: sessionId,
      organizations: organizations,
      organizationId: organizationId,
      deviceId: deviceId,
      boundTokens: tokens,
    );
  }

  /// Copies with the organization chosen from the verified memberships.
  AuthSession withOrganization(String organizationId) {
    return AuthSession(
      userId: userId,
      email: email,
      sessionId: sessionId,
      organizations: organizations,
      organizationId: organizationId,
      deviceId: deviceId,
      boundTokens: boundTokens,
    );
  }

  /// Copies with a bound device identity attached or cleared.
  AuthSession withDevice({required String? deviceId}) {
    return AuthSession(
      userId: userId,
      email: email,
      sessionId: sessionId,
      organizations: organizations,
      organizationId: organizationId,
      deviceId: deviceId,
      boundTokens: boundTokens,
    );
  }
}

/// The session's own view of the token pair.
class StoredSessionTokens {
  const StoredSessionTokens({
    required this.accessToken,
    required this.refreshToken,
    required this.accessExpiresAt,
  });

  final String accessToken;
  final String refreshToken;
  final DateTime accessExpiresAt;

  /// The access token's own, honest budget on the device clock. The server
  /// remains the authority (§7.3); this is the client's courtesy refresh
  /// trigger, never a security boundary.
  bool get isAccessExpiringSoon =>
      DateTime.now().isAfter(accessExpiresAt.subtract(_refreshMargin));

  static const Duration _refreshMargin = Duration(minutes: 2);
}

/// Where a device's session is in its life cycle, as the router reads it.
enum SessionPhase {
  /// The boot read has not resolved yet. Routing holds `notProvisioned`.
  bootPending,

  /// No usable session: signed out, a wiped keystore, or a keystore that
  /// failed so completely no session could be restored (fail-closed, §13.6).
  signedOut,

  /// A session is usable; [AuthSession.organizationId] decides the next
  /// screen exactly as the guard contract states (§6.6).
  signedIn,
}

/// How a sign-in attempt resolved.
enum SignInResultKind {
  /// The server verified the credentials and the session was established.
  success,

  /// The server refused them (bad credentials, throttle, validation).
  /// The mapped problem code carries through the failure.
  refused,

  /// The attempt never reached a verdict: no connectivity, refused setup,
  /// or a keystore failure. Honest "withheld", never "refused" (§38.11).
  withheld,
}

/// The outcome of one sign-in attempt.
class SignInResult {
  const SignInResult.success(this.session)
    : kind = SignInResultKind.success,
      failure = null;

  const SignInResult.refused(this.failure)
    : kind = SignInResultKind.refused,
      session = null;

  const SignInResult.withheld(this.failure)
    : kind = SignInResultKind.withheld,
      session = null;

  final SignInResultKind kind;
  final AuthSession? session;
  final Object? failure;
}

/// Why a previously valid session ended, as one closed value the router and
/// the shell surface without leaking internals (§34.3).
enum SessionExitReason {
  /// The server refused the session (401 after one refresh attempt; §10.3).
  refused,

  /// The user signed out. The local keystore is wiped in the same action.
  signedOut,

  /// A keystore failure destroyed the trust of the stored session
  /// (fail-closed; §13.6).
  keystoreFailure,
}

/// What a boot-time restore resolved to.
class RestoreSessionResult {
  const RestoreSessionResult.signedOut()
    : session = null,
      keystoreFailed = false;

  const RestoreSessionResult.restored(this.session) : keystoreFailed = false;

  /// The keystore itself failed so completely that not even "signed out"
  /// could be *confirmed as expected* — the phase is still `signedOut`
  /// (fail-closed never guesses a session back into existence), but the
  /// shell may surface the degraded diagnosis honestly.
  const RestoreSessionResult.keystoreFailure()
    : session = null,
      keystoreFailed = true;

  final AuthSession? session;
  final bool keystoreFailed;
}

/// What a token refresh resolved to (§10.3 rotation).
class RefreshOutcome {
  const RefreshOutcome.success(this.tokens)
    : failure = null,
      familyLost = false,
      refreshToken = null;

  /// A refused refresh, with the mapped failure.
  const RefreshOutcome.failure(this.failure)
    : tokens = null,
      familyLost = false,
      refreshToken = null;

  /// The rotation happened server-side but the fresh pair could not be
  /// stored: the presented token is dead, the fresh one is lost, and no
  /// session can continue. The caller must revoke what it can and sign out;
  /// [refreshToken] is the fresh family's only handle, and it never leaves
  /// this value (k: never logged).
  const RefreshOutcome.keystoreLost(this.failure, this.refreshToken)
    : tokens = null,
      familyLost = true;

  final StoredSessionTokens? tokens;

  final Object? failure;

  final bool familyLost;

  /// The fresh refresh token, present only in the keystore-loss case.
  final String? refreshToken;
}
