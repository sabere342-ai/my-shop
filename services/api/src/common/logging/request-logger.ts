/**
 * Request logging middleware.
 *
 * Master Plan §13.1: "Structured JSON, redacted by construction. Never logs tokens,
 * passwords, or secret values." §38.28.3 extends the same rule to offline payloads and
 * to `mutation_id` / `device_id` / `sync_batch_id` / `trace_id` propagation.
 *
 * Two properties are enforced here rather than left to reviewers:
 *
 * 1. **The body is never logged.** A POST body carries a password on the login route
 *    and a whole sale on the sales route. There is no safe-by-default subset, so the
 *    field is not present at all.
 * 2. **Credential headers are dropped by name, but their presence is kept.** "This
 *    request carried an Authorization header" is useful signal; its value is not.
 *
 * `trust proxy` is deliberately left off. §13.1 requires an accurate client IP for
 * rate limiting (§13.5) and audit (§32), and trusting an unvalidated `X-Forwarded-For`
 * lets a caller spoof its own address and defeat both.
 */

import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';
import { logPayload, redactHeaders, redactQuery, QUERY_ALLOW_LIST } from './logger';
import { TRACE_HEADER, resolveTraceId } from './trace-id';

export interface RequestLoggerOptions {
  readonly logger: Logger;
}

export function requestLogger(options: RequestLoggerOptions) {
  const { logger } = options;
  const log = logger.child({ component: 'http' });

  return function requestLoggerMiddleware(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    const traceId = resolveTraceId(request.headers[TRACE_HEADER]);
    const path = request.path;

    // Propagated both ways: the response header lets a caller quote it, and the log
    // line lets an operator find the request. §13.1 makes traceId the only internal
    // detail a client is given.
    response.setHeader(TRACE_HEADER, traceId);

    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

      const fields = logPayload({
        traceId,
        requestId: traceId,
        method: request.method,
        path,
        statusCode: response.statusCode,
        durationMs: Math.round(durationMs * 1000) / 1000,
        ...(request.ip === undefined ? {} : { ip: request.ip }),
        ...(typeof request.headers['user-agent'] === 'string' ? { userAgent: request.headers['user-agent'] } : {}),
      });

      // Headers and query are redacted, and are logged at debug only: they are
      // diagnostic detail, not per-request signal, and at info level they would be the
      // bulk of the log volume.
      if (log.level === 'debug' || log.level === 'trace') {
        log.debug(
          {
            ...fields,
            headers: redactHeaders(request.headers as Record<string, unknown>),
            query: redactQuery(request.query as Record<string, unknown>, QUERY_ALLOW_LIST[path] ?? []),
          },
          'request',
        );
        return;
      }

      // 5xx is an error for the operator; 4xx is expected traffic. Logging both at
      // `warn` would train operators to ignore the level that matters.
      if (response.statusCode >= 500) {
        log.error(fields, 'request completed');
      } else if (response.statusCode >= 400) {
        log.warn(fields, 'request rejected');
      } else {
        log.info(fields, 'request completed');
      }
    });

    next();
  };
}
