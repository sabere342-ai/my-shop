/**
 * Process entry point.
 *
 * Kept to the minimum a process needs: load and validate configuration, create the
 * application, listen, and shut down cleanly. Everything else lives in `bootstrap.ts`
 * so it can be exercised by tests without binding a port.
 *
 * §13.6: nothing here reads a secret from source. Configuration arrives from the
 * environment and invalid configuration aborts the process rather than starting with a
 * default.
 */

import 'reflect-metadata';
import { createApplication } from './bootstrap';
import { ConfigurationError, loadConfig } from './common/config/app.config';
import { errorNameOf } from './common/logging/logger';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      // Configuration failures are written to stderr as plain text: the logger does not
      // exist yet, and a process that cannot start must not depend on the subsystem it
      // failed to configure.
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 78; // EX_CONFIG, the conventional code for a configuration error.
      return;
    }
    throw error;
  }

  const { app, logger } = await createApplication(config);

  // Awaited: a port already in use rejects here, and an unhandled rejection at this point
  // would leave a process that appears to have started and serves nothing. The catch
  // turns EADDRINUSE into a clean non-zero exit.
  await app.listen(config.http.port, '0.0.0.0');

  logger.info(
    { component: 'bootstrap', port: config.http.port, apiPrefix: config.http.apiPrefix, nodeEnv: config.nodeEnv },
    'my-shop api listening',
  );

  const shutdown = (signal: string): void => {
    logger.info({ component: 'bootstrap', signal }, 'shutting down');
    void app
      .close()
      .then(() => {
        process.exit(0);
      })
      .catch((error: unknown) => {
        // Only the error's class: a shutdown failure can carry a connection
        // string in its message, and §13.1/§38.28.3 forbid that in any log. The
        // class name is the bounded, useful half.
        logger.error({ component: 'bootstrap', errorName: errorNameOf(error) }, 'shutdown failed');
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  // The process-fatal path is pre-structured-logger, so it writes to stderr as
  // plain text. It writes the error's class, never its message: a failed
  // bootstrap (a bad `DATABASE_URL`, a rejected credential) is exactly where a
  // secret would otherwise reach CI output (§13.6, §38.28.3).
  process.stderr.write(`fatal: ${errorNameOf(error)}\n`);
  process.exit(1);
});
