/**
 * @my-shop/contracts — generated API contract types.
 *
 * Master Plan §6.2 and ADR-001 make this package the single source of truth for
 * the API surface shared with the Flutter client. It is generated once from the
 * backend and consumed as a package, so contract drift becomes a compile-time
 * failure rather than a runtime surprise.
 *
 * Generation and the drift gate are M1-S6: the generated contract lives in
 * `./generated/schemas` and is regenerated from the backend's OpenAPI document.
 * This index adds the typed primitives and the contract version alongside —
 * deliberately no hand-written request or response shapes, because a
 * hand-maintained contract is exactly the drift the ADR rejects.
 */

/**
 * The contract types generated from the backend's OpenAPI document (M1-S6).
 * Do not hand-edit: `npm run contracts:check` fails CI when these drift from the
 * backend (Master Plan §7.1 G-7, ADR-001).
 */
export * from './generated/schemas';

/** Stable, machine-readable error codes carried by every problem document. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * The REST namespace. A breaking change requires v2 (Master Plan §34.1, ADR-027).
 */
export const API_NAMESPACE = '/api/v1';

/**
 * Contract surface version. Bumped by M1-S6 (0.1.0 → 0.2.0) when the generated
 * contract types were introduced; a mismatch between client and server is a
 * build failure, not a runtime surprise.
 */
export const CONTRACT_VERSION = '0.2.0';

/**
 * Correlation identifier present on every request and echoed on every error, so a
 * user-visible failure can be tied to a log line without exposing internals
 * (Master Plan §13.1 — production errors carry a traceId only).
 */
export type TraceId = string;
