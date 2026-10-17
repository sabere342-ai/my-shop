import { ERROR_CODES, buildProblem, messageForCode, problemTypeFor, statusForCode } from './problem';

describe('error code contract', () => {
  it('maps every code to an HTTP status', () => {
    // §34.3: the problem document carries a status. A code without one would force the
    // client to infer it.
    for (const code of Object.values(ERROR_CODES)) {
      const status = statusForCode(code);
      expect(typeof status).toBe('number');
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it('gives every code a message that names no internal', () => {
    // §13.1: no stack trace, SQL, or internal identifier in a response.
    const forbidden = ['SELECT ', 'INSERT ', 'postgres://', 'at Object.', '.ts:', 'node_modules'];
    for (const code of Object.values(ERROR_CODES)) {
      const message = messageForCode(code);
      expect(message.length).toBeGreaterThan(0);
      for (const token of forbidden) {
        expect(message).not.toContain(token);
      }
    }
  });

  it('answers 404 rather than 403 for a cross-organization resource', () => {
    // ADR-029: 403 would confirm the row exists in another tenant, which is itself a
    // cross-tenant leak.
    expect(statusForCode(ERROR_CODES.NOT_FOUND)).toBe(404);
  });

  it('answers 403 for an organization the caller is not a member of', () => {
    // §9.3: absence from allowedOrganizationIds yields 403 plus a security audit event.
    expect(statusForCode(ERROR_CODES.ORGANIZATION_FORBIDDEN)).toBe(403);
  });

  it('answers 409 for a replayed mutation', () => {
    // §38.9: the ledger returns REPLAY for an identical resend. Not 200, and not 409 on
    // the *original* — the original already returned its own result.
    expect(statusForCode(ERROR_CODES.REPLAY)).toBe(409);
  });

  it('answers 409 for a mutation payload contradiction', () => {
    // §38.9.2: same mutation_id, different payload_hash.
    expect(statusForCode(ERROR_CODES.MUTATION_CONTRADICTION)).toBe(409);
  });

  it('answers 409 when the server stock guard fails after convergence', () => {
    // §15.6A: the sale is accepted and a conflict is raised. It is not a 4xx rejection,
    // because the goods changed hands.
    expect(statusForCode(ERROR_CODES.INVENTORY_CONFLICT)).toBe(409);
  });

  it('answers 503 for an unavailable dependency, not a cached read', () => {
    // §34.4 as amended by M0-P2: a dependency failure now triggers offline operation.
    // The old meaning — "cached read, no queued write" — is superseded, and a 503 must
    // not imply the client's write was dropped.
    expect(statusForCode(ERROR_CODES.SERVICE_UNAVAILABLE)).toBe(503);
  });

  it('derives a stable documentation URI per code', () => {
    // §34.3 states the form literally: one page per error code, code verbatim.
    expect(problemTypeFor(ERROR_CODES.INSUFFICIENT_STOCK)).toBe('https://docs.my-shop/errors/INSUFFICIENT_STOCK');
    expect(problemTypeFor(ERROR_CODES.MUTATION_CONTRADICTION)).toBe(
      'https://docs.my-shop/errors/MUTATION_CONTRADICTION',
    );
  });

  it('gives every code a distinct documentation URI', () => {
    const types = Object.values(ERROR_CODES).map(problemTypeFor);
    expect(new Set(types).size).toBe(types.length);
  });
});

describe('buildProblem', () => {
  const instance = '/api/v1/sales';

  it('produces an RFC 7807 document with the required members', () => {
    const problem = buildProblem({ code: ERROR_CODES.INSUFFICIENT_STOCK, instance, traceId: 'trace-1' });

    expect(problem.type).toBe('https://docs.my-shop/errors/INSUFFICIENT_STOCK');
    expect(problem.title).toBe('Insufficient stock');
    expect(problem.status).toBe(409);
    expect(problem.code).toBe('INSUFFICIENT_STOCK');
    expect(problem.instance).toBe(instance);
    expect(problem.traceId).toBe('trace-1');
  });

  it('omits the errors member when there is no field detail', () => {
    const problem = buildProblem({ code: ERROR_CODES.INSUFFICIENT_STOCK, instance, traceId: 'trace-1' });
    expect(problem).not.toHaveProperty('errors');
  });

  it('includes field detail when supplied', () => {
    const problem = buildProblem({
      code: ERROR_CODES.VALIDATION_FAILED,
      instance,
      traceId: 'trace-2',
      errors: [{ field: 'quantity', messages: ['must be a positive integer'] }],
    });

    expect(problem.errors).toEqual([{ field: 'quantity', messages: ['must be a positive integer'] }]);
  });

  it('uses the code-derived message when no detail is supplied', () => {
    const problem = buildProblem({ code: ERROR_CODES.PERMISSION_DENIED, instance, traceId: 'trace-3' });
    expect(problem.detail).toBe(messageForCode(ERROR_CODES.PERMISSION_DENIED));
  });

  it('groups every server fault under one title', () => {
    // A 5xx title naming the specific fault would tell a caller which internal
    // component failed, which §13.1 forbids.
    expect(buildProblem({ code: ERROR_CODES.INTERNAL_ERROR, instance, traceId: 't' }).title).toBe('Server error');
    expect(buildProblem({ code: ERROR_CODES.SERVICE_UNAVAILABLE, instance, traceId: 't' }).title).toBe('Server error');
  });
});
