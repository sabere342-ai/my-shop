# Security architecture — database-enforced tenancy, ingress re-validation, device binding

This document describes My Shop's security posture after slices M2-S4 (tenancy
and ingress re-validation) and M2-S5 (device binding):
defense in depth ends at the database predicate, not at an authorization
guard. The Master Plan (§8, §9.3, §9.4, §12) is the authority; this page explains
how the code composes it. The table-level inventory lives in
[`docs/rls-inventory.md`](rls-inventory.md).

## The three enforcement layers

A request to any tenant-owned datum is proven three times, and no layer can be
skipped by the next one down:

1. **Route layer (M2-S2/M2-S3).** Guards authenticate the principal and check
   the route's organization against the token's membership set. No request
   body ever names a tenant, or an actor.
2. **Trusted transaction context (`src/common/database/tenant-context.ts`).**
   Every tenant-owned operation runs inside a transaction whose context was
   set from values the caller already verified: the guard-checked route
   organization, the authenticated sync trusted context, a server-resolved
   account id, or the operator bootstrap key. The settings are applied with
   `set_config(<name>, <value>, is_local => true)` — transaction-local by
   construction: gone at commit, gone at rollback, never carried by a pooled
   connection. There is no session-level `SET` and no mutable module state.
3. **Database layer (migration `0008_tenant_row_level_security`).** Every
   tenant-owned table is `ENABLE` + `FORCE` row-level security with a
   `tenant_isolation` policy comparing the row's tenant column against the
   context. A statement with the wrong tenant, a missing context, or no
   context at all sees no rows and can write none — fail-closed by predicate,
   not by convention. `FORCE` extends the policy to the table owner, so even
   a future feature that "forgets" the transaction cannot read tenant rows:
   it gets zero.

## Transaction ownership — who establishes which context

| Flow | Context | Established from |
| --- | --- | --- |
| Organization-scoped request (`AuthorizationService`) | Tenant (`withTenantTransaction`) | The guard-checked route organization |
| Device routes (M2-S5: register / list / bind / revoke) | Tenant (`withTenantTransaction`) | The guard-checked route organization |
| Sync device identity resolution (`DeviceBoundSyncAuthenticator`) | Tenant (`withTenantTransaction`) | Each membership the verified principal claims, against the device id the signed `did` claim carries |
| Offline mutation acceptance / pull (`MutationLedgerService`) | Tenant (`withTenantTransaction`) | The sync trusted context (`SYNC_AUTHENTICATOR`) |
| Login, refresh rotation | Identity (`withIdentityTransaction`, D-A) | A server-resolved account record, never the request body |
| Operator bootstrap classification | Bootstrap key (`establishBootstrapKeyContext`, D-B), then re-scoped to the stored tenant id | The §10.4 command's own key, then the server-derived stored row |
| Health probes | None | `SELECT 1` and registered checks touch no tenant table |

## The two widening decisions, and their exact width

Both are documented engineering decisions (M2-S4 slice record §9):

- **D-A — own-identity membership visibility.** `organization_memberships`'s
  `USING` also admits rows whose `user_id` equals `app.current_user_id`, set
  only during identity flows from a resolved account id. A verified user can
  therefore re-resolve their own membership edges across organizations at
  login/rotation (T-4) without seeing any other tenant's row, column, or
  existence. The clause exists **in `USING` only**: every write to the edge
  table stays strictly organization-scoped.
- **D-B — bootstrap-key gated tenant-root visibility.** `organizations`'
  policy also admits the one row whose `bootstrap_key` equals
  `app.current_bootstrap_key`, set only by the §10.4 operator command for the
  key it itself carries. Possession of the key is the authority; possession
  reveals exactly one tenant root — the idempotent-classification minimum.

Both widen nothing beyond a credential the operator or verified user already
supplied, and both are pinned by direct-SQL acceptance proofs (AC-03).

## Offline mutation ingress re-validation (§9.4 T-8…T-12)

A token proves who was online when it was minted. An offline device appears
days later, and every server-side authorization fact may have changed since:
the membership may no longer exist, the role may have been replaced, an
override may have denied. So admission is re-proven **current and live**,
through `ingress-revalidation.ts` (`SYNC_INGRESS_REVALIDATOR`), inside the
very transaction the effect commits in:

1. **Actor.** The verified actor comes from the trusted sync context — never
   the request body's `actorUserId`, which is only an assertion. No verified
   actor: `UNAUTHENTICATED`, recorded.
2. **Membership.** The actor's live membership row is re-read from the
   database now, never from a signed snapshot or the JWT's claim. Missing:
   `ORGANIZATION_FORBIDDEN`, recorded.
3. **Effective permissions.** The actor's current effective set — role grants,
   then per-user `ALLOW`/`DENY` overrides — must contain the mutation's
   required permission (`SALE:CREATE → sales.create` today). Missing:
   `PERMISSION_DENIED`, recorded.

Failures are per-mutation, recorded as REJECTED ledger rows in the same
transaction, and never block later mutations in the same batch (§38.10.3).
Re-validation happens only for *new* applications; the replay of an
already-committed mutation returns its stored outcome without a second effect.

The permission-aggregate map is small and fails closed: an aggregate it does
not recognize cannot be admitted by any fixture or future bulk wiring — it is
refused, recorded, and reported.

## The device-bound sync identity (§12.4, §38.16.2, slice M2-S5)

The M2-S4 admission seam trusted a synthetic actor proven by test fixtures;
M2-S5 gives the seam its genuine production source — the device:

1. **The binding is a server-written fact.** A member's session binds to a
   registered device only through
   `POST …/devices/:deviceId/bind-session`, which re-proves the keystore
   digest, writes `sessions.device_id`, and re-mints the access token with the
   `did` claim. The claim is never advanced by the client: refresh re-derives
   it from the stored session row, and `AuthService.authenticate` refuses any
   token whose `did` disagrees with its session in either direction — missing,
   extra, or foreign.
2. **The sync boundary proves presence, then liveness.**
   `DeviceBoundSyncAuthenticator` (bound to the `SYNC_AUTHENTICATOR` port in
   both the push and the pull module) authenticates the bearer token through
   the exact REST path, refuses an unbound session `UNAUTHENTICATED`, then
   re-reads the **live** device row inside a trusted tenant transaction per
   claimed membership. A revoked device is refused `DEVICE_REVOKED` whatever
   its token still says: the row's `status` is the authority, not the claim.
3. **The tenant scope is derived, never asserted.** The trusted context for
   the sync transaction comes from the RLS-visible device row's stored
   `organization_id` — a token claiming a membership that cannot see the
   device sees *nothing*, indistinguishable from a nonexistent device (§9.2).

Revocation (§12.4) is one transaction: the device becomes `REVOKED` and every
session family bound to it is revoked in the same commit (new
`sessions.revoked_reason` value `DEVICE_REVOKED`), so refresh dies with the
device; live access tokens expire on their §10.3 TTL. Registration re-proves
the keystore digest inside the tenant transaction and never re-activates a
REVOKED installation (§12.2's closed two-state vocabulary): re-installation
enrolls a *new* installation id, leaving the old identity and its quarantined
history intact (§12.5).

## Honest boundaries of this slice

- **The sync boundary admits bound and active devices only.** The
  authenticator is the real `DeviceBoundSyncAuthenticator`, but the *applier*
  stays bound to `FailClosedMutationApplier` until business modules own real
  aggregate apply paths, so every accepted mutation is still recorded
  `REJECTED`/`UNSUPPORTED_MUTATION` — never anonymous acceptance, never a
  silent drop.
- **Membership removal has no path yet.** Administration that can remove a
  member arrives with future slices; until then a stale actor whose
  organization is intact keeps its recorded membership. Tokens still expire,
  and `permissions_version` still freezes stale access tokens on change.
- **No durable security-event stream exists yet.** §42.28's machinery arrives in
  M2-S6; this slice records rejections in the ledger only.
- **Accounting/inventory business effects.** The applier remains the
  fail-closed default; real effects arrive with M4/M5 modules.

## Operations

- RLS needs no operational configuration: the context is set by the
  application inside its own transactions; `psql` operators see no tenant rows
  without establishing a context themselves (by design — see
  [`rls-inventory.md`](rls-inventory.md) for the exact policy shapes).
- The migration changes no role, no grant, no owner, and no pre-existing data.
  Upgrades from `0001`–`0007` keep every pre-existing row byte-identical with
  RLS in force (AC-08 proof); `0009` adds the `devices` table and the
  `sessions.device_id` binding column on top of that posture (M2-S5 AC proof).
