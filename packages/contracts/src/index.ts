/**
 * @my-shop/contracts — generated API contract types.
 *
 * Master Plan §6.2 and ADR-001 make this package the single source of truth for
 * the API surface shared with the Flutter client. It is generated once from the
 * backend and consumed as a package, so contract drift becomes a compile-time
 * failure rather than a runtime surprise.
 *
 * Generation and the drift gate belong to M1-S6. This slice establishes the
 * package, its compiler contract, and the typed primitives the generator will
 * emit into — deliberately no hand-written request or response shapes, because
 * a hand-maintained contract is exactly the drift the ADR rejects.
 */

/** Stable, machine-readable error codes carried by every problem document. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * The REST namespace. A breaking change requires v2 (Master Plan §34.1, ADR-027).
 */
export const API_NAMESPACE = '/api/v1';

/**
 * Contract surface version. Incremented by M1-S6 when the generator is
 * introduced; a mismatch between client and server is a build failure, not a
 * runtime surprise.
 */
export const CONTRACT_VERSION = '0.1.0';

/**
 * Correlation identifier present on every request and echoed on every error, so a
 * user-visible failure can be tied to a log line without exposing internals
 * (Master Plan §13.1 — production errors carry a traceId only).
 */
export type TraceId = string;
