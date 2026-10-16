/**
 * Unit acceptance for the authentication wire contract (§10.1, §34.1, AC-01, AC-02).
 *
 * §10.1/§10.3 fix the request shapes, and the validation pipe enforces them on every
 * request. This suite asserts the same constraints on the DTOs directly, so a
 * decorator removed by accident fails here (fast) rather than only in the HTTP
 * suites — and it pins the path constants, which are the routing surface the ACL and
 * the generated client both key on.
 */

import { validate } from 'class-validator';

import {
  AUTH_LOGIN_PATH,
  AUTH_LOGOUT_PATH,
  AUTH_ME_PATH,
  AUTH_REFRESH_PATH,
  LoginRequest,
  LogoutRequest,
  MAX_LOGIN_PASSWORD_LENGTH,
  RefreshRequest,
} from './auth.contract';

function build<T extends object>(cls: new () => T, values: Record<string, unknown>): T {
  return Object.assign(new cls(), values);
}

/** A policy-passing value; the DTO does not enforce the §10.2 policy, only shape. */
const PASSPHRASE = 'a long passphrase';

describe('authentication paths', () => {
  it('are the versioned §34.1 surface', () => {
    expect([AUTH_LOGIN_PATH, AUTH_REFRESH_PATH, AUTH_LOGOUT_PATH, AUTH_ME_PATH]).toEqual([
      'api/v1/auth/login',
      'api/v1/auth/refresh',
      'api/v1/auth/logout',
      'api/v1/auth/me',
    ]);
  });
});

describe('LoginRequest', () => {
  it('accepts an email and a password', async () => {
    const request = build(LoginRequest, { email: 'owner@example.com', password: PASSPHRASE });
    await expect(validate(request)).resolves.toEqual([]);
  });

  it('refuses a missing or empty field', async () => {
    expect(await validate(build(LoginRequest, { password: PASSPHRASE }))).not.toEqual([]);
    expect(await validate(build(LoginRequest, { email: '', password: PASSPHRASE }))).not.toEqual([]);
    expect(await validate(build(LoginRequest, { email: 'owner@example.com', password: '' }))).not.toEqual([]);
  });

  it('refuses a non-string field', async () => {
    expect(await validate(build(LoginRequest, { email: 5, password: PASSPHRASE }))).not.toEqual([]);
    expect(await validate(build(LoginRequest, { email: 'owner@example.com', password: { nested: true } }))).not.toEqual(
      [],
    );
  });

  it('refuses an abusive password length before it ever reaches Argon2id', async () => {
    const request = build(LoginRequest, {
      email: 'owner@example.com',
      password: 'a'.repeat(MAX_LOGIN_PASSWORD_LENGTH + 1),
    });
    expect(await validate(request)).not.toEqual([]);
  });
});

describe('RefreshRequest and LogoutRequest', () => {
  it('accept both a bounded opaque token and nothing else', async () => {
    await expect(validate(build(RefreshRequest, { refreshToken: 'a'.repeat(43) }))).resolves.toEqual([]);
    await expect(validate(build(LogoutRequest, { refreshToken: 'a'.repeat(43) }))).resolves.toEqual([]);
  });

  it('refuse a missing, empty, non-string, or over-long token', async () => {
    expect(await validate(build(RefreshRequest, {}))).not.toEqual([]);
    expect(await validate(build(RefreshRequest, { refreshToken: '' }))).not.toEqual([]);
    expect(await validate(build(RefreshRequest, { refreshToken: 42 }))).not.toEqual([]);
    expect(await validate(build(RefreshRequest, { refreshToken: 'a'.repeat(513) }))).not.toEqual([]);
  });
});
