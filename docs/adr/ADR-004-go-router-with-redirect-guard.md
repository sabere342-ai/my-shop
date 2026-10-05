# ADR-004 — `go_router` with an auth and organization redirect guard

**Status:** Accepted
**Decided in:** Master Plan §6.6, §41
**Implement in:** M1-S5
**Revisit at:** M10

## Context

Two identity facts must be resolved **before the first screen renders**: is the user
authenticated, and which organization is active. Master Plan §9.3 is emphatic that the
active organization is **server-derived per request** and is never client-asserted —
accepting an `organizationId` in a body or trusting an `X-Organization-Id` header is named
as *the* canonical multi-tenant vulnerability.

A navigation model that resolves those facts after the first frame is a model that renders
the wrong organization's screen first, however briefly.

## Decision

**`go_router`**, declarative, named routes per feature, with a redirect guard that
resolves authentication state and organization context before the first screen renders.
Typed route arguments. Direct `Navigator.push(MaterialPageRoute(...))` is forbidden
outside the router.

## Rationale

- A declarative route table plus a guard makes the navigation model **data**, so it can be
  asserted in a test. "A user with only `sales.create` cannot reach the accounting route"
  becomes a table lookup rather than a manual trace, which is what makes invariant I-10
  (Master Plan §36.4) automatable.
- Typed arguments remove the class of bug where a route reads a string parameter and
  crashes on a malformed value.
- A single redirect point means the offline-auth-grace behaviour (Master Plan §38.16) is
  one decision rather than a check repeated in every screen.

## Consequences

- Deep links, a role-driven navigation model, and automated navigation testing all become
  possible. The legacy application had none of the three.
- Every screen must obtain its state from an injected controller rather than from route
  parameters alone, because the guard is the only thing permitted to interpret identity.
- Offline start-up has an extra requirement: the guard must consult the cached signed
  permission snapshot (Master Plan §38.17) rather than only the live session, or an
  offline device cannot resolve its routes. This is wired in M1b-S8.

## Rejected alternatives

| Option | Why rejected |
|---|---|
| `Navigator` with imperative pushes | The guard cannot run before the first `push`, so an unauthenticated deep link renders a frame before being rejected. |
| Router owned by a provider (`auto_route`, `go_router` codegen) | Not rejected on merit; rejected here for one reason: it makes the route table generated rather than declared, which hides it from review. Revisit if the table exceeds reviewable size. |