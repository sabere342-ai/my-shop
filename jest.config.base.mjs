/**
 * Jest configuration, My Shop.
 *
 * Master Plan §36.2 requires Jest with Supertest over HTTP for integration tests
 * and against a real PostgreSQL instance for financial invariants — never a mock
 * or in-memory substitute. M1-S1 has no integration tests yet; M1-S2 and M1-S3
 * add them, and the projects below are the seam they extend.
 *
 * The shared setup file is referenced by absolute path resolved from this file,
 * not through a workspace-relative import, because a workspace's rootDir is its
 * own directory and Jest resolves setup modules from it.
 */

import { fileURLToPath } from 'node:url';

const sharedSetup = fileURLToPath(new URL('./test-setup.base.ts', import.meta.url));

export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/**/index.ts'],
  coverageDirectory: 'coverage',
  // Master Plan §36.1 T-6: no test may depend on wall-clock time or host locale.
  setupFilesAfterEnv: [sharedSetup],
  clearMocks: true,
  restoreMocks: true,
  // Surface an unhandled rejection rather than letting it pass silently. A
  // partially applied posting is a data-integrity defect (Master Plan §28).
  detectOpenHandles: true,
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          // Composite projects emit declarations; ts-jest transpiles per file.
          composite: false,
          declaration: false,
          declarationMap: false,
          incremental: false,
        },
      },
    ],
  },
};