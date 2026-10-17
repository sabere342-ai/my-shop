/**
 * Structured, redacted logging.
 *
 * Master Plan §13.1: "Structured JSON, redacted by construction. Never logs tokens,
 * passwords, or secret values." §38.28.3 extends the same rule to offline payloads and
 * sync diagnostics.
 *
 * Two mechanisms, because one is not enough:
 *
 * 1. **Allow-list payload construction.** `logPayload` copies only the named keys out
 *    of a candidate object. A field nobody named cannot be logged, so adding a field to
 *    a log call fails closed. This is the mechanism that carries the guarantee.
 * 2. **Denylist redaction at serialisation.** `createLogger` additionally redacts a
 *    small set of keys by name. This is defence in depth against a call site that
 *    bypasses the payload builder, and it is explicitly *not* the primary control —
 *    a denylist is a list of secrets someone has not thought of yet.
 *
 * Pino is used rather than a bespoke logger because its redaction hooks run inside the
 * serialisation path, after object construction and before the write. Redacting in a
 * wrapper around `console.log` leaves a window in which an object reaches a transport.
 */

import { pino, type Logger, type LoggerOptions } from 'pino';

/**
 * Correlation identifiers Master Plan §38.28.3 requires to propagate through the offline
 * path. Named explicitly so a mutation, its device, its batch, and its trace are all
 * loggable without inventing ad-hoc keys.
 */
export const LOG_FIELDS = {
  traceId: 'traceId',
  mutationId: 'mutationId',
  deviceId: 'deviceId',
  syncBatchId: 'syncBatchId',
  organizationId: 'organizationId',
  userId: 'userId',
} as const;

/**
 * Header names that carry credentials. Present so the request logger can drop them
 * without anyone having to remember which ones exist.
 */
export const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-refresh-token',
]);

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface LoggerOptionsInput {
  readonly level: LogLevel;
  readonly pretty: boolean;
}

/**
 * Pino pretty-printer target, used only when `pretty` is set.
 *
 * Development convenience. A production deployment emits JSON so an aggregator can parse
 * it. `pino-pretty` is resolved at runtime by Pino only when this branch is taken, so a
 * production process never requires it.
 */
const PRETTY_TRANSPORT: NonNullable<LoggerOptions['transport']> = {
  target: 'pino-pretty',
  options: { colorize: true, translateTime: 'SYS:standard', singleLine: true },
};

export function createLogger(options: LoggerOptionsInput): Logger {
  const pinoOptions: LoggerOptions = {
    level: options.level,
    // Defence in depth behind logPayload's allow-list. A call site that bypasses the
    // payload builder still cannot emit these under their own names.
    redact: {
      paths: [
        'password',
        'token',
        'accessToken',
        'refreshToken',
        'secret',
        'apiKey',
        'authorization',
        'cookie',
        '*.password',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        '*.secret',
        '*.apiKey',
      ],
      censor: '[REDACTED]',
      remove: true,
    },
    base: { service: 'my-shop-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      // Emit the level as a bare token. A JSON log consumed by an aggregator should
      // not need to parse a numeric level back into a name.
      level: (label) => ({ level: label }),
    },
    // Conditional spread rather than `transport: options.pretty ? X : undefined`:
    // `exactOptionalPropertyTypes` (§7.1) rejects an explicit `undefined` on an optional
    // property, so the key must be absent rather than present-and-undefined.
    ...(options.pretty ? { transport: PRETTY_TRANSPORT } : {}),
  };

  return pino(pinoOptions);
}

/**
 * The keys a log payload may carry. Anything absent here is dropped by `logPayload`.
 *
 * Deliberately short. Master Plan §13.1 forbids logging tokens, passwords, and secret
 * values; §38.28.3 extends that to offline payloads and session state. A permissive
 * list would defeat both, so adding a key to this object is a reviewable act.
 */
export const LOGGABLE_KEYS: readonly string[] = [
  LOG_FIELDS.traceId,
  LOG_FIELDS.mutationId,
  LOG_FIELDS.deviceId,
  LOG_FIELDS.syncBatchId,
  LOG_FIELDS.organizationId,
  LOG_FIELDS.userId,
  'method',
  'path',
  'statusCode',
  'durationMs',
  'ip',
  'userAgent',
  'requestId',
  'errorCode',
  'errorName',
  'ready',
  'reason',
  'component',
];

/**
 * The longest scalar string `logPayload` will emit.
 *
 * §38.28.3: an unbounded string is how a payload fragment or an injected newline
 * reaches a log line. A correlation id is already bounded by its own pattern;
 * this is the ceiling for the free-text fields (`path`, `userAgent`).
 */
const MAX_LOG_STRING_LENGTH = 200;

/** A §38.28.1 correlation id: no whitespace, no quotes, no control characters. */
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,64}$/;

/** A bounded UPPER_SNAKE contract code (`MISSING_OUTCOME`, `RATE_LIMITED`, …). */
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** A bounded, developer-authored error class name (see `errorNameOf`). */
const SAFE_ERROR_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Keys whose value must be a §38.28.1 correlation id (or the request's own id). */
const IDENTIFIER_KEYS: ReadonlySet<string> = new Set([
  LOG_FIELDS.traceId,
  LOG_FIELDS.mutationId,
  LOG_FIELDS.deviceId,
  LOG_FIELDS.syncBatchId,
  LOG_FIELDS.organizationId,
  LOG_FIELDS.userId,
  'requestId',
]);

/** Keys whose value must be a bounded, control-character-free string. */
const BOUNDED_STRING_KEYS: ReadonlySet<string> = new Set(['method', 'path', 'ip', 'userAgent', 'component', 'reason']);

/** Keys whose value must be a non-negative integer. */
const INT_KEYS: ReadonlySet<string> = new Set(['statusCode']);

/** Keys whose value must be a finite, non-negative number. */
const NUMBER_KEYS: ReadonlySet<string> = new Set(['durationMs']);

/** Keys whose value must be a boolean. */
const BOOLEAN_KEYS: ReadonlySet<string> = new Set(['ready']);

/** True for a bounded string with no control character (including a newline). */
function isBoundedString(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_LOG_STRING_LENGTH) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * Returns `value` only when it is safe for the allow-listed `key`, else `undefined`.
 *
 * An allow-listed *key* is not a guarantee about its *value*. The same gap the
 * client telemetry policy closes exists here: a nested object under `path` would
 * serialise a whole payload, a newline in a string forges a log-line boundary, and
 * an arbitrary string under `errorCode` is not a contract code. Each key is
 * therefore classified, and a value that does not satisfy its class is dropped
 * rather than copied. A key with no class is dropped, so a future key added to
 * `LOGGABLE_KEYS` without a value rule fails closed.
 */
function safeLogValue(key: string, value: unknown): unknown {
  if (IDENTIFIER_KEYS.has(key)) {
    return typeof value === 'string' && SAFE_IDENTIFIER.test(value) ? value : undefined;
  }
  if (key === 'errorCode') {
    return typeof value === 'string' && SAFE_CODE.test(value) ? value : undefined;
  }
  if (key === 'errorName') {
    return typeof value === 'string' && SAFE_ERROR_NAME.test(value) ? value : undefined;
  }
  if (BOUNDED_STRING_KEYS.has(key)) {
    return isBoundedString(value) ? value : undefined;
  }
  if (INT_KEYS.has(key)) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
  }
  if (NUMBER_KEYS.has(key)) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (BOOLEAN_KEYS.has(key)) {
    return typeof value === 'boolean' ? value : undefined;
  }
  return undefined;
}

/**
 * Copies only allow-listed keys whose value satisfies `safeLogValue`.
 *
 * @param candidate Untrusted object. May contain anything, including nested
 *   objects and injected newlines.
 * @returns A new object containing only keys named in LOGGABLE_KEYS whose values
 *   passed the per-key value policy.
 */
export function logPayload(candidate: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of LOGGABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(candidate, key)) {
      const value = safeLogValue(key, candidate[key]);
      if (value !== undefined) {
        payload[key] = value;
      }
    }
  }
  return payload;
}

/**
 * Returns the constructor name of [error], and nothing else.
 *
 * §13.1 and §38.28.3 require that a log never carries a token, a password, a
 * connection string, or payload content. An `Error`'s `message` and `stack` are
 * the most common carriers of all four, and Pino's `err` serializer emits both.
 * So an error is logged by its *class*, not by its value: the name is bounded,
 * developer-authored, and carries no runtime data.
 *
 * A throwable that is not an `Error`, whose `name` is empty, or whose `name` is
 * not a plain identifier is reported as `UnknownError` rather than passed
 * through — an attacker-influenced `name` must not become an injection vector.
 */
export function errorNameOf(error: unknown): string {
  if (error instanceof Error && SAFE_ERROR_NAME.test(error.name)) {
    return error.name;
  }
  return 'UnknownError';
}

/**
 * Returns a copy of `headers` safe to log: credential-bearing headers are replaced
 * wholesale, and nothing else is inspected.
 *
 * The header *name* is preserved. "This request carried an Authorization header" is
 * useful operational signal; its value never is.
 */
export function redactHeaders(headers: Readonly<Record<string, unknown>>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(name.toLowerCase())) {
      safe[name] = '[REDACTED]';
      continue;
    }
    safe[name] = typeof value === 'string' ? value : `[${typeof value}]`;
  }
  return safe;
}

/**
 * Returns a copy of a query object with only allow-listed keys.
 *
 * Query strings are the most common accidental leak: a client that puts a token in a
 * query parameter produces a URL that a proxy log and a browser history both record.
 */
export function redactQuery(
  query: Readonly<Record<string, unknown>>,
  allowList: readonly string[],
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const key of allowList) {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      const value = query[key];
      safe[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
  }
  return safe;
}

/** A query-parameter allow-list per route. Empty means "log no query at all". */
export const QUERY_ALLOW_LIST: Readonly<Record<string, readonly string[]>> = {
  '/healthz': [],
  '/readyz': [],
};
