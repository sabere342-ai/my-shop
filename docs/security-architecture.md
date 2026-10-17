# Security architecture — database-enforced tenancy and ingress re-validation (M2-S4)

This document describes My Shop's tenancy security posture after slice M2-S4:
defense in depth ends at the database predicate, not at an authorization
guard. The Master Plan (§8, §9.3, §9.4) is the authority; this page explains
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

## Honest boundaries of this slice

- **Production sync stays fail-closed.** `FailClosedSyncAuthenticator` refuses
  every push; production never admits a device this slice. The admission seam
  is exercised only with labelled test-only fixtures (`test/sync/*`). Device
  registration and binding — the genuine source of a verified sync actor — is
  **M2-S5**.
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
- The migration changes no role, no grant, no owner. Upgrades from
  `0001`–`0007` keep every pre-existing row byte-identical with RLS in force
  (AC-08 proof).
