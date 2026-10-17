/**
 * Trace id generation and request-scoped propagation.
 *
 * Master Plan §13.1 requires production errors to carry a `traceId` and nothing else.
 * That makes this a security control, not a convenience: without it, a caller
 * reporting a failure has no way to reference it, and the tempting alternative is to
 * expose internals.
 *
 * The id is read from an inbound header when present, so a request that already has one
 * from an upstream proxy or the offline device (§38.28.3) keeps it end to end. An
 * inbound value is length-limited and character-filtered: an unvalidated header echoed
 * into a response body is a reflected-input vector.
 */

import { randomUUID } from 'node:crypto';

export const TRACE_HEADER = 'x-trace-id';

/** Maximum accepted length of an inbound trace id. */
const MAX_INBOUND_LENGTH = 64;

/**
 * Pattern for an inbound trace id that is safe to echo: no whitespace, no control
 * characters, no quotes. Keeps the value safe in a JSON body and in a log line.
 */
const SAFE_INBOUND = /^[A-Za-z0-9._:-]{1,64}$/;

export function isAcceptableTraceId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_INBOUND_LENGTH && SAFE_INBOUND.test(value);
}

/**
 * Returns the inbound trace id when it is acceptable, otherwise a fresh one.
 *
 * An unacceptable inbound value is replaced rather than rejected. Rejecting would turn
 * a logging header into a way to fail requests, which is not what it is for.
 */
export function resolveTraceId(inbound: unknown): string {
  return isAcceptableTraceId(inbound) ? inbound : randomUUID();
}
