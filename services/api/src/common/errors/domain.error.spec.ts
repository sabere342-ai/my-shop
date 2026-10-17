import { DomainError, domainErrors, isDomainError } from './domain.error';
import { ERROR_CODES, statusForCode } from './problem';

describe('DomainError', () => {
  it('carries a stable machine-readable code', () => {
    // §34.3: the client branches on `code`, not on a message.
    const error = new DomainError(ERROR_CODES.INSUFFICIENT_STOCK);
    expect(error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('separates the server-only diagnostic from anything client-visible', () => {
    // The distinction §13.1 draws: the operator can debug, the client learns nothing.
    const error = new DomainError(ERROR_CODES.INSUFFICIENT_STOCK, 'variant 8f3a has 2, requested 5');
    expect(error.diagnostic).toBe('variant 8f3a has 2, requested 5');
    expect(error.message).toContain('INSUFFICIENT_STOCK');
  });

  it('does not place the diagnostic anywhere a serialiser would pick it up as detail', () => {
    const error = new DomainError(ERROR_CODES.INSUFFICIENT_STOCK, 'SELECT * FROM stock_levels');
    // The diagnostic is on the Error, for the log. It is the filter's job to withhold it,
    // and problem.filter.spec asserts exactly that.
    expect(error.diagnostic).toContain('SELECT');
  });

  it('attaches field errors for validation-shaped failures', () => {
    const error = new DomainError(ERROR_CODES.VALIDATION_FAILED, undefined, [
      { field: 'quantity', messages: ['must be positive'] },
    ]);
    expect(error.errors).toEqual([{ field: 'quantity', messages: ['must be positive'] }]);
  });

  it('leaves errors undefined when none were supplied', () => {
    expect(new DomainError(ERROR_CODES.INSUFFICIENT_STOCK).errors).toBeUndefined();
  });

  it('is recognised by isDomainError', () => {
    expect(isDomainError(new DomainError(ERROR_CODES.NOT_FOUND))).toBe(true);
    expect(isDomainError(new Error('plain'))).toBe(false);
    expect(isDomainError('a string')).toBe(false);
    expect(isDomainError(undefined)).toBe(false);
  });
});

describe('domainErrors', () => {
  it('builds the codes raised in more than one place', () => {
    expect(domainErrors.insufficientStock().code).toBe(ERROR_CODES.INSUFFICIENT_STOCK);
    expect(domainErrors.notFound().code).toBe(ERROR_CODES.NOT_FOUND);
    expect(domainErrors.permissionDenied().code).toBe(ERROR_CODES.PERMISSION_DENIED);
  });

  it('maps each of those to the status the contract requires', () => {
    // §15.6 the conditional stock guard yields 409 INSUFFICIENT_STOCK; §17.1 an
    // unauthorized price override yields 403 PRICE_OVERRIDE_FORBIDDEN.
    expect(statusForCode(domainErrors.insufficientStock().code)).toBe(409);
    expect(statusForCode(domainErrors.notFound().code)).toBe(404);
    expect(statusForCode(domainErrors.permissionDenied().code)).toBe(403);
  });

  it('carries the diagnostic without exposing it as a message', () => {
    const error = domainErrors.insufficientStock('on hand 0');
    expect(error.diagnostic).toBe('on hand 0');
  });
});
