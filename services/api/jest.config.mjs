/**
 * Jest configuration, backend API.
 *
 * Master Plan §36.2 requires two distinct suites and this file is where the difference
 * is made structural rather than conventional:
 *
 * - `unit` - pure domain policies, no I/O. Section 36.2's coverage gate is 90% on the
 *   domain tree, which does not exist yet.
 * - `integration` - full request through routing, validation, service, and the database,
 *   over HTTP with Supertest. Section 36.2's gate is 80% on the modules tree.
 *
 * Splitting them means "the unit tests pass" can never quietly mean "the integration
 * tests were not run", and §36.6's rule that build-pipeline tests must not count toward
 * coverage is enforced by them not existing in either project.
 *
 * §36.2 also forbids an in-memory or mocked substitute for PostgreSQL in financial
 * invariant tests. Nothing in this slice tests an invariant, so no database project
 * exists; M1-S3 adds one against a real instance.
 */

import { fileURLToPath } from 'node:url';

const sharedSetup = fileURLToPath(new URL('../../test-setup.base.ts', import.meta.url));

/** ts-jest transpiles per file, so composite emit settings are disabled here. */
const transform = {
  '^.+\\.ts$': [
    'ts-jest',
    {
      tsconfig: {
        composite: false,
        declaration: false,
        declarationMap: false,
        incremental: false,
      },
    },
  ],
};

/** Settings shared by both projects. */
const shared = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform,
  setupFilesAfterEnv: [sharedSetup],
  clearMocks: true,
  restoreMocks: true,
  detectOpenHandles: true,
};

export default {
  projects: [
    {
      ...shared,
      displayName: 'unit',
      rootDir: '.',
      roots: ['<rootDir>/src'],
      testMatch: ['**/domain/**/*.spec.ts', '**/common/**/*.spec.ts'],
      // §36.1 T-2: financial invariants run against real PostgreSQL and never against a
      // mock, so coverage collection excludes anything that would tempt a future suite
      // into asserting on a substituted database.
      collectCoverageFrom: ['src/**/domain/**/*.ts', 'src/common/**/*.ts', '!src/**/*.d.ts'],
      coverageDirectory: 'coverage/unit',
    },
    {
      ...shared,
      displayName: 'integration',
      rootDir: '.',
      roots: ['<rootDir>/test'],
      testMatch: ['**/*.e2e-spec.ts'],
      collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
      coverageDirectory: 'coverage/integration',
      // Supertest binds an ephemeral port per suite; a default 5s timeout is not enough
      // when a suite boots the full Nest application.
      testTimeout: 30_000,
    },
  ],
  // Off by default so `npm test` stays fast; `npm run test:cov` turns it on. §36.2 makes
  // coverage a CI gate, and CI will pass `--coverage` explicitly.
  collectCoverage: false,
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov'],
};