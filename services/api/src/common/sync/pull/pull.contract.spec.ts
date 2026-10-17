/**
 * Pull contract tests (Master Plan §40.5, M1b-S6; §38.11).
 *
 * The contract's load-bearing parts are the cursor grammar, the page bounds, and
 * the retention window. Each is pinned here as a literal so a change to what the
 * client compiles against is a deliberate edit, not a drift; the query reaches
 * the HTTP layer through the same `class-validator` metadata the global pipe
 * runs, so validation is asserted by running it rather than by reading metadata.
 *
 * The wire shapes are asserted through `plainToInstance` like the pipe does, so
 * `@Type(() => Number)` and `forbidNonWhitelisted` are exercised as production
 * configures them — including that an `offset`/`page` attempt is refused, which
 * is what keeps "cursor, never offset" (§38.11.2) structural rather than a rule
 * the handler remembers.
 */

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  DEFAULT_PULL_PAGE_SIZE,
  MAX_PULL_PAGE_SIZE,
  PULL_RETENTION_DAYS,
  PullQuery,
  SYNC_PULL_PATH,
} from './pull.contract';

/** Runs the global pipe's validation configuration over a candidate query. */
function validate(input: Record<string, unknown>): readonly string[] {
  const instance = plainToInstance(PullQuery, input);
  return validateSync(instance, { whitelist: true, forbidNonWhitelisted: true }).map((error) => error.property);
}

describe('pull contract', () => {
  it('pins the §38.11.2 page bounds, the O-21 retention window, and the path', () => {
    expect(DEFAULT_PULL_PAGE_SIZE).toBe(200);
    expect(MAX_PULL_PAGE_SIZE).toBe(1000);
    expect(PULL_RETENTION_DAYS).toBe(90);
    expect(SYNC_PULL_PATH).toBe('api/v1/sync/pull');
  });

  it('accepts an empty query: from the beginning at the default page size', () => {
    // §38.11.2: both parameters are optional. The service supplies 0 and 200.
    expect(validate({})).toEqual([]);
  });

  it('accepts a decimal-string cursor and an in-range page size', () => {
    expect(validate({ after: '0', limit: 1 })).toEqual([]);
    expect(validate({ after: '90071992547409935', limit: MAX_PULL_PAGE_SIZE })).toEqual([]);
  });

  it('accepts a leading-zero cursor: it is still a non-negative decimal integer', () => {
    expect(validate({ after: '00042' })).toEqual([]);
  });

  it('refuses a cursor that is not a non-negative decimal integer', () => {
    // §38.11.2: `server_sequence` is a 64-bit unsigned counter, so a negative,
    // fractional, signed, or non-numeric cursor is malformed, never coerced.
    for (const after of ['-1', '1.5', '1e3', 'abc', '', '+1', 'NaN', '0x10']) {
      expect(validate({ after })).toContain('after');
    }
  });

  it('refuses a page size outside 1–1000 (§38.11.2)', () => {
    expect(validate({ limit: 0 })).toContain('limit');
    expect(validate({ limit: -5 })).toContain('limit');
    expect(validate({ limit: MAX_PULL_PAGE_SIZE + 1 })).toContain('limit');
  });

  it('refuses a non-integer page size', () => {
    expect(validate({ limit: 1.5 })).toContain('limit');
    expect(validate({ limit: 'many' })).toContain('limit');
  });

  it('coerces a numeric-string page size the query actually carries', () => {
    // Query values arrive as strings; `@Type(() => Number)` is what lets "25"
    // pass rather than being treated as a shape error.
    expect(validate({ limit: '25' })).toEqual([]);
  });

  it('forbids an offset-style parameter, so paging stays cursor-based', () => {
    // §38.11.2: an offset page is not a snapshot. `forbidNonWhitelisted` turns
    // `offset`/`page` into a 400 before any handler can be tempted to honour it.
    expect(validate({ offset: 40 })).toContain('offset');
    expect(validate({ page: 2 })).toContain('page');
  });

  it('forbids a caller-supplied identity field (§38.16, §9.3)', () => {
    // The feed's tenant scope is the authenticated credential; there is no query
    // field that could name another organization.
    expect(validate({ organizationId: '11111111-1111-4111-8111-111111111111' })).toContain('organizationId');
  });
});
