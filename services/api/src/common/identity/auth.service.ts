/**
 * §10.1/§10.2/§10.3 / §40.6 M2-S2 — the authentication service.
 *
 * This is the whole of the slice's behaviour, and the §40.6 key acceptance lives
 * here: **reuse detection revokes the family**. Everything else is arranged around
 * making that statement true and legible.
 *
 * The model is the one §10.3 fixes. A **session** is one login and is the unit of
 * revocation; a **refresh token** is one link in a rotation chain within a session,
 * and every rotation consumes the presented token and links its successor. Because
 * the chain is recorded, presenting an already-consumed token is not a guess: it is
 * a definite reuse signal, and the correct response is to revoke the entire family —
 * the whole session — rather than just that token. That is what stops a stolen
 * refresh token from being used indefinitely alongside the legitimate one.
 *
 * Three properties are structural rather than conventional:
 *
 * - **Tenant scope is never read from the request.** Organizations come from
 *   `organization_memberships` at mint time and travel inside the signed token.
 *   A caller cannot name an organization into a token (§9.3, §38.16).
 * - **No enumeration signal.** An unknown account, a user with no credential, and a
 *   wrong password all return the same `UNAUTHENTICATED` shape, and the unknown-account
 *   path still performs one hash verification so the response time does not
 *   distinguish "no such user" from "wrong password" (§13.1).
 * - **Rotation is serialized per session.** A transaction-scoped advisory lock on the
 *   session id means two concurrent refreshes cannot both observe an unconsumed token
 *   and both rotate it; the second sees `consumed_at` set and is treated as reuse.
 *
 * **Committing the revocation before refusing.** A refresh that detects reuse must
 * revoke the family *and* refuse the request, and the revocation must survive the
 * refusal. A `throw` inside a transaction rolls that transaction back, so this
 * service never throws from inside the refresh transaction: the transaction commits
 * an outcome value, and the refusal is raised after it commits. That single ordering
 * is what makes the key acceptance actually true in the database rather than true
 * only in the response.
 *
 * Hashing, token signing, throttling, and event recording are **ports** injected here,
 * so the service's dependencies are explicit and a failure of any one of them cannot
 * be mistaken for a failure of the others.
 */

import type { Prisma } from '@prisma/client';
import type { IdentityConfigShape } from '../config/app.config';
import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import type { AccessTokenService } from './access-token';
import type { TokenResponse } from './auth.contract';
import type { AuthThrottle } from './auth-throttle';
import { establishUserContext, withIdentityTransaction } from '../database/tenant-context';
import { createPasswordHasher, type PasswordHasher } from './password';
import { canonicalizeEmail } from './user-provisioning';
import { generateRefreshToken, hashRefreshToken } from './refresh-token';
import type { SecurityEventSink } from './security-event.sink';
import type { PrismaHost } from './prisma-host';

/** One login attempt. `clientAddress` is a throttle scope, never authority. */
export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly clientAddress?: string;
}

/** The access token a successful device binding hands back (M2-S5). */
export interface BoundAccessToken {
  readonly accessToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresIn: number;
}

/** The verified identity behind an access token, as the application consumes it. */
export interface AuthenticatedPrincipal {
  readonly userId: string;
  readonly email: string;
  readonly organizations: readonly string[];
  readonly sessionId: string;
  readonly permissionsVersion: number;
  /**
   * M2-S5 (§12.4): the device the session is bound to, when the session is
   * device-bound — the server-written binding re-derived from the token's signed
   * `did` claim. `undefined` on a session opened without a device binding; the
   * device-bound sync boundary requires it to be present.
   */
  readonly deviceId?: string;
  readonly expiresAt: Date;
}

/** The collaborators and policy the service runs with. */
export interface AuthServiceOptions {
  readonly accessToken: AccessTokenService;
  readonly throttle: AuthThrottle;
  readonly sink: SecurityEventSink;
  readonly password: PasswordHasher;
  readonly accessTokenTtlSeconds: number;
  readonly refreshIdleTtlSeconds: number;
  readonly refreshAbsoluteTtlSeconds: number;
}

/** The revocation reasons the database CHECK also enforces (§10.3). */
type RevocationReason = 'LOGOUT' | 'REUSE_DETECTED' | 'ADMIN';

/** A reader that exposes the membership relation — the full client or a transaction. */
type MembershipReader = Pick<Prisma.TransactionClient, 'organizationMembership'>;

/**
 * The committed result of a refresh attempt. The refusal is raised after the
 * transaction, so any revocation it performed has already persisted.
 */
type RefreshOutcome =
  | { readonly kind: 'rotated'; readonly tokens: TokenResponse; readonly userId: string }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'reuse'; readonly userId: string }
  | { readonly kind: 'revoked'; readonly userId: string }
  | { readonly kind: 'expired'; readonly userId: string };

function unauthenticated(diagnostic: string): DomainError {
  return new DomainError(ERROR_CODES.UNAUTHENTICATED, diagnostic);
}

/** Canonicalizes an address, or `null` when it is not a mailbox shape. */
function canonicalOrNull(raw: string): string | null {
  try {
    return canonicalizeEmail(raw);
  } catch {
    return null;
  }
}

/** The identity-context authentication service. One instance per application. */
export class AuthService {
  /**
   * A valid Argon2id digest of a value nobody knows, verified against when the
   * account is unknown so the work — and therefore the timing — matches a real
   * verification. Computed at most once per process.
   */
  private equalizerHash: string | undefined;

  constructor(
    private readonly host: PrismaHost,
    private readonly options: AuthServiceOptions,
  ) {}

  /**
   * Exchanges a password for a token pair, or refuses `UNAUTHENTICATED`.
   *
   * The check order is deliberate: block before touching a credential (so a
   * throttled caller costs no hashing), then look the account up, then verify, then
   * open the session. A failure counts against the throttle under both the account
   * and the client address.
   */
  async login(input: LoginInput, now: Date = new Date()): Promise<TokenResponse> {
    const email = canonicalOrNull(input.email);
    const keys = this.throttleKeys(email, input.clientAddress);
    // §32.3 (M2-S6): a throttled-block refusal is itself a security fact — it
    // names no verified identity (the caller never authenticated), so it is
    // recorded into the GLOBAL security partition as an UNVERIFIED attempt
    // whose claimed e-mail — when it was a mailbox shape — is labelled, and
    // the refusal shape is unchanged.
    try {
      await this.options.throttle.assertNotBlocked(keys, now);
    } catch (error) {
      if (error instanceof DomainError && error.code === ERROR_CODES.RATE_LIMITED) {
        this.options.sink.record({
          type: 'LOGIN_THROTTLED',
          actorKind: 'UNVERIFIED',
          errorCode: ERROR_CODES.RATE_LIMITED,
          ...(email === null ? {} : { claimedEmail: email }),
          ...(input.clientAddress === undefined ? {} : { clientAddress: input.clientAddress }),
        });
      }
      throw error;
    }

    const account =
      email === null
        ? null
        : await this.host.prisma.user.findUnique({
            where: { email },
            select: {
              id: true,
              permissionsVersion: true,
              credential: { select: { passwordHash: true } },
            },
          });

    if (account === null || account.credential === null) {
      // No credential to verify against, so verify against the equalizer: the
      // caller learns nothing from the timing, and the refusal shape is identical
      // to a wrong password.
      await this.options.password.verify(await this.equalizer(), input.password);
      await this.options.throttle.recordFailure(keys, now);
      this.options.sink.record({
        type: 'LOGIN_FAILED',
        // M2-S6 (§32.6): no identity was verified. The attempt names no
        // account, so the claimed e-mail — when it was a mailbox shape — is
        // the labelled claim, and the event is UNVERIFIED.
        actorKind: 'UNVERIFIED',
        ...(email === null ? {} : { claimedEmail: email }),
        errorCode: ERROR_CODES.UNAUTHENTICATED,
        ...(input.clientAddress === undefined ? {} : { clientAddress: input.clientAddress }),
      });
      throw unauthenticated('login refused: unknown account or no credential is set');
    }

    const verified = await this.options.password.verify(account.credential.passwordHash, input.password);
    if (!verified) {
      await this.options.throttle.recordFailure(keys, now);
      this.options.sink.record({
        type: 'LOGIN_FAILED',
        // The account exists; the attempt failed. §32.6: that is an
        // UNVERIFIED attempt aimed at the account — recorded as a labelled
        // claim, never as a verified principal.
        actorKind: 'UNVERIFIED',
        userId: account.id,
        ...(email === null ? {} : { claimedEmail: email }),
        errorCode: ERROR_CODES.UNAUTHENTICATED,
        ...(input.clientAddress === undefined ? {} : { clientAddress: input.clientAddress }),
      });
      throw unauthenticated('login refused: the password did not verify');
    }

    // M2-S4 (decision D-A): the membership read is tenant-owned data, and it is
    // the §9.3 mirror of the token's own claim — so it is read inside the
    // identity transaction, where `app.current_user_id` makes exactly the
    // caller's own membership edges visible, across organizations (T-4), and
    // the session write shares that transaction.
    const accountId = account.id;
    const storedPasswordHash = account.credential.passwordHash;
    const tokens = await withIdentityTransaction(this.host, accountId, async (tx) => {
      const memberships = await this.membershipsOf(account.id, tx);

      // The session and the access token are written together: if signing fails
      // (identity unconfigured, for instance) the session is rolled back rather than
      // left as an active family whose refresh token no client ever received.
      const refreshToken = generateRefreshToken();
      const session = await tx.session.create({
        data: {
          userId: account.id,
          createdAt: now,
          lastUsedAt: now,
          absoluteExpiresAt: new Date(now.getTime() + this.options.refreshAbsoluteTtlSeconds * 1000),
          tokens: {
            create: {
              tokenHash: hashRefreshToken(refreshToken),
              issuedAt: now,
              idleExpiresAt: new Date(now.getTime() + this.options.refreshIdleTtlSeconds * 1000),
            },
          },
        },
        select: { id: true },
      });

      const accessToken = this.options.accessToken.sign(
        {
          userId: account.id,
          organizations: memberships,
          sessionId: session.id,
          permissionsVersion: account.permissionsVersion,
        },
        now,
      );

      return this.tokenPair(accessToken, refreshToken);
    });

    await this.options.throttle.clear(keys);

    // Opportunistic re-hash: a credential stored under older parameters is upgraded
    // on a successful login. A failure here must never fail the login the password
    // just earned, so it is best-effort; M2-S6's durable sink will record it.
    if (this.options.password.needsRehash(storedPasswordHash)) {
      try {
        const rehashed = await this.options.password.hash(input.password);
        await this.host.prisma.userCredential.update({
          where: { userId: accountId },
          data: { passwordHash: rehashed, passwordUpdatedAt: now },
        });
      } catch {
        // Best effort by design; the login already succeeded.
      }
    }

    this.options.sink.record({ type: 'LOGIN_SUCCEEDED', userId: accountId });

    return tokens;
  }

  /**
   * Rotates a refresh token, or refuses. Detects reuse and revokes the family.
   *
   * Runs in one transaction with a per-session advisory lock, so the read of the
   * presented token's state and the write of its successor cannot interleave with
   * another refresh of the same family. The transaction commits an outcome; the
   * refusal (including a reuse revocation) is raised afterwards.
   */
  async refresh(refreshToken: string, now: Date = new Date()): Promise<TokenResponse> {
    const tokenHash = hashRefreshToken(refreshToken);

    const outcome = await this.host.prisma.$transaction<RefreshOutcome>(async (tx) => {
      const located = await tx.refreshToken.findUnique({
        where: { tokenHash },
        select: { sessionId: true },
      });
      if (located === null) {
        return { kind: 'unknown' };
      }

      // Serialize this family. Two concurrent refreshes of one token must not both
      // see it unconsumed; the second must observe the first's consumption and be
      // treated as reuse.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`identity:session:${located.sessionId}`}, 0))`;

      const token = await tx.refreshToken.findUnique({ where: { tokenHash }, include: { session: true } });
      if (token === null) {
        return { kind: 'unknown' };
      }

      const session = token.session;

      if (token.consumedAt !== null) {
        // The reuse signal (§10.3, §40.6 acceptance): this token was already rotated.
        // Either the legitimate client is replaying, or a copy is being used. Both
        // are answered the same way — the whole family is revoked.
        await this.revokeFamily(tx, session.id, 'REUSE_DETECTED', now);
        return { kind: 'reuse', userId: session.userId };
      }

      if (session.revokedAt !== null) {
        return { kind: 'revoked', userId: session.userId };
      }

      if (now.getTime() >= session.absoluteExpiresAt.getTime() || now.getTime() >= token.idleExpiresAt.getTime()) {
        return { kind: 'expired', userId: session.userId };
      }

      // Rotate: mint the successor first, then consume the presented token and link
      // it, so the "consumed implies successor" CHECK is satisfied at every write.
      const nextToken = generateRefreshToken();
      const successor = await tx.refreshToken.create({
        data: {
          sessionId: session.id,
          tokenHash: hashRefreshToken(nextToken),
          issuedAt: now,
          idleExpiresAt: new Date(now.getTime() + this.options.refreshIdleTtlSeconds * 1000),
        },
      });
      await tx.refreshToken.update({
        where: { id: token.id },
        data: { consumedAt: now, successorId: successor.id },
      });
      await tx.session.update({ where: { id: session.id }, data: { lastUsedAt: now } });

      const account = await tx.user.findUniqueOrThrow({
        where: { id: session.userId },
        select: { permissionsVersion: true },
      });

      // Decision D-A (M2-S4 §9): the membership read is policy-protected; the
      // caller's own edges become visible from the server-resolved session's
      // user id — the same verified identity the token claims — never a request
      // field.
      await establishUserContext(tx, session.userId);
      const organizations = await this.membershipsOf(session.userId, tx);

      const accessToken = this.options.accessToken.sign(
        {
          userId: session.userId,
          organizations,
          sessionId: session.id,
          permissionsVersion: account.permissionsVersion,
          // M2-S5: the device binding rides with every refresh — the claim is
          // re-derived from the stored session row. The binding can never be
          // added or dropped by the client; only the server writes it.
          ...(session.deviceId === null ? {} : { deviceId: session.deviceId }),
        },
        now,
      );

      return { kind: 'rotated', tokens: this.tokenPair(accessToken, nextToken), userId: session.userId };
    });

    switch (outcome.kind) {
      case 'rotated':
        this.options.sink.record({ type: 'REFRESH_ROTATED', userId: outcome.userId });
        return outcome.tokens;
      case 'reuse':
        // The *caller* was never authenticated — the replayed token may be a
        // stolen copy or a buggy retry — so the event is an UNVERIFIED attempt
        // aimed at the affected account (§32.6), while its family revocation
        // was a committed class-A fact of the refresh transaction.
        this.options.sink.record({
          type: 'REFRESH_REUSE_DETECTED',
          actorKind: 'UNVERIFIED',
          userId: outcome.userId,
          errorCode: ERROR_CODES.UNAUTHENTICATED,
        });
        throw unauthenticated('refresh refused: reuse of a rotated token; the session family was revoked');
      case 'revoked':
        this.options.sink.record({
          type: 'ACCESS_TOKEN_REJECTED',
          userId: outcome.userId,
          errorCode: ERROR_CODES.UNAUTHENTICATED,
        });
        throw unauthenticated('refresh refused: the session is revoked');
      case 'expired':
        this.options.sink.record({
          type: 'ACCESS_TOKEN_REJECTED',
          userId: outcome.userId,
          errorCode: ERROR_CODES.TOKEN_EXPIRED,
        });
        throw new DomainError(ERROR_CODES.TOKEN_EXPIRED, 'refresh refused: the token is past its expiry');
      case 'unknown':
        this.options.sink.record({ type: 'ACCESS_TOKEN_REJECTED', errorCode: ERROR_CODES.UNAUTHENTICATED });
        throw unauthenticated('refresh refused: the token is not recognised');
    }
  }

  /**
   * Revokes the session family a refresh token belongs to.
   *
   * Idempotent and silent about whether the token existed: logout must not become a
   * token-validity oracle, and a second logout is a success, not an error.
   */
  async logout(refreshToken: string, now: Date = new Date()): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);

    await this.host.prisma.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash },
        select: { sessionId: true, session: { select: { userId: true } } },
      });
      if (token === null) {
        return;
      }

      const revoked = await tx.session.updateMany({
        where: { id: token.sessionId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'LOGOUT' },
      });
      if (revoked.count > 0) {
        this.options.sink.record({ type: 'LOGOUT', userId: token.session.userId });
      }
    });
  }

  /**
   * Verifies an access token and resolves it against live server state.
   *
   * The signature check is not sufficient on its own. A revoked session must refuse
   * its still-unexpired access token immediately rather than at the next refresh,
   * and a permissions change must invalidate outstanding tokens (`TOKEN_STALE`).
   * Both are facts about the session and the user, so both are read here.
   */
  async authenticate(accessToken: string): Promise<AuthenticatedPrincipal> {
    const claims = this.options.accessToken.verify(accessToken);

    const session = await this.host.prisma.session.findUnique({
      where: { id: claims.sessionId },
      select: {
        userId: true,
        deviceId: true,
        revokedAt: true,
        absoluteExpiresAt: true,
        user: { select: { email: true, permissionsVersion: true } },
      },
    });

    if (session === null || session.userId !== claims.userId) {
      this.options.sink.record({ type: 'ACCESS_TOKEN_REJECTED', errorCode: ERROR_CODES.UNAUTHENTICATED });
      throw unauthenticated('access token does not name an active session');
    }

    // §12.4 (M2-S5): the binding is a server-written fact and its signed copy
    // travels in the token. The two must agree in both directions: a device-
    // bound session cannot be honored by a token whose `did` claim is missing or
    // names another device, and a token claiming a device the session never
    // bound is a session/device mismatch — refused, not repaired.
    if ((claims.deviceId ?? null) !== session.deviceId) {
      this.options.sink.record({
        type: 'ACCESS_TOKEN_REJECTED',
        userId: session.userId,
        errorCode: ERROR_CODES.UNAUTHENTICATED,
      });
      throw unauthenticated('the access token and its session disagree about the device binding');
    }

    if (session.revokedAt !== null) {
      this.options.sink.record({
        type: 'ACCESS_TOKEN_REJECTED',
        userId: session.userId,
        errorCode: ERROR_CODES.UNAUTHENTICATED,
      });
      throw unauthenticated('access token names a revoked session');
    }

    if (Date.now() >= session.absoluteExpiresAt.getTime()) {
      this.options.sink.record({
        type: 'ACCESS_TOKEN_REJECTED',
        userId: session.userId,
        errorCode: ERROR_CODES.TOKEN_EXPIRED,
      });
      throw new DomainError(ERROR_CODES.TOKEN_EXPIRED, 'access token names a session past its absolute expiry');
    }

    if (session.user.permissionsVersion !== claims.permissionsVersion) {
      this.options.sink.record({
        type: 'ACCESS_TOKEN_STALE',
        userId: session.userId,
        errorCode: ERROR_CODES.TOKEN_STALE,
      });
      throw new DomainError(
        ERROR_CODES.TOKEN_STALE,
        'permissions changed since the access token was minted; sign in again',
      );
    }

    return {
      userId: claims.userId,
      email: session.user.email,
      organizations: claims.organizations,
      sessionId: claims.sessionId,
      permissionsVersion: claims.permissionsVersion,
      ...(claims.deviceId === undefined ? {} : { deviceId: claims.deviceId }),
      expiresAt: claims.expiresAt,
    };
  }

  /**
   * Mints a fresh access token for an *active* session (M2-S5 bind-session).
   *
   * The device binding endpoint binds an existing session and immediately hands
   * back a token that carries the `did` claim, so the client never has to guess
   * when a binding took effect. The mint re-resolves every server-side fact the
   * login path resolves — membership set, permission generation, device
   * binding — from the stored session row, so the fresh token cannot assert a
   * state the session does not hold.
   *
   * @throws `DomainError` when the session does not exist (no binding can be
   *   minted for it).
   */
  async mintAccessTokenForSession(sessionId: string, now: Date = new Date()): Promise<BoundAccessToken> {
    return this.host.prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        select: {
          userId: true,
          deviceId: true,
          revokedAt: true,
          absoluteExpiresAt: true,
          user: { select: { permissionsVersion: true } },
        },
      });
      if (session === null || session.revokedAt !== null) {
        throw unauthenticated('the session is not active');
      }

      // Decision D-A (M2-S4): the membership reads are policy-protected; the
      // caller's own edges become visible from the server-resolved session's
      // user id — the same verified identity the bearer guard carries.
      await establishUserContext(tx, session.userId);
      const organizations = await this.membershipsOf(session.userId, tx);

      const accessToken = this.options.accessToken.sign(
        {
          userId: session.userId,
          organizations,
          sessionId,
          permissionsVersion: session.user.permissionsVersion,
          ...(session.deviceId === null ? {} : { deviceId: session.deviceId }),
        },
        now,
      );

      return { accessToken, tokenType: 'Bearer', expiresIn: this.options.accessTokenTtlSeconds };
    });
  }

  /** Revokes a family, preserving the first reason if it was already revoked. */
  private async revokeFamily(
    tx: Prisma.TransactionClient,
    sessionId: string,
    reason: RevocationReason,
    now: Date,
  ): Promise<void> {
    await tx.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
  }

  /** The organizations a user belongs to, from server state, deterministically ordered. */
  private async membershipsOf(userId: string, reader: MembershipReader): Promise<readonly string[]> {
    const rows = await reader.organizationMembership.findMany({
      where: { userId },
      select: { organizationId: true },
      orderBy: { organizationId: 'asc' },
    });
    return rows.map((row) => row.organizationId);
  }

  /** The throttle keys a login attempt counts against. */
  private throttleKeys(email: string | null, clientAddress: string | undefined): readonly string[] {
    const keys: string[] = [];
    if (email !== null) {
      keys.push(`login:account:${email}`);
    }
    if (clientAddress !== undefined) {
      keys.push(`login:address:${clientAddress}`);
    }
    return keys;
  }

  private tokenPair(accessToken: string, refreshToken: string): TokenResponse {
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.options.accessTokenTtlSeconds,
      refreshToken,
      refreshExpiresIn: this.options.refreshIdleTtlSeconds,
    };
  }

  /** Lazily computes the timing equalizer digest. */
  private async equalizer(): Promise<string> {
    if (this.equalizerHash === undefined) {
      this.equalizerHash = await this.options.password.hash('my-shop::login-equalizer::not-a-credential');
    }
    return this.equalizerHash;
  }
}

/**
 * Builds the service from validated configuration and the injected ports.
 *
 * Kept here so the module binds one factory and the wiring is one readable place.
 * The `?? ` defaults exist only for a configuration with no identity group (which
 * also means a fail-closed access-token port, so no token can be minted anyway).
 */
export function createAuthService(
  prisma: PrismaHost,
  identity: IdentityConfigShape | undefined,
  ports: {
    readonly accessToken: AccessTokenService;
    readonly throttle: AuthThrottle;
    readonly sink: SecurityEventSink;
  },
): AuthService {
  const password = createPasswordHasher({
    memoryKib: identity?.argon2MemoryKib ?? 19_456,
    timeCost: identity?.argon2TimeCost ?? 2,
    parallelism: identity?.argon2Parallelism ?? 1,
  });

  return new AuthService(prisma, {
    accessToken: ports.accessToken,
    throttle: ports.throttle,
    sink: ports.sink,
    password,
    accessTokenTtlSeconds: identity?.accessTokenTtlSeconds ?? 900,
    refreshIdleTtlSeconds: identity?.refreshIdleTtlSeconds ?? 604_800,
    refreshAbsoluteTtlSeconds: identity?.refreshAbsoluteTtlSeconds ?? 2_592_000,
  });
}
