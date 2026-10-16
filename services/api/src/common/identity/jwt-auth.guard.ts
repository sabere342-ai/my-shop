/**
 * §10.3 / §40.6 M2-S2 — the bearer-access-token guard.
 *
 * The guard is the only place an authenticated request acquires identity. It reads
 * the `Authorization: Bearer …` credential, hands it to `AuthService.authenticate`
 * (which verifies the signature *and* resolves the session and permission
 * generation against live state), and attaches the resulting principal to the
 * request. Controllers then read that principal through `@VerifiedPrincipal()` —
 * never from the body — so a caller cannot assert its own `userId`, `organizationId`,
 * or `sessionId` into authority (§9.3, §38.16).
 *
 * The guard rethrows whatever `authenticate` throws (a `DomainError`), which the
 * global filter turns into the RFC 7807 document for the matching code —
 * `UNAUTHENTICATED` or `TOKEN_EXPIRED`. It never invents a principal on failure.
 */

import { createParamDecorator, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import { AuthService, type AuthenticatedPrincipal } from './auth.service';

/** A request the guard has authenticated, carrying the trusted principal. */
export interface AuthenticatedRequest extends Request {
  authPrincipal?: AuthenticatedPrincipal;
}

/**
 * Extracts the single bearer credential from an `Authorization` header value.
 *
 * Exactly one `Bearer` scheme followed by exactly one non-empty credential is
 * accepted; anything else (missing header, another scheme, a multi-credential
 * header, a trailing space) is refused `UNAUTHENTICATED`. Being strict here means
 * no downstream code has to interpret a partially-parsed header.
 */
export function bearerCredential(header: string | undefined): string {
  if (header === undefined) {
    throw new DomainError(ERROR_CODES.UNAUTHENTICATED, 'authorization header is missing');
  }

  const parts = header.split(' ');
  const scheme = parts[0];
  const credential = parts[1];

  if (
    parts.length !== 2 ||
    scheme === undefined ||
    credential === undefined ||
    credential.length === 0 ||
    scheme.toLowerCase() !== 'bearer'
  ) {
    throw new DomainError(ERROR_CODES.UNAUTHENTICATED, 'authorization header is not a single bearer credential');
  }

  return credential;
}

/** Verifies the bearer access token and attaches the verified principal. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const credential = bearerCredential(typeof header === 'string' ? header : undefined);

    request.authPrincipal = await this.auth.authenticate(credential);

    return true;
  }
}

/**
 * `@VerifiedPrincipal()` — the trusted principal the guard attached.
 *
 * Reading it without `JwtAuthGuard` in the chain is a programming error, not a
 * client error, so it throws rather than returning something falsy a handler might
 * accidentally treat as anonymous.
 */
export const VerifiedPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = request.authPrincipal;
    if (principal === undefined) {
      throw new Error('@VerifiedPrincipal() was read on a route without JwtAuthGuard');
    }
    return principal;
  },
);
