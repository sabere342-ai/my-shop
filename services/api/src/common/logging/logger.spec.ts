import { LOGGABLE_KEYS, SENSITIVE_HEADERS, logPayload, redactHeaders, redactQuery } from './logger';

describe('redactHeaders', () => {
  it('replaces a credential header value while keeping its name', () => {
    // "This request carried an Authorization header" is useful operational signal; its
    // value never is (§13.1).
    const safe = redactHeaders({ authorization: 'Bearer abc.def.ghi', 'content-type': 'application/json' });

    expect(safe['authorization']).toBe('[REDACTED]');
    expect(safe['content-type']).toBe('application/json');
  });

  it('redacts every header that can carry a credential', () => {
    for (const header of SENSITIVE_HEADERS) {
      const safe = redactHeaders({ [header]: 'super-secret-value' });
      expect(safe[header]).toBe('[REDACTED]');
    }
  });

  it('matches header names case-insensitively', () => {
    expect(redactHeaders({ Authorization: 'Bearer x' })['Authorization']).toBe('[REDACTED]');
    expect(redactHeaders({ COOKIE: 'session=x' })['COOKIE']).toBe('[REDACTED]');
  });

  it('describes a non-string value by type rather than by value', () => {
    const safe = redactHeaders({ 'content-length': 42, 'x-flag': true });
    expect(safe['content-length']).toBe('[number]');
    expect(safe['x-flag']).toBe('[boolean]');
  });
});

describe('redactQuery', () => {
  it('emits only allow-listed keys', () => {
    // A client that puts a token in a query parameter produces a URL that a proxy log
    // and a browser history both record.
    const safe = redactQuery({ page: '2', token: 'secret', access_token: 'secret' }, ['page']);

    expect(safe).toEqual({ page: '2' });
    expect(JSON.stringify(safe)).not.toContain('secret');
  });

  it('emits nothing when the allow-list is empty', () => {
    expect(redactQuery({ anything: 'value' }, [])).toEqual({});
  });

  it('serialises a non-string allow-listed value', () => {
    expect(redactQuery({ ids: [1, 2] }, ['ids'])).toEqual({ ids: '[1,2]' });
  });

  it('does not include an allow-listed key that is absent', () => {
    expect(redactQuery({ page: '1' }, ['page', 'cursor'])).toEqual({ page: '1' });
  });

  it('ignores an inherited property of the same name', () => {
    // A prototype-polluted query object must not be able to inject a key.
    const polluted = Object.create({ page: 'from-prototype' }) as Record<string, unknown>;
    polluted['cursor'] = 'real';

    expect(redactQuery(polluted, ['page'])).toEqual({});
  });
});

describe('logPayload', () => {
  it('emits only allow-listed keys', () => {
    const payload = logPayload({
      method: 'POST',
      path: '/api/v1/sales',
      statusCode: 201,
      password: 'hunter2',
      token: 'abc',
      secret: 'shh',
    });

    expect(payload).toEqual({ method: 'POST', path: '/api/v1/sales', statusCode: 201 });
    expect(JSON.stringify(payload)).not.toContain('hunter2');
  });

  it('drops a key whose value is undefined', () => {
    expect(logPayload({ method: 'GET', path: undefined })).toEqual({ method: 'GET' });
  });

  it('does not emit an inherited property', () => {
    const polluted = Object.create({ method: 'from-prototype' }) as Record<string, unknown>;
    expect(logPayload(polluted)).toEqual({});
  });

  it('emits every correlation id §38.28.3 requires', () => {
    const payload = logPayload({
      traceId: 't',
      mutationId: 'm',
      deviceId: 'd',
      syncBatchId: 'b',
      organizationId: 'o',
      userId: 'u',
    });

    expect(Object.keys(payload).sort()).toEqual([
      'deviceId',
      'mutationId',
      'organizationId',
      'syncBatchId',
      'traceId',
      'userId',
    ]);
  });

  it('does not allow-list any credential-shaped key', () => {
    // The guard that makes "redacted by construction" checkable rather than aspirational.
    const forbidden = ['password', 'token', 'secret', 'apiKey', 'authorization', 'cookie', 'accessToken'];
    for (const key of forbidden) {
      expect(LOGGABLE_KEYS).not.toContain(key);
    }
  });
});
