/**
 * The push endpoint (Master Plan §40.5, M1b-S5; §38.10.1).
 *
 * `POST /api/v1/sync/push` is the only route this slice adds. It is guarded: the
 * §38.10.1 "Bearer access token (§38.16) plus the device identity assertion" is
 * enforced by `SyncAuthGuard`, and the handler receives only the trusted context
 * through `@SyncContext()` — never tenant identity from the body.
 *
 * The handler is thin by design. Validation, idempotency, ordering, and the
 * per-mutation outcome stream live in `SyncPushService`; the controller's job is
 * to declare the wire shape so the OpenAPI document (and every generated client
 * type) is produced from the same declaration the handler uses (§7.1, ADR-001).
 */

import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

import { PushBatchRequest, PushBatchResponse } from './push.contract';
import { SyncAuthGuard, SyncContext } from './sync-push.guard';
import { SyncPushService } from './sync-push.service';
import type { SyncTrustedContext } from './sync-auth';

/** RFC 7807 responses the filter can produce for this route, as a schema `$ref`. */
const PROBLEM_CONTENT = {
  'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDocument' } },
} as const;

@Controller('api/v1/sync')
export class SyncPushController {
  constructor(private readonly service: SyncPushService) {}

  @ApiOperation({
    summary: 'Push a batch of offline mutations',
    description:
      'Accepts 1–50 mutations, oldest device_local_sequence first, and answers one outcome per ' +
      'mutation (APPLIED, REPLAY, REJECTED, CONTRADICTION). A batch is not atomic: one permanently ' +
      'rejected mutation never blocks the others (Master Plan §38.10.1, §38.10.3). Tenant and device ' +
      'identity come from the authenticated credential, never the body (§38.16, §9.3).',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'One per-mutation outcome.', type: PushBatchResponse })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'The batch is malformed: wrong shape, more than 50 mutations, a duplicate mutation_id, or a ' +
      'device_local_sequence that is not strictly ascending (§38.10.2).',
    content: PROBLEM_CONTENT,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'No valid credential; until M2 lands the production authenticator refuses every push (§38.16).',
    content: PROBLEM_CONTENT,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'The body asserted a device or organization other than the authenticated one (§38.16, §9.3).',
    content: PROBLEM_CONTENT,
  })
  @ApiResponse({
    status: 426,
    description:
      'The client local_schema_version is below the supported minimum; the device must go read-only and ' +
      'upgrade (CLIENT_TOO_OLD, §38.7.2, F-15).',
    content: PROBLEM_CONTENT,
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'An unexpected server fault; the whole batch should be retried (§38.10.4).',
    content: PROBLEM_CONTENT,
  })
  @UseGuards(SyncAuthGuard)
  // §38.10.1: the batch is answered `200 OK` with one per-mutation outcome, never a
  // `201`: the request enqueues many outcomes, some APPLIED and some REJECTED, so a
  // single "Created" status would misdescribe a partial batch (§38.10.3).
  @HttpCode(HttpStatus.OK)
  @Post('push')
  async push(@Body() body: PushBatchRequest, @SyncContext() context: SyncTrustedContext): Promise<PushBatchResponse> {
    return this.service.pushBatch(body, context);
  }
}
