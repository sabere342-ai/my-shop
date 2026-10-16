/**
 * Unit acceptance for the bearer guard (§10.3, §9.3, AC-13, AC-14).
 *
 * Two properties are asserted here, and both are about what the guard refuses. The
 * header parser accepts exactly one `Bearer` scheme with exactly one credential — a
 * strictness that means no downstream code ever interprets a half-read header — and
 * the guard attaches a principal only when `AuthService.authenticate` returned one.
 * The route-level wiring (a real token over HTTP) is asserted in the integration and
 * database suites; this is the pure boundary.
 */

import type { ExecutionContext } from '@nestjs/common';

import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import type { AuthService, AuthenticatedPrincipal } from './auth.service';
import { bearerCredential, JwtAuthGuard, type AuthenticatedRequest } from './jwt-auth.guard';

const PRINCIPAL: AuthenticatedPrincipal = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.com',
  organizations: ['22222222-2222-4222-8222-222222222222'],
  sessionId: '33333333-3333-4333-8333-333333333333',
  permissionsVersion: 0,
  expiresAt: new Date('2026-01-01T00:15:00.000Z'),
};

function expectDomainError(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected a DomainError with code ${code}, but nothing was thrown`);
}

/** A minimal `ExecutionContext` whose request is the object handed in. */
function contextFor(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('bearerCredential', () => {
  it('accepts exactly one Bearer scheme with exactly one credential', () => {
    expect(bearerCredential('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerCredential('bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('refuses a missing, empty, or non-bearer header', () => {
    for (const header of [undefined, '', 'Basic abc', 'Bearer', 'Bearer ', ' Bearer abc', 'Token abc']) {
      expectDomainError(() => bearerCredential(header), ERROR_CODES.UNAUTHENTICATED);
    }
  });

  it('refuses a multi-credential header rather than guessing', () => {
    expectDomainError(() => bearerCredential('Bearer a b'), ERROR_CODES.UNAUTHENTICATED);
    expectDomainError(() => bearerCredential('Bearer a, Bearer b'), ERROR_CODES.UNAUTHENTICATED);
  });
});

describe('JwtAuthGuard', () => {
  it('attaches the verified principal to the request', async () => {
    const auth = { authenticate: jest.fn().mockResolvedValue(PRINCIPAL) } as unknown as AuthService;
    const guard = new JwtAuthGuard(auth);
    const request = { headers: { authorization: 'Bearer good-token' } } as AuthenticatedRequest;

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(auth.authenticate).toHaveBeenCalledWith('good-token');
    expect(request.authPrincipal).toBe(PRINCIPAL);
  });

  it('refuses a missing header without consulting the service', async () => {
    const auth = { authenticate: jest.fn() } as unknown as AuthService;
    const guard = new JwtAuthGuard(auth);
    const request = { headers: {} } as AuthenticatedRequest;

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(DomainError);
    expect(auth.authenticate).not.toHaveBeenCalled();
    expect(request.authPrincipal).toBeUndefined();
  });

  it('propagates the service refusal and never invents a principal', async () => {
    const auth = {
      authenticate: jest.fn().mockRejectedValue(new DomainError(ERROR_CODES.UNAUTHENTICATED, 'no')),
    } as unknown as AuthService;
    const guard = new JwtAuthGuard(auth);
    const request = { headers: { authorization: 'Bearer bad-token' } } as AuthenticatedRequest;

    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({ code: ERROR_CODES.UNAUTHENTICATED });
    expect(request.authPrincipal).toBeUndefined();
  });
});
