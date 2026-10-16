-- My Shop — identity, sessions and refresh rotation (Master Plan §40.6, slice
-- M2-S2; §10.2, §10.3, §39.2).
--
-- The authentication foundation the §10.1 decision needs: an Argon2id password
-- credential per user, a server-side session that is the *family* a refresh-token
-- rotation chain belongs to, the individual rotating opaque refresh tokens, and a
-- bounded failed-attempt throttle. Login, refresh rotation, reuse detection, and
-- revocation are the service layer above these tables; this migration only makes
-- the durable shape of each fact.
--
-- Forward-only and additive per §35.1: `0001`-`0004` are untouched. No existing
-- table is altered, so no merged history is rewritten and no existing row is
-- re-validated.
--
-- Audit rules honoured (§8.3, gate G-9): no GRANT (the migrator's
-- `ALTER DEFAULT PRIVILEGES` in prisma/roles.sql already births every table with
-- the application role's DML — `roles.sql` is deliberately untouched), no
-- SECURITY DEFINER, no BYPASSRLS, no search_path change, no string interpolation
-- — every name and literal below is a constant.
--
-- Generated with:
--   prisma migrate diff --from-migrations prisma/migrations \
--     --to-schema-datamodel prisma/schema.prisma --shadow-database-url ... --script
-- (the additive delta emitted by the Prisma CLI is reproduced verbatim below; the
-- CHECK constraints Prisma does not model are appended by hand and re-verified by
-- the acceptance suite's `prisma migrate diff --exit-code`, exactly as `0003`'s
-- and `0004`'s CHECKs are).

-- §10.3/§11: the permission-generation column. M2-S2 mints the `perms_version`
-- claim and compares it on every authenticated request so a permissions change
-- invalidates an outstanding access token (`TOKEN_STALE`); M2-S3 owns the writer
-- that increments it. Additive with a default, so every existing row is valid
-- (§35.1: this is an added column on a table M2-S1 created, never a rewrite of
-- `0003`).
ALTER TABLE "users" ADD COLUMN "permissions_version" INTEGER NOT NULL DEFAULT 0;

-- §10.2/§40.6: the password credential, 1:1 with `users`.
--
--   user_id             primary key AND foreign key — one credential per identity
--   password_hash       the Argon2id PHC string (salt + parameters are inside it,
--                       so a per-user random salt needs no separate column)
--   password_updated_at server clock of the last set/rotate
CREATE TABLE "user_credentials" (
    "user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("user_id")
);

-- §10.3/§40.6: the server-side session = the refresh-token family.
--
--   id                 server-generated (§39.2: never client-supplied)
--   user_id            the identity the session belongs to
--   created_at         when the session was opened (a successful login)
--   last_used_at       moved forward on every successful rotation
--   absolute_expires_at hard ceiling on the whole family's life
--   revoked_at         NULL = active; a set value is permanent
--   revoked_reason     closed vocabulary: LOGOUT | REUSE_DETECTED | ADMIN
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- §10.3/§40.6: one rotating opaque refresh token.
--
--   session_id       the family this token belongs to
--   token_hash       SHA-256 hex of the opaque token — the ONLY stored form
--   issued_at        when this link in the chain was minted
--   idle_expires_at  per-token idle ceiling (a used token advances the chain)
--   consumed_at      set at rotation; a second presentation is reuse
--   successor_id     the token that replaced this one (NULL until consumed)
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "successor_id" UUID,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- §10.2/§40.6: bounded failed-attempt backoff.
--
--   key              caller-derived scope (canonical email, or client address)
--   failure_count    consecutive failures since the last success/expiry
--   first_failure_at start of the current failure run (resets the backoff)
--   last_failure_at  most recent failure
--   blocked_until    bounded in the future by the service; never permanent
CREATE TABLE "auth_throttles" (
    "key" TEXT NOT NULL,
    "failure_count" INTEGER NOT NULL,
    "first_failure_at" TIMESTAMPTZ(6) NOT NULL,
    "last_failure_at" TIMESTAMPTZ(6) NOT NULL,
    "blocked_until" TIMESTAMPTZ(6),

    CONSTRAINT "auth_throttles_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_successor_id_key" ON "refresh_tokens"("successor_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_successor_id_fkey" FOREIGN KEY ("successor_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECK constraints (Prisma does not model these; they do not affect the drift
-- gate, exactly as `0003`'s and `0004`'s CHECKs do not). Each restates an
-- invariant the service enforces so a writer that bypasses the service — a
-- future migration, an operator in `psql`, a direct statement — still cannot
-- store state the service would refuse (the F-3 discipline).
-- ---------------------------------------------------------------------------

-- §10.2: only an Argon2id PHC string may ever be a stored credential. This is
-- the database's copy of the hashing contract; it makes "an accidental MD5/bcrypt
-- column" or a plaintext slip impossible to commit.
ALTER TABLE "user_credentials"
  ADD CONSTRAINT "chk_user_credentials_password_hash_argon2id"
  CHECK ("password_hash" LIKE '$argon2id$%' AND length("password_hash") BETWEEN 32 AND 512);

-- §10.3/§11: a permission generation never goes backwards.
ALTER TABLE "users"
  ADD CONSTRAINT "chk_users_permissions_version_non_negative"
  CHECK ("permissions_version" >= 0);

-- §10.3: a revocation always carries a reason, and only from the closed
-- vocabulary; an active session carries neither. The two columns move together.
-- `revoked_reason IS NOT NULL` is stated explicitly: a bare `IN (...)` is NULL
-- when the column is NULL, and a CHECK that evaluates to NULL is *satisfied*, so
-- the explicit predicate is what actually rejects a reasonless revocation.
ALTER TABLE "sessions"
  ADD CONSTRAINT "chk_sessions_revocation_shape"
  CHECK (
    ("revoked_at" IS NULL AND "revoked_reason" IS NULL)
    OR (
      "revoked_at" IS NOT NULL
      AND "revoked_reason" IS NOT NULL
      AND "revoked_reason" IN ('LOGOUT', 'REUSE_DETECTED', 'ADMIN')
    )
  );

-- §10.3: the absolute ceiling is strictly after the session opened, so a
-- zero-or-negative lifetime can never be stored.
ALTER TABLE "sessions"
  ADD CONSTRAINT "chk_sessions_absolute_expiry_after_creation"
  CHECK ("absolute_expires_at" > "created_at");

-- §10.3: a consumed token always has a successor — the rotation chain is never
-- broken, so reuse detection can always walk forward to revoke the family.
ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "chk_refresh_tokens_consumed_has_successor"
  CHECK ("consumed_at" IS NULL OR "successor_id" IS NOT NULL);

-- §10.3: a token's idle ceiling is strictly after it was issued.
ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "chk_refresh_tokens_idle_expiry_after_issue"
  CHECK ("idle_expires_at" > "issued_at");

-- §10.2: a throttle row exists only because there was at least one failure, and
-- its window is ordered.
ALTER TABLE "auth_throttles"
  ADD CONSTRAINT "chk_auth_throttles_failure_count_positive"
  CHECK ("failure_count" >= 1);

ALTER TABLE "auth_throttles"
  ADD CONSTRAINT "chk_auth_throttles_time_order"
  CHECK ("last_failure_at" >= "first_failure_at");
