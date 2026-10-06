/**
 * The error contract.
 *
 * Master Plan §34.3 requires an RFC 7807-shaped problem document with a **stable
 * machine-readable `code`**. That `code` is the load-bearing part: the Flutter client
 * branches on it, and §13.1 requires production errors to expose no stack trace, no SQL,
 * and no internal identifier — only a `traceId`.
 *
 * The vocabulary here is therefore deliberately small and closed. An error the client
 * cannot act on differently is an error the client should not be shown, so
 * `MESSAGE_BY_CODE` exists to make "every code has a safe message" a compile error
 * rather than a review convention.
 *
 * §34.3 also fixes the HTTP statuses: `409` is used for both `INSUFFICIENT_STOCK` and
 * the mutation-ledger replay outcomes, and `503` no longer means "cached read, no
 * queued write" — a dependency failure now triggers offline operation rather than
 * blocking a sale (§34.4 as amended by M0-P2).
 */

/** Stable, machine-readable error codes. Values are API surface: never change one. */
export const ERROR_CODES = {
  // --- Request shape (400, 422) ---
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  MALFORMED_JSON: 'MALFORMED_JSON',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',

  // --- Identity and authorization (401, 403, 404) ---
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_STALE: 'TOKEN_STALE',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  /** Cross-organization resource. ADR-029: 404, not 403, so existence is not leaked. */
  NOT_FOUND: 'NOT_FOUND',
  /** Master Plan section 9.3: also raises a security audit event. */
  ORGANIZATION_FORBIDDEN: 'ORGANIZATION_FORBIDDEN',

  // --- Domain invariants (409, 422) ---
  /** Master Plan section 15.6: the conditional stock guard found insufficient quantity. */
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  /** Master Plan section 17.1: unitPriceApplied differs from unitPriceList without pricing.override. */
  PRICE_OVERRIDE_FORBIDDEN: 'PRICE_OVERRIDE_FORBIDDEN',
  DISCOUNT_FORBIDDEN: 'DISCOUNT_FORBIDDEN',
  DISCOUNT_LIMIT_EXCEEDED: 'DISCOUNT_LIMIT_EXCEEDED',
  DISCOUNT_APPROVAL_REQUIRED: 'DISCOUNT_APPROVAL_REQUIRED',

  // --- Offline mutation ingress (Master Plan section 38) ---
  /** Master Plan section 38.9: an identical mutation_id was already accepted. */
  REPLAY: 'REPLAY',
  /** Master Plan section 38.9.2: same mutation_id, different payload_hash. */
  MUTATION_CONTRADICTION: 'MUTATION_CONTRADICTION',
  /** Master Plan section 15.6A: the server stock guard failed after convergence. */
  INVENTORY_CONFLICT: 'INVENTORY_CONFLICT',
  /** Master Plan section 38.16.2: the offline grace window has expired. */
  OFFLINE_GRACE_EXPIRED: 'OFFLINE_GRACE_EXPIRED',
  /** Master Plan section 38.30.2: a revoked device's queued mutations await owner decision. */
  DEVICE_REVOKED: 'DEVICE_REVOKED',

  // --- Rate limiting (429) ---
  RATE_LIMITED: 'RATE_LIMITED',

  // --- Server faults (500, 503) ---
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Safe, user-presentable text per code.
 *
 * Recorded here rather than thrown at each call site so that no internal detail can
 * reach a client by accident: an unmapped code has no message at all, and the filter
 * falls back to a generic string rather than to `error.message`.
 */
const MESSAGE_BY_CODE: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'The request was not valid.',
  MALFORMED_JSON: 'The request body could not be parsed.',
  UNSUPPORTED_MEDIA_TYPE: 'The request content type is not supported.',

  UNAUTHENTICATED: 'Authentication is required.',
  TOKEN_EXPIRED: 'The session has expired.',
  TOKEN_STALE: 'Permissions have changed. Sign in again.',
  PERMISSION_DENIED: 'You are not permitted to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  ORGANIZATION_FORBIDDEN: 'You are not a member of this organization.',

  INSUFFICIENT_STOCK: 'Not enough stock is available.',
  PRICE_OVERRIDE_FORBIDDEN: 'You are not permitted to change the price.',
  DISCOUNT_FORBIDDEN: 'You are not permitted to apply this discount.',
  DISCOUNT_LIMIT_EXCEEDED: 'The discount exceeds the permitted maximum.',
  DISCOUNT_APPROVAL_REQUIRED: 'This discount requires approval.',

  REPLAY: 'This operation was already processed.',
  MUTATION_CONTRADICTION: 'This operation conflicts with an earlier one.',
  INVENTORY_CONFLICT: 'Stock on the server differs from the recorded quantity.',
  OFFLINE_GRACE_EXPIRED: 'The offline authorization window has expired.',
  DEVICE_REVOKED: 'This device has been revoked.',

  RATE_LIMITED: 'Too many requests. Try again shortly.',

  INTERNAL_ERROR: 'An unexpected error occurred.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
};

/** The HTTP status each code maps to. RFC 7807 `status`. */
const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  MALFORMED_JSON: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,

  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_STALE: 401,
  PERMISSION_DENIED: 403,
  ORGANIZATION_FORBIDDEN: 403,
  // ADR-029: 404 rather than 403, so a caller cannot probe for another tenant's rows.
  NOT_FOUND: 404,

  INSUFFICIENT_STOCK: 409,
  PRICE_OVERRIDE_FORBIDDEN: 403,
  DISCOUNT_FORBIDDEN: 403,
  DISCOUNT_LIMIT_EXCEEDED: 403,
  DISCOUNT_APPROVAL_REQUIRED: 403,

  // Master Plan section 34.4 as amended: a dependency failure triggers offline
  // operation. 503 therefore means "come back later", not "your write was dropped".
  REPLAY: 409,
  MUTATION_CONTRADICTION: 409,
  INVENTORY_CONFLICT: 409,
  OFFLINE_GRACE_EXPIRED: 403,
  DEVICE_REVOKED: 403,

  RATE_LIMITED: 429,

  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

/**
 * The client-presentable message for a code.
 *
 * Falls back to the generic text rather than to a caller-supplied string. This is the
 * single most important line in the file: it is what makes "no stack trace, no SQL, no
 * internal identifier" (§13.1) structural instead of aspirational.
 */
export function messageForCode(code: ErrorCode): string {
  return MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE.INTERNAL_ERROR;
}

export interface ProblemDocument {
  /** RFC 7807 `type`. A stable URN identifying the problem class. */
  readonly type: string;
  /** RFC 7807 `title`. Short, human-readable, code-derived. */
  readonly title: string;
  readonly status: number;
  /** The stable machine-readable code the Flutter client branches on. */
  readonly code: ErrorCode;
  readonly detail: string;
  /** RFC 7807 `instance`. The request path. */
  readonly instance: string;
  /** Correlates the response with the server log line. §13.1: the only internals exposed. */
  readonly traceId: string;
  /** RFC 7807 extension: field-level validation detail. Absent for non-validation errors. */
  readonly errors?: readonly { readonly field: string; readonly messages: readonly string[] }[];
}

const PROBLEM_TYPE_PREFIX = 'https://docs.my-shop/errors/';

/**
 * RFC 7807 `type`: a stable documentation URI, one page per error code.
 *
 * The value is the code verbatim, exactly as Master Plan §34.3 specifies
 * (`https://docs.my-shop/errors/INSUFFICIENT_STOCK`). §43.4 makes the plan the authority,
 * so the literal form is not ours to normalise: a lower-cased or hyphenated variant would
 * be a different URI, and the client is entitled to branch on `code` regardless.
 */
export function problemTypeFor(code: ErrorCode): string {
  return `${PROBLEM_TYPE_PREFIX}${code}`;
}

/**
 * RFC 7807 `title`: a short, code-derived phrase. Distinct from `detail`, which
 * carries the fuller sentence.
 *
 * Server faults are grouped under one title on purpose. A 5xx title that named the
 * specific fault would be telling a caller which internal component failed, which is
 * the kind of detail §13.1 forbids.
 */
const TITLE_BY_CODE: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'Invalid request',
  MALFORMED_JSON: 'Malformed request',
  UNSUPPORTED_MEDIA_TYPE: 'Unsupported media type',

  UNAUTHENTICATED: 'Authentication required',
  TOKEN_EXPIRED: 'Session expired',
  TOKEN_STALE: 'Permissions changed',
  PERMISSION_DENIED: 'Not permitted',
  NOT_FOUND: 'Not found',
  ORGANIZATION_FORBIDDEN: 'Organization not permitted',

  INSUFFICIENT_STOCK: 'Insufficient stock',
  PRICE_OVERRIDE_FORBIDDEN: 'Price change not permitted',
  DISCOUNT_FORBIDDEN: 'Discount not permitted',
  DISCOUNT_LIMIT_EXCEEDED: 'Discount limit exceeded',
  DISCOUNT_APPROVAL_REQUIRED: 'Discount approval required',

  REPLAY: 'Already processed',
  MUTATION_CONTRADICTION: 'Conflicting operation',
  INVENTORY_CONFLICT: 'Inventory conflict',
  OFFLINE_GRACE_EXPIRED: 'Offline window expired',
  DEVICE_REVOKED: 'Device revoked',

  RATE_LIMITED: 'Rate limited',

  INTERNAL_ERROR: 'Server error',
  SERVICE_UNAVAILABLE: 'Service unavailable',
};

function titleFor(code: ErrorCode, status: number): string {
  if (status >= 500) return TITLE_BY_CODE.INTERNAL_ERROR;
  return TITLE_BY_CODE[code];
}

export interface BuildProblemInput {
  readonly code: ErrorCode;
  readonly instance: string;
  readonly traceId: string;
  /** Overrides `detail`. Callers must pass user-presentable text only, never `error.message`. */
  readonly detail?: string;
  readonly errors?: readonly { readonly field: string; readonly messages: readonly string[] }[];
}

export function buildProblem(input: BuildProblemInput): ProblemDocument {
  const status = statusForCode(input.code);
  const detail = input.detail ?? messageForCode(input.code);

  return {
    type: problemTypeFor(input.code),
    title: titleFor(input.code, status),
    status,
    code: input.code,
    detail,
    instance: input.instance,
    traceId: input.traceId,
    ...(input.errors === undefined ? {} : { errors: input.errors }),
  };
}
