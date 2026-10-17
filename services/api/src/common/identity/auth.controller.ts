/**
 * The authentication routes (Master Plan §40.6 M2-S2; §10.1, §10.3, §34.1).
 *
 * Four thin handlers under the versioned namespace. Every decision — throttling,
 * verification, rotation, revocation, staleness — lives in `AuthService`; the
 * controller's job is to declare the wire shape so the OpenAPI document and every
 * generated client type come from the same declaration the handler uses
 * (§7.1, ADR-001).
 *
 * Only `GET /me` is guarded. `login`, `refresh`, and `logout` are the paths that
 * *establish* or *end* a credential, so they authenticate by the credential in
 * their own body rather than by a bearer token; guarding them would make them
 * unusable by the client that has no valid access token yet.
 *
 * No handler reads an organization id from the request. Tenant scope is carried by
 * the signed access token and read back through `@VerifiedPrincipal()` (§9.3).
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  AUTH_LOGIN_PATH,
  AUTH_LOGOUT_PATH,
  AUTH_ME_PATH,
  AUTH_REFRESH_PATH,
  LoginRequest,
  LogoutRequest,
  MeResponse,
  RefreshRequest,
  TokenResponse,
} from './auth.contract';
import { AuthService, type AuthenticatedPrincipal } from './auth.service';
import { JwtAuthGuard, VerifiedPrincipal } from './jwt-auth.guard';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange an email and password for an access and refresh token pair.',
    description:
      'Refuses `UNAUTHENTICATED` for an unknown account, a missing credential, or a wrong password, and ' +
      '`RATE_LIMITED` while a failed-attempt backoff is active. No response distinguishes the refusal causes.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: TokenResponse, description: 'A fresh token pair.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'RATE_LIMITED.' })
  async login(@Body() body: LoginRequest, @Req() request: Request): Promise<TokenResponse> {
    return this.auth.login({
      email: body.email,
      password: body.password,
      ...(request.ip === undefined ? {} : { clientAddress: request.ip }),
    });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token into a fresh token pair.',
    description:
      'Consumes the presented refresh token and issues a successor. Presenting a token that was already ' +
      'rotated is treated as reuse: the entire session family is revoked and the request is refused ' +
      '`UNAUTHENTICATED` (§10.3). An expired token is refused `TOKEN_EXPIRED`.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: TokenResponse, description: 'A rotated token pair.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED (unknown, revoked, or reused).' })
  @ApiResponse({ status: HttpStatus.GONE, description: 'TOKEN_EXPIRED.' })
  async refresh(@Body() body: RefreshRequest): Promise<TokenResponse> {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke the session family a refresh token belongs to.',
    description:
      'Revokes the whole family, so every access token minted under it is refused immediately. An unknown ' +
      'token is not an error: the response is `204` either way, so logout is never a token-validity oracle.',
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'The family is revoked (or was already unusable).' })
  async logout(@Body() body: LogoutRequest): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'The verified identity behind the bearer access token.',
    description:
      'Requires `Authorization: Bearer <accessToken>`. Organizations are read from the signed token, which ' +
      'was populated from server state at mint time. Refuses `TOKEN_STALE` when permissions changed since ' +
      'the token was minted, and `TOKEN_EXPIRED` past its expiry.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: MeResponse, description: 'The verified identity.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  me(@VerifiedPrincipal() principal: AuthenticatedPrincipal): MeResponse {
    return {
      userId: principal.userId,
      email: principal.email,
      organizations: [...principal.organizations],
      sessionId: principal.sessionId,
      permissionsVersion: principal.permissionsVersion,
      expiresAt: principal.expiresAt.toISOString(),
    };
  }
}

/** Path constants, re-exported so a routing test can assert them without importing the file. */
export { AUTH_LOGIN_PATH, AUTH_LOGOUT_PATH, AUTH_ME_PATH, AUTH_REFRESH_PATH };
