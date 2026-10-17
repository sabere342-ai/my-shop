/**
 * Nest's LoggerService adapter for Pino.
 *
 * Nest emits framework-level messages through its own `LoggerService`. Without an
 * adapter, `app.useLogger()` cannot accept a Pino instance, and setting
 * `logger: false` leaves framework diagnostics going nowhere at all — which is how a
 * silently failing DI container survives to production.
 *
 * This adapter routes Nest's output into Pino so that framework diagnostics and
 * application logs share one format, one level vocabulary, and one destination.
 *
 * Nest calls methods named for console levels; Pino's are the same set minus `log`, so
 * `log` maps to `info`.
 */

import type { LoggerService } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';

export class PinoNestLoggerAdapter implements LoggerService {
  constructor(private readonly logger: PinoLogger) {}

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.write('error', message, context, stack);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('trace', message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.write('fatal', message, context);
  }

  private write(
    level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',
    message: unknown,
    context?: string,
    stack?: string,
  ): void {
    // `logPayload` is deliberately not used here: Nest's own messages are
    // framework-generated and already known to contain no request data. Applying the
    // allow-list would strip the very fields that make a DI error diagnosable.
    this.logger[level]({ component: context ?? 'nest', ...(stack === undefined ? {} : { stack }) }, String(message));
  }
}
