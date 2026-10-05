# ADR-003 — Riverpod with generated providers; no global mutable singletons

**Status:** Accepted
**Decided in:** Master Plan §6.4, §6.5, §41
**Implement in:** M1-S5 (the provider graph), pinned from M1-S1
**Revisit at:** M10

## Context

Master Plan §5.4 records the legacy client's state model: **7 global mutable singletons**
via `static final X instance`, plus **4 `static` mutable bootstrap callbacks** registered
from a 155-line imperative bootstrap in `main.dart`. Every one of those is a seam that a
test cannot substitute, a widget cannot rebuild for, and two features can fight over.

The stated goal is not "clean architecture". It is that a screen can be tested by
substituting one provider, and that no business state lives somewhere no test can reach.

## Decision

**Riverpod 2.x with `riverpod_generator`, one `AsyncNotifier` controller per feature screen
group.** Rules:

- No global mutable singleton holds business state. Services are injected.
- All async state is `AsyncValue`. No hand-rolled `bool isLoading` fields.
- Invalidation is by feature key, never a global refresh.
- Provider-based constructor injection in `domain` and `data`. **No service locator, no
  static registration seam, no `X.instance`.**

`DatabaseHelper.instance` and the four static bootstrap callbacks are `DO_NOT_COPY`
(Master Plan §6.5).

## Rationale

- `AsyncValue` makes loading, error, and data states unrepresentable-by-omission. A
  hand-rolled `isLoading` plus a nullable list plus a nullable error is the classic source
  of a screen that renders an empty state while data is still loading.
- Feature-keyed invalidation matters for an offline-capable client: after a sync resolves,
  exactly the affected feature's data is refetched, rather than triggering a full refresh
  that would fight the local cache Master Plan §38.6 governs.
- Code generation removes the class of bug where a provider is renamed and one call site
  silently keeps the old instance.

## Consequences

- The provider graph becomes the DI root and must be assembled in one reviewable place.
  That is a cost, accepted: it is the price of substitutability.
- Generated files are committed (Master Plan §6.7) so CI needs no codegen step to
  analyse the tree.
- `build_runner` is the only code generator in the client. Drift, `freezed`, and
  `json_serializable` all run through it, so one tool owns generated output.

## Rejected alternatives

| Option | Why rejected |
|---|---|
| BLoC / Cubit | Strong isolation, but the per-screen ceremony is disproportionate for a CRUD-and-poster product. Remains acceptable inside a single complex feature later. |
| `Provider` / `ChangeNotifier` | Invites exactly the mutable-singleton and ad-hoc `isLoading` patterns the legacy application exhibited. |
| Legacy `setState` plus 7 singletons | Master Plan §5.4. The defect that produced a 3,926-line god object. |