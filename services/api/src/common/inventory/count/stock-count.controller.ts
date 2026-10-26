/**
 * The stock-count routes (Master Plan §15.8, §30.5, O-14; §34.1). Thin
 * handlers over `StockCountService`, mounted beside the inventory routes.
 *
 * Every count route declares `inventory.count` — the count-document authority
 * the M2-S3 catalog already carries. The posting's cost escalation is
 * **not** a route decision: the acceptance moment is the posting, so the
 * service re-resolves `catalog.cost.edit` from the caller's current effective
 * set *inside the posting transaction* (the same §11 resolver; §11.4) only when
 * a line actually offers a cost — the route cannot know the variance before
 * the ledger does. Recording a cost offer requires nothing; posting one
 * requires the authority, and no caller without `inventory.count` reaches any
 * of it.
 *
 * Canonicalization happens before any connection: an invalid offer never costs
 * the database a round trip, and the answer shapes are the same declarations
 * the OpenAPI document is generated from (§7.1, ADR-001).
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

import { DomainError } from '../../errors/domain.error';
import { ERROR_CODES } from '../../errors/problem';
import { Authorize, OrganizationId } from '../../authorization/authorization.guard';
import { VerifiedPrincipal } from '../../identity/jwt-auth.guard';
import type { AuthenticatedPrincipal } from '../../identity/auth.service';
import { StockCountService } from './stock-count.service';
import { canonicalizeCreateCount, canonicalizeRecordCountLine, CanonicalizationError } from './stock-count.domain';
import {
  COUNT_PATH,
  CreateStockCountRequest,
  CreateStockCountResponse,
  ListStockCountsQuery,
  PostStockCountResponse,
  RecordCountLineRequest,
  RecordCountLineResponse,
  StockCountListResponse,
} from './stock-count-view.contract';

/**
 * The stock-count surface: six lifecycle routes over one document family,
 * every route organization-scoped and `inventory.count`-gated.
 */
@Controller(COUNT_PATH)
export class StockCountController {
  constructor(private readonly counts: StockCountService) {}

  /** Canonicalizes a wire offer or refuses it as a `400 VALIDATION_FAILED`. */
  private canonicalizeOrRefuse<Canonical>(canonicalize: () => Canonical): Canonical {
    try {
      return canonicalize();
    } catch (error) {
      if (error instanceof CanonicalizationError) {
        throw new DomainError(
          ERROR_CODES.VALIDATION_FAILED,
          `the count offer was refused before any connection: ${error.message}`,
          [{ field: error.field, messages: [error.message] }],
        );
      }
      throw error;
    }
  }

  @Post()
  @Authorize('inventory.count')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Open a stock count document.',
    description:
      'Requires `inventory.count`. Answers the empty OPEN document whose observations the operator ' +
      'records next. The event INVENTORY_STOCK_COUNT_RECORDED marks the document’s birth; its lines ' +
      'post nothing until posting (§15.8). The lifecycle is trigger-guarded on the database: OPEN → ' +
      'POSTED or OPEN → CANCELLED, and closed history is immutable.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: CreateStockCountResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'NOT_FOUND — no such location in this organization.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'VALIDATION_FAILED — an invalid value.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async createCount(
    @Body() body: CreateStockCountRequest,
    @OrganizationId() organizationId: string,
    @VerifiedPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<CreateStockCountResponse> {
    const offered = this.canonicalizeOrRefuse(() =>
      canonicalizeCreateCount({
        locationId: body.locationId ?? null,
        note: body.note ?? null,
      }),
    );
    const count = await this.counts.createCount(organizationId, principal.userId, offered, new Date());
    return { count };
  }

  @Get()
  @Authorize('inventory.count')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The organization’s stock count documents.',
    description:
      'Requires `inventory.count`. Answers the documents with their recorded observations, newest ' +
      'first, by the idempotency identity facts (observed quantity, snapshot, reason pair, and the ' +
      'movement a posting attached). `locationId` and `status` narrow the page.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: StockCountListResponse })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async listCounts(
    @OrganizationId() organizationId: string,
    @Query() query: ListStockCountsQuery,
  ): Promise<StockCountListResponse> {
    const counts = await this.counts.listCounts(organizationId, query);
    return { counts: [...counts] };
  }

  @Get(':countId')
  @Authorize('inventory.count')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'One stock count document.',
    description:
      'Requires `inventory.count`. Answers the document with its observations; a count of ' +
      'another tenant is the same honest 404 as an unknown one.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: CreateStockCountResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'NOT_FOUND — no such count in this organization.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async getCount(
    @Param('countId') countId: string,
    @OrganizationId() organizationId: string,
  ): Promise<CreateStockCountResponse> {
    return { count: await this.counts.getCount(organizationId, countId) };
  }

  @Post(':countId/lines')
  @Authorize('inventory.count')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record (or revise) one physical observation.',
    description:
      'Requires `inventory.count`. The counted quantity is the observation — zero is a real ' +
      'observation (the shelf is empty; an omitted variant has no line, never a zero). A repeated ' +
      'scan of a variant EDITS the same line (§15.8); the answer carries the new expected-quantity ' +
      'snapshot and record facts. Refused against a closed count (STOCK_COUNT_CLOSED).',
  })
  @ApiResponse({ status: HttpStatus.OK, type: RecordCountLineResponse })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'NOT_FOUND — no such count or live variant in this organization.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'STOCK_COUNT_CLOSED — the count is posted or cancelled history.',
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'VALIDATION_FAILED — an invalid value.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async recordCountLine(
    @Param('countId') countId: string,
    @Body() body: RecordCountLineRequest,
    @OrganizationId() organizationId: string,
    @VerifiedPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<RecordCountLineResponse> {
    const offered = this.canonicalizeOrRefuse(() =>
      canonicalizeRecordCountLine({
        variantId: body.variantId,
        countedQuantity: body.countedQuantity,
        reasonCode: body.reasonCode ?? null,
        unitCostMinor: body.unitCostMinor ?? null,
      }),
    );
    const count = await this.counts.recordCountLine(organizationId, principal.userId, countId, offered, {}, new Date());
    return { count };
  }

  @Post(':countId/post')
  @Authorize('inventory.count')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Post the count’s variance to the movement ledger.',
    description:
      'Requires `inventory.count`. For every recorded line, the variance `counted − the locked ' +
      'authoritative quantity` posts as one STOCK_COUNT_ADJUSTMENT movement through the one movement ' +
      'engine (§15.4), the movement attaches to its line, and the document closes POSTED — all in one ' +
      'transaction with the audit events. A differing line without a reason code refuses ' +
      '(STOCK_COUNT_REASON_REQUIRED, O-14); a line offering a cost demands the cost authority ' +
      '(catalog.cost.edit, resolved inside the posting transaction); a variance increasing ' +
      'basis-less stock without a cost offer refuses (INVENTORY_COST_BASIS_REQUIRED). An already-' +
      'POSTED count answers REPLAY with the stored document — no second effect; a CANCELLED count ' +
      'refuses (STOCK_COUNT_CLOSED).',
  })
  @ApiResponse({ status: HttpStatus.OK, type: PostStockCountResponse })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'STOCK_COUNT_CLOSED, STOCK_COUNT_REASON_REQUIRED, INVENTORY_COST_BASIS_REQUIRED, or ' +
      'INSUFFICIENT_STOCK (the fold’s last-line refusals — never a silent correction).',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'NOT_FOUND — no such count in this organization.' })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'PERMISSION_DENIED — the caller without inventory.count (or the cost escalation).',
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async postCount(
    @Param('countId') countId: string,
    @OrganizationId() organizationId: string,
    @VerifiedPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<PostStockCountResponse> {
    return this.counts.postCount(organizationId, principal.userId, countId, new Date());
  }

  @Post(':countId/cancel')
  @Authorize('inventory.count')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an open count without posting anything.',
    description:
      'Requires `inventory.count`. The document closes CANCELLED with its attribution facts and one ' +
      'audit event; its observations rest unposted. A POSTED count is closed history and refuses ' +
      '(STOCK_COUNT_CLOSED); an already-cancelled count answers REPLAY (no second effect).',
  })
  @ApiResponse({ status: HttpStatus.OK, type: PostStockCountResponse })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'STOCK_COUNT_CLOSED — the count is already posted.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'NOT_FOUND — no such count in this organization.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async cancelCount(
    @Param('countId') countId: string,
    @OrganizationId() organizationId: string,
    @VerifiedPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<PostStockCountResponse> {
    return this.counts.cancelCount(organizationId, principal.userId, countId, new Date());
  }
}

/** Path constant, re-exported so a routing test can assert it without importing the file. */
export { COUNT_PATH };
