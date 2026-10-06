/**
 * Global exception filter — the single place an error becomes an HTTP response.
 *
 * Master Plan §34.3 requires an RFC 7807-shaped problem document with a stable
 * machine-readable `code`; §13.1 requires that no stack trace, SQL string, or internal
 * identifier reaches a client, and that only a `traceId` does.
 *
 * Two properties below are security-relevant, and both are structural rather than
 * conventional:
 *
 * 1. **The thrown message is never used as `detail`.** Every response's `detail` comes
 *    from the code's safe text or from a string a developer wrote in a controller. A
 *    future module therefore cannot leak by throwing an error whose message happens to
 *    contain a connection string.
 * 2. **The filter cannot fail.** A filter that throws while handling an error produces
 *    an unstructured response and loses the contract entirely — an earlier version of
 *    this file did exactly that, turning a 404 into an unhandled 500 because it assumed
 *    `payload.message` was always an array. `catch()` wraps its own body so a defect
 *    here degrades to the most generic possible answer rather than to an exception.
 */

import { Catch, type ArgumentsHost, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import { isDomainError } from './domain.error';
import { logPayload } from '../logging/logger';
import { TRACE_HEADER, resolveTraceId } from '../logging/trace-id';
import { buildProblem, ERROR_CODES, type ErrorCode, type ProblemDocument } from './problem';

/**
 * Shape of a Nest error response that carries field-level validation detail.
 *
 * `message` is typed loosely because Nest does not type it: it is an array of strings
 * for a plain `HttpException`, an array of validator objects for a
 * `ValidationPipe` rejection, and a bare string for anything constructed with a string
 * message. All three occur in practice, so the filter must handle all three.
 */
interface NestPayload {
  readonly message?: unknown;
}

interface FieldViolation {
  readonly field: string;
  readonly messages: readonly string[];
}

/**
 * Extracts field-level detail from a Nest payload, if it has any.
 *
 * Returns an empty list for the string-message case, which is not a validation failure
 * and must not be presented as one.
 */
function toFieldErrors(payload: NestPayload): readonly FieldViolation[] {
  const { message } = payload;
  if (!Array.isArray(message)) return [];

  return message.flatMap((entry: unknown) => {
    if (typeof entry === 'string') {
      return [{ field: 'body', messages: [entry] }];
    }
    if (typeof entry !== 'object' || entry === null) return [];

    const violation = entry as { readonly field?: unknown; readonly messages?: unknown };
    const field = typeof violation.field === 'string' ? violation.field : 'body';
    const messages = Array.isArray(violation.messages)
      ? violation.messages.filter((line: unknown): line is string => typeof line === 'string')
      : [];

    return [{ field, messages }];
  });
}

/**
 * The `detail` a controller supplied, if it is safe to pass through.
 *
 * Only a bare string is accepted, because a bare string is something a developer wrote
 * deliberately. Anything else falls back to the code's safe text.
 */
function developerDetail(payload: NestPayload): string | undefined {
  const { message } = payload;
  return typeof message === 'string' ? message : undefined;
}

/**
 * Status to code, keyed numerically.
 *
 * A `Record<number, ErrorCode>` rather than a `switch`: `getStatus()` returns a plain
 * `number`, and comparing it against enum members in `case` labels makes the mapping
 * depend on enum identity rather than on the value. A lookup table makes the mapping a
 * data table, which is what it is.
 */
const CODE_BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ERROR_CODES.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.PERMISSION_DENIED,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ERROR_CODES.SERVICE_UNAVAILABLE,
};

/** Maps a Nest HttpException onto a stable code, so status alone never shapes the body. */
function codeFromHttpException(exception: HttpException): ErrorCode {
  const status = exception.getStatus();
  const mapped = CODE_BY_STATUS[status];
  if (mapped !== undefined) return mapped;
  if (status >= 500) return ERROR_CODES.INTERNAL_ERROR;
  return ERROR_CODES.VALIDATION_FAILED;
}

export interface ProblemFilterOptions {
  readonly logger: Logger;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger: Logger;

  constructor(options: ProblemFilterOptions) {
    this.logger = options.logger.child({ component: 'ProblemDetailsFilter' });
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const traceId = resolveTraceId(
      Array.isArray(request.headers[TRACE_HEADER]) ? request.headers[TRACE_HEADER][0] : request.headers[TRACE_HEADER],
    );
    const instance = request.originalUrl ?? request.url ?? '/';

    let problem: ProblemDocument;
    try {
      problem = this.toProblem(exception, instance, traceId);
    } catch (defect) {
      // The filter itself failed. Answer with the most generic document the contract
      // permits rather than letting the failure escape: an unstructured error response
      // loses problem+json, and an escaped exception loses the trace id the operator
      // needs to find the line that caused it.
      this.logger.error({ component: 'ProblemDetailsFilter', err: defect }, 'error filter failed');
      problem = buildProblem({ code: ERROR_CODES.INTERNAL_ERROR, instance, traceId });
    }

    this.logOutcome(problem, request, exception);

    // A second guard: if the response has already begun, writing again throws and the
    // client receives a truncated body. Nothing useful can be added at that point.
    if (response.headersSent) {
      this.logger.error({ traceId: problem.traceId, component: 'ProblemDetailsFilter' }, 'response already sent');
      return;
    }

    response
      .status(problem.status)
      .type('application/problem+json')
      .setHeader(TRACE_HEADER, problem.traceId)
      .json(problem);
  }

  /**
   * 5xx is logged with the original error; 4xx is logged without a stack.
   *
   * A client-caused 400 is not a server fault, and a stack per bad request is noise that
   * trains operators to ignore the level that matters.
   */
  private logOutcome(problem: ProblemDocument, request: Request, exception: unknown): void {
    const fields = logPayload({
      traceId: problem.traceId,
      method: request.method,
      path: request.path,
      statusCode: problem.status,
      errorCode: problem.code,
    });

    if (problem.status >= 500) {
      this.logger.error(
        { ...fields, err: exception instanceof Error ? exception : new Error(String(exception)) },
        'request failed',
      );
      return;
    }
    this.logger.warn(fields, 'request rejected');
  }

  private toProblem(exception: unknown, instance: string, traceId: string): ProblemDocument {
    if (isDomainError(exception)) {
      return buildProblem({
        code: exception.code,
        instance,
        traceId,
        ...(exception.errors === undefined ? {} : { errors: exception.errors }),
      });
    }

    if (exception instanceof HttpException) {
      const raw = exception.getResponse();
      // Nest types `getResponse()` as `string | object`. An object response is a payload
      // with an unconstrained shape; a string response is wrapped so `developerDetail`
      // has one shape to read.
      const payload: NestPayload = typeof raw === 'string' ? { message: raw } : raw;

      const detail = developerDetail(payload);
      const fieldErrors = toFieldErrors(payload);

      return buildProblem({
        code: codeFromHttpException(exception),
        instance,
        traceId,
        ...(detail === undefined ? {} : { detail }),
        ...(fieldErrors.length === 0 ? {} : { errors: fieldErrors }),
      });
    }

    return buildProblem({ code: ERROR_CODES.INTERNAL_ERROR, instance, traceId });
  }
}
