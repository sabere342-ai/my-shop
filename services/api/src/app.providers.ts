/**
 * Application-wide providers.
 *
 * The logger is provided through an injection token rather than created as a module
 * side effect, for two reasons:
 *
 * 1. The exception filter and the request middleware both need the *same* logger
 *    instance. A filter that built its own would emit lines with no shared correlation.
 * 2. A test can substitute a silent or capturing logger without a global mock.
 */

import type { Logger as PinoLogger } from 'pino';
import { createLogger } from './common/logging/logger';
import type { AppConfigShape } from './common/config/app.config';

/** Injection token for the application-wide Pino logger. */
export const APP_LOGGER = Symbol('APP_LOGGER');

export function createAppLogger(config: AppConfigShape): PinoLogger {
  return createLogger({
    // Both enums name the same Pino levels. They are separate types on purpose: the
    // configuration vocabulary and the logging vocabulary are different contracts, and
    // collapsing them would let a logging change silently become a configuration change.
    level: config.logging.level as Parameters<typeof createLogger>[0]['level'],
    pretty: config.logging.prettyPrint,
  });
}
