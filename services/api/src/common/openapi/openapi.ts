/**
 * OpenAPI document generation (Master Plan §7.1, ADR-001).
 *
 * The document is generated from NestJS decorators — never maintained by hand —
 * and is committed at `packages/contracts/openapi.json`; CI regenerates it into a
 * temporary directory and refuses the build on any byte difference (G-7, stage 16).
 *
 * The M1b-S2 sync contract (§40.5) arrives in two pieces of the same single
 * source: `MutationPayload` is a decorated class registered as an extra model,
 * and `syncContractSchemas()` contributes the two standalone components
 * (`MutationId`, `SyncState`) that a class declaration cannot express. Both are
 * code in `common/sync/sync.contract.ts` — still no hand-maintained JSON.
 *
 * Deliberate headlessness. Pros, §37.4, /healthz and /readyz never touch a
 * dependency, and the body of this document is a pure function of the module graph.
 * The documented endpoints are exactly the controllers bound to the real
 * `AppModule.forRoot(config)` — there is no narrower "documentation app" for the
 * generator to drift from — but the build never binds a port, and generation never
 * depends on a database:
 *
 * - It boots through `NestFactory.create`, which initializes the module graph and
 *   runs lifecycle hooks; `PrismaService.onModuleInit` returns immediately when
 *   `DATABASE_URL` is absent, so the database URLs are removed from the generation
 *   environment below and the build asserts no network at all.
 * - It never calls `listen()` and never calls `app.init()` a second time.
 * - `app.close()` runs the destroy hooks and lets the process exit naturally.
 *
 * Logging is forced silent for generation so the CLI output is the document, not a
 * pino stream. `LOG_PRETTY` is forced off for the same reason: the pretty transport
 * holds a worker no document build needs.
 */

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from '../../app.module';
import { loadConfig } from '../config/app.config';
import { MutationPayload, syncContractSchemas } from '../sync/sync.contract';

export const OPENAPI_TITLE = 'My Shop API';
export const OPENAPI_VERSION = '1';

export const OPENAPI_DESCRIPTION = [
  'The My Shop point-of-sale and back-office API. The backend is the only authority for every business invariant (Master Plan §7.3).',
  'Business traffic lives under `/api/v1` and a breaking change requires `/api/v2` (Master Plan §34.1). v1 is supported until a stated end-of-life published with its release.',
  'Every non-probe error is an RFC 7807 `application/problem+json` document carrying a stable machine-readable `code` (Master Plan §34.3).',
  '`/healthz` and `/readyz` are probes: unauthenticated, outside the versioned namespace, and declaring no permissions because they have none (Master Plan §37.4). Business endpoints declare their required permissions and tenant scoping here once authentication lands (M2).',
].join('\n\n');

/**
 * The environment the generation boots with.
 *
 * Database URLs are removed so the build is deterministic and network-free on any
 * host and in CI, where no PostgreSQL service is provisioned for this job. Logging
 * is forced silent (and pretty-print off) so generation output is the document.
 */
function documentEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  delete env['DATABASE_URL'];
  delete env['MIGRATION_DATABASE_URL'];
  env['LOG_LEVEL'] = 'silent';
  env['LOG_PRETTY'] = 'false';
  return env;
}

/**
 * Builds the OpenAPI document for the real application module graph.
 *
 * @param env Environment to validate configuration against. Defaults to
 *   `process.env`; a caller (test, CLI) supplies its own for determinism.
 */
export async function openapiDocument(env: NodeJS.ProcessEnv = process.env): Promise<OpenAPIObject> {
  const config = loadConfig(documentEnvironment(env));
  const app = await NestFactory.create(AppModule.forRoot(config), { logger: false });
  try {
    const options = new DocumentBuilder()
      .setTitle(OPENAPI_TITLE)
      .setDescription(OPENAPI_DESCRIPTION)
      .setVersion(OPENAPI_VERSION)
      .build();
    const document = SwaggerModule.createDocument(app, options, { extraModels: [MutationPayload] });
    const schemas = ((document.components ??= {}).schemas ??= {});
    Object.assign(schemas, syncContractSchemas());
    return document;
  } finally {
    await app.close();
  }
}
