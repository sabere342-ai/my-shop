# Architecture decision records

Every entry is an Architecture Decision Record required by Master Plan §41, which states
that **all of these MUST exist by the end of M2b**. Each records the decision, its
rationale, its consequences, and what was rejected, because a decision without its rejected
alternatives cannot be reviewed by someone who was not present.

| ADR | Decision | Status | Written | Revisit |
|---|---|---|---|---|
| [ADR-001](ADR-001-monorepo-and-generated-contract.md) | Monorepo with `apps/`, `services/`, `packages/` and a generated contract | Accepted | M1-S1 | M10 |
| [ADR-002](ADR-002-feature-first-layering.md) | Feature-first layering with CI-enforced import boundaries; domain is pure Dart | Accepted | M1-S1 | M10 |
| [ADR-003](ADR-003-riverpod-and-no-global-singletons.md) | Riverpod with generated providers; no global mutable singletons | Accepted | M1-S1 | M10 |
| [ADR-004](ADR-004-go-router-with-redirect-guard.md) | `go_router` with an auth/organization redirect guard | Accepted | M1-S1 | M10 |
| [ADR-005](ADR-005-backend-stack.md) | NestJS, strict TypeScript, PostgreSQL 18, Prisma 6 | Accepted | M1-S1 | M10 |

## Not yet written

ADR-006 through ADR-045 are listed in Master Plan §41 with their decisions, rationale, and
revisit triggers already stated. They are written in the slice that implements them rather
than all at once here, so that each record reflects what was actually built and any
deviation is caught while the code is still cheap to change.

Two exceptions are deliberate:

- **ADR-015** (gapless per-organization numbering) and **ADR-022** (server-authoritative
  online-first) are **struck**. They are superseded by ADR-040 and ADR-037 respectively.
  Master Plan §41.1 records both supersessions. Writing an ADR for a decision that was
  reversed would misrepresent the register.
- Any ADR whose decision is *superseded before it is written* is recorded in Master Plan
  §41.1 rather than in this directory.

## Convention

| Field | Rule |
|---|---|
| Filename | `ADR-NNN-kebab-title.md` |
| Status | `Proposed`, `Accepted`, or `Superseded by ADR-NNN` |
| Required sections | Context, Decision, Rationale, Consequences, Rejected alternatives |
| Amendment | Amending an accepted ADR requires an owner decision (Master Plan §43.4). The ADR is marked superseded and a new one is written; the original is not edited to look like it was right all along. |
| Cross-reference | Every ADR cites the Master Plan section that governs it, so a reviewer can check the ADR against the authority rather than against memory. |