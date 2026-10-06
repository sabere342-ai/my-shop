/**
 * Backend bootstrap.
 *
 * Master Plan §13.1 lists the transport and header controls that apply to the whole
 * application, so they are assembled once here rather than per module:
 *
 * - `helmet` sets CSP, `X-Content-Type-Options`, `Referrer-Policy`, and HSTS.
 * - `trust proxy` is deliberately **off**. §13.5 binds rate limits per IP and §32 records
 *   the client IP for audit; trusting an unvalidated `X-Forwarded-For` lets a caller spoof
 *   its own address and defeat both. Enabling it is a deployment decision that belongs
 *   with the reverse proxy, not with the application.
 * - The JSON body is size-capped. An unbounded parser on a POS API is a cheap
 *   denial-of-service surface.
 *
 * The global pipe and filter are declared as `APP_PIPE` / `APP_FILTER` providers in
 * `AppModule` rather than installed here, so the module graph is the single description
 * of the application's cross-cutting behaviour and a test that boots `AppModule.forRoot`
 * gets exactly what the process gets.
 */

import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { AppConfigShape } from './common/config/app.config';
import { createAppLogger } from './app.providers';
import { requestLogger } from './common/logging/request-logger';
import { PinoNestLoggerAdapter } from './common/logging/pino-nest-adapter';
import type { Logger as PinoLogger } from 'pino';

/** Maximum accepted JSON body. A sale with a few hundred lines is far below this. */
export const MAX_JSON_BODY_BYTES = '1mb';

export interface ConfiguredApplication {
  readonly app: INestApplication;
  readonly logger: PinoLogger;
}

/**
 * Creates and configures the Nest application.
 *
 * Exported separately from `main.ts` so integration tests boot the same application the
 * process boots. §36.2 requires integration tests through routing, validation, service,
 * repository, and the database — which means testing *this* application, not a reduced one.
 */
export async function createApplication(config: AppConfigShape): Promise<ConfiguredApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config), {
    // The Nest internal logger is replaced by Pino. Two log formats interleaved in one
    // process is worse than either alone, because an aggregator cannot parse both.
    logger: false,
    bodyParser: false,
  });

  const logger = createAppLogger(config);
  // Routed through the adapter so Nest's own framework diagnostics land in Pino with the
  // same format as application logs. Without it, `logger: false` would mean a failing
  // DI container produced no output at all.
  app.useLogger(new PinoNestLoggerAdapter(logger));

  const express = app.getHttpAdapter().getInstance() as {
    set: (key: string, value: unknown) => void;
    use: (...handlers: unknown[]) => void;
  };

  express.set('trust proxy', false);
  express.use(
    helmet({
      // The API serves JSON, not HTML, so CSP exists only to constrain a future mistake.
      // `default-src 'none'` is the strictest useful value for a JSON surface.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      // TLS termination is a deployment concern (§42.4 records the target as unspecified),
      // so HSTS is configured but the app does not assume it is fronted by TLS.
      hsts: { maxAge: 31_536_000, includeSubDomains: true },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  express.use(requestLogger({ logger }));

  // Body parsing is done explicitly so the size cap is visible in this file rather than
  // hidden in a Nest option, and so it is the same limit in tests.
  const bodyParser = await import('body-parser');
  express.use(bodyParser.json({ limit: MAX_JSON_BODY_BYTES }));
  express.use(bodyParser.urlencoded({ extended: false, limit: MAX_JSON_BODY_BYTES }));

  app.enableShutdownHooks();

  return { app, logger };
}
