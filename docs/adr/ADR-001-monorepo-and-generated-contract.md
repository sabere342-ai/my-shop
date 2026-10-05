# ADR-001 — Monorepo with `apps/`, `services/`, `packages/` and a generated contract

**Status:** Accepted
**Decided in:** Master Plan §6.2, §7.1, §41
**Implement in:** M1-S1
**Revisit at:** M10

## Context

The Flutter client and the NestJS backend share one domain model. That shared model is
the highest-risk boundary in the system: a contract mismatch is a runtime failure in the
field, on a shop counter, at the moment a customer is waiting.

Three shapes were available.

## Decision

A single repository holding:

```
apps/desktop/        Flutter client, one codebase for Windows and Android
services/api/        NestJS backend
packages/contracts/  generated API contract types
packages/testkit/    shared fixtures and builders
docs/                governance and ADRs
```

The contract is **generated once from the backend** and consumed as a package by the
client, so drift becomes a compile-time failure.

## Rationale

- A generated contract turns drift from a runtime surprise into a build error, which is
  the only form of drift detection that survives a deployment.
- NestJS generates an OpenAPI document from its decorators (Master Plan §7.1), and
  TypeScript types are derived from it. Both sides therefore describe one artifact
  rather than two hand-maintained ones.
- Composites and project references let TypeScript build the packages in dependency
  order and resolve cross-package types from declarations, so a change to the contract
  fails the client build in the same commit that introduced it.

## Consequences

- Atomic refactors across the contract boundary are possible. This is the reason the
  single repository was chosen over two.
- CI must run the generator and compare its output to the committed files, or the
  guarantee is only as good as the last person who remembered to regenerate. That gate
  is **M1-S6** (Master Plan §40.4) and CI gate G-7 (Master Plan §37.3).
- Language boundaries are still enforced: Dart and TypeScript cannot share source, so
  `packages/contracts` publishes TypeScript declarations and the Dart client consumes
  the same document through its own generated layer.

## Rejected alternatives

| Option | Why rejected |
|---|---|
| Two separate repositories | Loses atomic refactors across the contract boundary. A contract change would be two commits, two reviews, and a window in which the two sides disagree. |
| Flutter and backend in one language directory | No shared boundary discipline. NestJS decorators, Prisma, and Dart all in one tree invites cross-contamination and makes the layering rules unstateable. |
| Hand-written types on both sides | This *is* the legacy failure mode. Master Plan §5.4 records that the absence of any price or cost history was the legacy application's most consequential defect; hand-maintained duplicate types are how that class of defect returns. |