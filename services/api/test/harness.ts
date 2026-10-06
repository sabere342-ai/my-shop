/**
 * Integration test harness.
 *
 * Master Plan §36.2 requires integration tests to run a **full request** through
 * routing, validation, service, repository, Prisma, and the database, over HTTP with
 * Supertest — never a mock or an in-memory substitute.
 *
 * This harness boots `createApplication`, which is the same function `main.ts` calls.
 * That is the point: a test that built a reduced application would be testing something
 * the process does not run, and the global pipe and exception filter are exactly the
 * wiring most worth verifying.
 *
 * The port is bound by Supertest on an ephemeral port, so no port is reserved here and
 * two suites can run concurrently.
 *
 * No database project exists yet. §36.2 forbids an in-memory substitute, so there is
 * nothing to substitute: M1-S3 adds a project that runs against a real PostgreSQL
 * instance. Nothing in this file pretends otherwise.
 */

import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { createApplication } from '../src/bootstrap';
import { loadConfig, type AppConfigShape } from '../src/common/config/app.config';
import { ReadinessRegistry } from '../src/common/health/readiness.registry';

/**
 * A test configuration.
 *
 * `LOG_LEVEL: 'silent'` is not cosmetic: §13.1 requires logs redacted by construction,
 * and an assertion suite that prints structured logs on every request buries the one
 * line a failure needs. The logging behaviour itself is asserted directly in
 * `logger.spec.ts` and `request-logger` tests rather than through captured output here.
 */
export const TEST_CONFIG: AppConfigShape = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  LOG_PRETTY: 'false',
});

export interface TestHarness {
  readonly app: INestApplication;
  readonly http: TestAgent;
  readonly config: AppConfigShape;
  readonly readiness: ReadinessRegistry;
}

export async function createTestHarness(config: AppConfigShape = TEST_CONFIG): Promise<TestHarness> {
  const { app } = await createApplication(config);
  await app.init();

  // Resolved from the running application rather than constructed separately, so a
  // readiness check registered in a test is the same instance the endpoint reads.
  const readiness = app.get(ReadinessRegistry);

  return {
    app,
    // `getHttpServer()` is typed `any` by Nest because it may be an http or an https
    // server. Narrowed to the concrete type Supertest accepts, so the call below is not
    // an unchecked `any` reaching the transport.
    http: request(app.getHttpServer() as Server),
    config,
    readiness,
  };
}

export async function destroyTestHarness(harness: TestHarness): Promise<void> {
  await harness.app.close();
}
