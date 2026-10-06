import { HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import { pino } from 'pino';
import { DomainError } from './domain.error';
import { ProblemDetailsFilter } from './problem.filter';
import { ERROR_CODES } from './problem';
import { TRACE_HEADER } from '../logging/trace-id';

interface CapturedResponse {
  statusCode?: number;
  contentType?: string;
  headers: Record<string, string>;
  body?: unknown;
}

/** Builds a minimal ArgumentsHost over a captured response, without a real HTTP server. */
function hostFor(
  path: string,
  headers: Record<string, string> = {},
): {
  host: ArgumentsHost;
  captured: CapturedResponse;
} {
  const captured: CapturedResponse = { headers: {} };

  const request = {
    originalUrl: path,
    url: path,
    method: 'POST',
    headers,
    ip: '127.0.0.1',
  } as unknown as Request;

  const response = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    type(value: string) {
      captured.contentType = value;
      return this;
    },
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
  } as unknown as ArgumentsHost;

  return { host, captured };
}

function filter(): ProblemDetailsFilter {
  // Level `silent` so the filter's own logging does not pollute test output; the
  // assertions are about the response body, not about log output.
  return new ProblemDetailsFilter({ logger: pino({ level: 'silent' }) });
}

describe('ProblemDetailsFilter', () => {
  it('answers a domain error with the code-derived problem document', () => {
    const { host, captured } = hostFor('/api/v1/sales');
    filter().catch(new DomainError(ERROR_CODES.INSUFFICIENT_STOCK), host);

    expect(captured.statusCode).toBe(409);
    expect(captured.contentType).toBe('application/problem+json');
    expect(captured.body).toMatchObject({
      type: 'https://docs.my-shop/errors/INSUFFICIENT_STOCK',
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      instance: '/api/v1/sales',
    });
  });

  it('never places the server-only diagnostic in the response body', () => {
    // The single most important assertion in the file: §13.1 forbids stack traces, SQL,
    // and internal identifiers in a response.
    const { host, captured } = hostFor('/api/v1/sales');
    const secretish = 'variant 8f3a on hand 2 SELECT * FROM stock_levels';

    filter().catch(new DomainError(ERROR_CODES.INSUFFICIENT_STOCK, secretish), host);

    const serialized = JSON.stringify(captured.body);
    expect(serialized).not.toContain('8f3a');
    expect(serialized).not.toContain('SELECT');
    expect(serialized).not.toContain('stock_levels');
  });

  it('answers an unrecognised error with a generic 500 and no message leakage', () => {
    const { host, captured } = hostFor('/api/v1/sales');
    const leaky = new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');

    filter().catch(leaky, host);

    expect(captured.statusCode).toBe(500);
    const serialized = JSON.stringify(captured.body);
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(serialized).not.toContain('10.0.0.5');
    expect(serialized).not.toContain('hunter2');
    expect(captured.body).toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('answers an unrecognised non-Error throwable with the same generic body', () => {
    const { host, captured } = hostFor('/api/v1/sales');

    filter().catch({ secret: 'do not serialise me' }, host);

    expect(captured.statusCode).toBe(500);
    expect(JSON.stringify(captured.body)).not.toContain('do not serialise me');
  });

  it('maps a Nest BadRequest onto VALIDATION_FAILED', () => {
    const { host, captured } = hostFor('/api/v1/sales');
    filter().catch(new HttpException('bad input', HttpStatus.BAD_REQUEST), host);

    expect(captured.statusCode).toBe(400);
    expect(captured.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('maps a Nest Unauthorized onto UNAUTHENTICATED', () => {
    const { host, captured } = hostFor('/api/v1/sales');
    filter().catch(new HttpException('nope', HttpStatus.UNAUTHORIZED), host);

    expect(captured.statusCode).toBe(401);
    expect(captured.body).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('maps a Nest Forbidden onto PERMISSION_DENIED', () => {
    const { host, captured } = hostFor('/api/v1/sales');
    filter().catch(new HttpException('nope', HttpStatus.FORBIDDEN), host);

    expect(captured.statusCode).toBe(403);
    expect(captured.body).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('maps a Nest NotFound onto NOT_FOUND', () => {
    const { host, captured } = hostFor('/api/v1/sales');
    filter().catch(new HttpException('nope', HttpStatus.NOT_FOUND), host);

    expect(captured.statusCode).toBe(404);
    expect(captured.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('extracts only the field and constraint messages from a validation payload', () => {
    // §13.1: the rest of a validator's error object is internal context.
    const { host, captured } = hostFor('/api/v1/sales');
    const exception = new HttpException(
      {
        message: [{ field: 'quantity', messages: ['must be a positive integer'], target: 'SaleLineDto', children: [] }],
        error: 'Bad Request',
        statusCode: 400,
      },
      HttpStatus.BAD_REQUEST,
    );

    filter().catch(exception, host);

    expect(captured.body).toMatchObject({
      errors: [{ field: 'quantity', messages: ['must be a positive integer'] }],
    });
    expect(JSON.stringify(captured.body)).not.toContain('SaleLineDto');
  });

  it('echoes an acceptable inbound trace id', () => {
    // §38.28.3: trace_id propagates through the offline path, so a request that arrives
    // with one keeps it end to end.
    const { host, captured } = hostFor('/api/v1/sales', { [TRACE_HEADER]: 'trace-from-device' });

    filter().catch(new DomainError(ERROR_CODES.REPLAY), host);

    expect(captured.body).toMatchObject({ traceId: 'trace-from-device' });
    expect(captured.headers[TRACE_HEADER]).toBe('trace-from-device');
  });

  it('replaces an unacceptable inbound trace id rather than rejecting the request', () => {
    // A logging header must not become a way to fail requests. An unsafe value is a
    // reflected-input vector if echoed.
    const { host, captured } = hostFor('/api/v1/sales', {
      [TRACE_HEADER]: 'bad value with spaces and "quotes"',
    });

    filter().catch(new DomainError(ERROR_CODES.REPLAY), host);

    const body = captured.body as { traceId: string };
    expect(body.traceId).not.toContain('bad value');
    expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('generates a trace id when none is supplied', () => {
    const { host, captured } = hostFor('/api/v1/sales');
    filter().catch(new DomainError(ERROR_CODES.REPLAY), host);

    expect((captured.body as { traceId: string }).traceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('always sets the trace response header', () => {
    const { host, captured } = hostFor('/api/v1/sales');
    filter().catch(new DomainError(ERROR_CODES.REPLAY), host);

    expect(captured.headers[TRACE_HEADER]).toBeDefined();
  });
});
