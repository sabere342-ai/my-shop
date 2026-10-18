/**
 * The pull endpoint (Master Plan §40.5, M1b-S6; §38.11.2).
 *
 * `GET /api/v1/sync/pull?after={server_sequence}&limit={n}` is the only route
 * this slice adds. It is guarded: the §38.11.2 "Bearer access token (§38.16)"
 * is enforced by `SyncAuthGuard`, and the handler receives only the trusted
 * context through `@SyncContext()` — the feed carries no tenant identity in the
 * query, and the guard is what establishes the scope.
 *
 * `GET` is the honest verb: the route reads a page and changes no server state
 * (§38.11.2 "the cursor advances only on success", and success is measured on the
 * device). The handler is thin by design; cursor arithmetic, the retention
 * boundary, and the feed live in `SyncPullService` and the M1b-S4 ledger. The
 * controller declares the wire shape so the OpenAPI document (and every
 * generated client type) is produced from the same declaration the handler uses
 * (§7.1, ADR-001).
 */

import { Controller, Get, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

import { PullPageResponse, PullQuery } from './pull.contract';
import { SyncAuthGuard, SyncContext } from './sync-pull.guard';
import { SyncPullService } from './sync-pull.service';
import type { SyncTrustedContext } from './sync-auth';

/** RFC 7807 responses the filter can produce for this route, as a schema `$ref`. */
const PROBLEM_CONTENT = {
  'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDocument' } },
} as const;

@Controller('api/v1/sync')
export class SyncPullController {
  constructor(private readonly service: SyncPullService) {}

  @ApiOperation({
    summary: 'Pull a page of changes since a cursor',
    description:
      'Returns changes with server_sequence strictly greater than `after`, ordered ascending and ' +
      'bounded by `limit` (default 200, maximum 1000). Paging is cursor-based, never offset. The ' +
      'client stores `nextAfter` only after the page is applied locally, so an interrupted pull ' +
      're-fetches rather than losing changes (Master Plan §38.11.2). A cursor older than the ' +
      'retention window is answered `rebaselineRequired` with an empty page (§38.11.1). Tenant scope ' +
      'comes from the authenticated credential, never the query (§38.16, §9.3).',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'One page of the change feed.', type: PullPageResponse })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'The cursor is malformed: `after` is not a non-negative decimal integer, `limit` is not an ' +
      'integer within 1–1000, or an unknown query parameter (such as an offset) was supplied (§38.11.2).',
    content: PROBLEM_CONTENT,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description:
      'No valid credential: an unbound session (no `did` device claim) or a revoked device is refused ' +
      '`UNAUTHENTICATED`/`DEVICE_REVOKED` at the device-bound sync boundary (§12.4, §38.16, §38.16.4).',
    content: PROBLEM_CONTENT,
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'An unexpected server fault; the client should retry the same cursor (§38.10.4).',
    content: PROBLEM_CONTENT,
  })
  @UseGuards(SyncAuthGuard)
  @Get('pull')
  async pull(@Query() query: PullQuery, @SyncContext() context: SyncTrustedContext): Promise<PullPageResponse> {
    return this.service.pullChanges(query, context);
  }
}
