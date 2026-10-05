/**
 * @my-shop/testkit — shared fixtures and builders.
 *
 * Master Plan §36.6 keeps the legacy application's instinct that invariants must
 * be tested against real data, while §36.6 also forbids build-pipeline tests from
 * counting toward coverage. Fixtures live here so a fixture is written once and
 * cannot quietly diverge between the backend and contract suites.
 *
 * No business fixture exists yet: business entities arrive with their own
 * slices. What is established now is the deterministic identity generation the
 * suites will rely on, which Master Plan §36.1 T-6 requires to be independent of
 * execution order and wall-clock time.
 */

import { randomUUID } from 'node:crypto';

/**
 * A UUID that is unique within a test run and stable within a single test.
 *
 * Deterministic within a test rather than derived from a counter, because a
 * counter makes fixture identity depend on execution order — exactly the coupling
 * §36.1 T-6 forbids.
 */
export function fixtureUuid(): string {
  return randomUUID();
}

/**
 * A collection of unique identifiers, for a test that needs a known number of
 * distinct tenant-scoped rows.
 */
export function fixtureUuids(count: number): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`fixtureUuids requires a non-negative integer, received ${String(count)}`);
  }
  return Array.from({ length: count }, () => randomUUID());
}
