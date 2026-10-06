/**
 * Domain error type.
 *
 * Deliberately separate from Nest's `HttpException`. Master Plan §7.3 makes the backend
 * the only authority for every business invariant, and a domain failure — insufficient
 * stock, a discount over the ceiling, an expired offline grace window — is a *domain*
 * fact, not a transport concern. Throwing an `HttpException` from a service would put
 * a status code in the business logic, which is how a rule ends up subtly tied to a
 * transport version.
 *
 * The error carries a stable `code` (§34.3) and nothing else. It does not carry a
 * message the client is expected to read, because §13.1 requires the client to receive
 * the safe message derived from the code, never a thrown string.
 */

import { ERROR_CODES, type ErrorCode } from './problem';

export class DomainError extends Error {
  readonly code: ErrorCode;

  /**
   * Field-level detail for validation-shaped failures, already stripped of anything
   * internal. Never populated from a raw driver error.
   */
  readonly errors: readonly { readonly field: string; readonly messages: readonly string[] }[] | undefined;

  /**
   * @param code Stable machine-readable code.
   * @param diagnostic Internal detail for the **server log only**. It is never
   *   serialised into a response; `buildProblem` substitutes the code's safe message.
   *   This parameter exists so an operator can debug without the client learning
   *   anything, which is the distinction §13.1 draws.
   */
  constructor(
    code: ErrorCode,
    readonly diagnostic?: string,
    errors?: readonly { readonly field: string; readonly messages: readonly string[] }[],
  ) {
    super(diagnostic === undefined ? code : `${code}: ${diagnostic}`);
    this.name = 'DomainError';
    this.code = code;
    this.errors = errors;
  }
}

/** Narrowing helper, so a catch block can branch without an `instanceof` chain. */
export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/** Convenience constructors for the codes raised in more than one place. */
export const domainErrors = {
  insufficientStock(diagnostic?: string): DomainError {
    return new DomainError(ERROR_CODES.INSUFFICIENT_STOCK, diagnostic);
  },
  notFound(diagnostic?: string): DomainError {
    return new DomainError(ERROR_CODES.NOT_FOUND, diagnostic);
  },
  permissionDenied(diagnostic?: string): DomainError {
    return new DomainError(ERROR_CODES.PERMISSION_DENIED, diagnostic);
  },
} as const;
