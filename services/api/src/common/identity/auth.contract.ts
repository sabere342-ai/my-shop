/**
 * The authentication wire contract (Master Plan §40.6 M2-S2; §10.3, §34.1).
 *
 * Four routes under the versioned `/api/v1` namespace:
 *
 * - `POST /api/v1/auth/login`   — exchange an email and password for a token pair.
 * - `POST /api/v1/auth/refresh` — exchange a refresh token for a fresh pair.
 * - `POST /api/v1/auth/logout`  — revoke the session family a refresh token belongs to.
 * - `GET  /api/v1/auth/me`      — the verified identity behind a bearer access token.
 *
 * Every request carries only what it must. In particular **no request carries an
 * organization id**: tenant scope is read from the verified access token
 * (§9.3, §38.16), never from the body, so a client cannot name a tenant into
 * existence. The response classes are the shapes the handlers return, so the
 * generated OpenAPI document and the runtime response cannot drift (§7.1, ADR-001).
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_EMAIL_LENGTH } from './user-provisioning';

/**
 * The longest password this endpoint will even look at.
 *
 * A login cost is dominated by one Argon2id evaluation, but accepting an unbounded
 * body would let a caller spend server CPU hashing megabytes. This is a transport
 * ceiling, deliberately far above the §10.2 setting policy, so it never rejects a
 * legitimate stored password — it only refuses an abusive request.
 */
export const MAX_LOGIN_PASSWORD_LENGTH = 1024;

/** A refresh token is 43 base64url characters; the bound allows for a future length. */
const MAX_REFRESH_TOKEN_LENGTH = 512;

/** `POST /api/v1/auth/login` request (§10.1: email and password). */
export class LoginRequest {
  @ApiProperty({
    description: 'The account mailbox address. Canonicalized (trimmed, lowercased) before lookup.',
    example: 'owner@example.com',
    maxLength: MAX_EMAIL_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_EMAIL_LENGTH)
  readonly email!: string;

  @ApiProperty({
    description: 'The account password.',
    example: 'a long passphrase, never a placeholder',
    minLength: 1,
    maxLength: MAX_LOGIN_PASSWORD_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_LOGIN_PASSWORD_LENGTH)
  readonly password!: string;
}

/** `POST /api/v1/auth/refresh` request (§10.3 refresh rotation). */
export class RefreshRequest {
  @ApiProperty({
    description:
      'The opaque refresh token from the most recent login or refresh. Presenting a token that was ' +
      'already rotated is treated as reuse and revokes the whole session family (§10.3).',
    maxLength: MAX_REFRESH_TOKEN_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REFRESH_TOKEN_LENGTH)
  readonly refreshToken!: string;
}

/** `POST /api/v1/auth/logout` request (§10.3 revocation). */
export class LogoutRequest {
  @ApiProperty({
    description: 'The refresh token whose session family should be revoked. An unknown token is not an error.',
    maxLength: MAX_REFRESH_TOKEN_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REFRESH_TOKEN_LENGTH)
  readonly refreshToken!: string;
}

/** The token pair returned by login and by refresh. */
export class TokenResponse {
  @ApiProperty({ description: 'The short-lived RS256 bearer access token (§10.3).' })
  readonly accessToken!: string;

  @ApiProperty({ enum: ['Bearer'], description: 'The scheme to send the access token with.' })
  readonly tokenType!: 'Bearer';

  @ApiProperty({ type: 'integer', description: 'The access token lifetime in seconds.' })
  readonly expiresIn!: number;

  @ApiProperty({ description: 'The opaque refresh token to present at `/api/v1/auth/refresh`.' })
  readonly refreshToken!: string;

  @ApiProperty({ type: 'integer', description: 'The refresh token idle lifetime in seconds.' })
  readonly refreshExpiresIn!: number;
}

/** `GET /api/v1/auth/me` response: the verified identity behind an access token. */
export class MeResponse {
  @ApiProperty({ format: 'uuid', description: 'The authenticated user id (the token `sub`).' })
  readonly userId!: string;

  @ApiProperty({ description: 'The user’s canonical mailbox address.' })
  readonly email!: string;

  @ApiProperty({
    format: 'uuid',
    isArray: true,
    description: 'The organizations the user is a member of, read from server state, never the request.',
  })
  readonly organizations!: string[];

  @ApiProperty({ format: 'uuid', description: 'The session (refresh-token family) this token belongs to.' })
  readonly sessionId!: string;

  @ApiProperty({
    type: 'integer',
    description: 'The permission generation this token was minted against (§10.3 `perms_version`).',
  })
  readonly permissionsVersion!: number;

  @ApiProperty({ format: 'date-time', description: 'When the access token expires.' })
  readonly expiresAt!: string;
}

/** Tokens await the code paths; these keep the paths in one place for the ACL declaration. */
export const AUTH_LOGIN_PATH = 'api/v1/auth/login';
export const AUTH_REFRESH_PATH = 'api/v1/auth/refresh';
export const AUTH_LOGOUT_PATH = 'api/v1/auth/logout';
export const AUTH_ME_PATH = 'api/v1/auth/me';
