# ADR-005 — NestJS, strict TypeScript, PostgreSQL 18, Prisma 6

**Status:** Accepted
**Decided in:** Master Plan §7.1, §8.1, §8.3, §41
**Implement in:** M1-S2 (NestJS), M1-S3 (Prisma and PostgreSQL)
**Revisit at:** M10

## Context

Master Plan §7.3 makes the backend **the only authority** for every business invariant:
tenant scope, permission, pricing mode, discount ceiling, stock sufficiency, ledger
balance, posting idempotency. The legacy application enforced authorization in its data
layer, which was the right instinct, but because the *client* held the data, the client
was the boundary. In My Shop the client holds a token and a cache, so the server is
unambiguously the boundary.

That places a hard requirement on the server toolchain: it must be incapable of silently
representing money as a float, tenant scope as a nullable column, or a query as a
string-interpolated statement.

## Decision

| Concern | Choice |
|---|---|
| Runtime | Node.js 22 LTS, pinned to 22.22.3 in `.tool-versions` |
| Language | TypeScript `strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` |
| Framework | NestJS 11 |
| ORM | Prisma 6 |
| Database | PostgreSQL 18 |
| Transport | REST over JSON, namespace `/api/v1` |
| Auth | Short-lived JWT access token plus opaque rotating refresh token |
| Validation | `class-validator` + `class-transformer`, one global pipe |
| Errors | RFC 7807-shaped problem document |
| Tests | Jest; integration against real PostgreSQL; Supertest for HTTP |
| Lint / format | ESLint + Prettier, enforced in CI |

## Rationale

- `noUncheckedIndexedAccess` removes the "index may be `undefined`" class of defect. In
  an order line array this is a wrong total, not a crash.
- `exactOptionalPropertyTypes` prevents an explicit `undefined` from silently widening an
  optional field — which is how "absent" becomes "present but null" and then becomes a
  missing tenant predicate.
- Money is `BigInt` minor units (Master Plan §30.1) and Prisma `Decimal` is reserved for
  non-monetary ratios. Prisma `Decimal` backed by a Postgres `numeric` is an attractive
  nuisance in a financial system; integer minor units with one documented rounding point
  on the server (Master Plan §30.6, §30.8) is the decision.
- One database with a shared schema and forced RLS (Master Plan §8.1, §8.2) means a
  single missed application predicate cannot become a cross-tenant leak. The migrator and
  application roles are separated (Master Plan §13.4).

## Consequences

- The strict flags make the build fail on code that would otherwise ship. That is the
  intent, and it is why they are enforced in `tsconfig.base.json` rather than per package.
- Raw SQL is permitted only via tagged `Prisma.sql` templates; string-interpolated SQL is
  a CI failure (Master Plan §8.3). This is why the ESLint configuration bans floating
  promises and `any`: a half-applied posting is a data-integrity defect.
- No background worker in V1 (Master Plan §7.4). Posting is synchronous inside the request
  transaction, so the accounting path has no eventual consistency.
- Every financial invariant is additionally expressed as a `CHECK` constraint in migration
  SQL, declared in the Prisma schema for reviewability. The database is the last defence,
  not the first.

## Rejected alternatives

| Option | Why rejected |
|---|---|
| Prisma `Decimal` for money | A financial ledger needs a documented single rounding point; binary-adjacent decimal handling invites a rounding difference that surfaces as a trial-balance imbalance weeks later. |
| ORM-per-microservice | Master Plan §7.2 requires module ownership with cross-module reads through the owning repository. Separate deployables would make one transaction across a sale, its stock movements, and its journal entry impossible. |
| `type: "module"` ESM | Settled in M1-S2 once NestJS 11's decorator metadata behaviour is confirmed against the installed toolchain. Recorded here so the decision is not made by accident. |