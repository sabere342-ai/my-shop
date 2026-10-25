/**
 * The inventory routes (Master Plan §15.4, §15.5, §15.6, §15.6A, §38.14.1;
 * §40.8 row M4-S2; §34.1).
 *
 * Thin handlers. Every rule — the closed cause and reason vocabularies, the
 * exact signed base-unit quantity, the §15.6 conditional guard, the §38.14.1
 * movement identity and its replay semantics, the deterministic reads — is
 * decided by `InventoryService` and restated by migration 0014's CHECKs; the
 * controller declares the wire shape so the OpenAPI document and every
 * generated client type come from the same declaration the handler uses
 * (§7.1, ADR-001).
 *
 * Guard order matters (§9.3): `@Authorize` first runs the bearer guard, then
 * the organization check against the membership claim. Reads declare
 * `inventory.view`; the movement write declares `inventory.adjust` — the §17
 * server-side enforcement, resolved by the same effective-permission rule
 * every read path uses. A caller with `catalog.view` alone, or an
 * authenticated caller with no inventory permission at all, reaches nothing
 * here. `inventory.receive` is deliberately absent from this slice's routes
 * (§38.22 Tier 3: purchase receipts arrive with M6's documents) and so is
 * `inventory.count` (M4-S4); both permissions already exist in the M2-S3
 * catalog and are wired by their owning slices.
 *
 * No handler reads an organization id or a caller identity from a request
 * body: the tenant comes from the matched route parameter, the actor from the
 * verified principal.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

import { Authorize, OrganizationId } from '../authorization/authorization.guard';
import { VerifiedPrincipal } from '../identity/jwt-auth.guard';
import type { AuthenticatedPrincipal } from '../identity/auth.service';
import { InventoryService } from './inventory.service';
import {
  INVENTORY_PATH,
  LevelListResponse,
  LevelResponse,
  ListLevelsQuery,
  ListMovementsQuery,
  LocationListResponse,
  MovementListResponse,
  MovementResponse,
  MovementSubmissionResponse,
  SubmitMovementRequest,
} from './inventory-view.contract';

/**
 * The inventory surface. Every route is organization-scoped; the reads answer
 * the derived truth, the single write rides the authoritative ledger.
 */
@Controller(INVENTORY_PATH)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('locations')
  @Authorize('inventory.view')
  @ApiOperation({
    summary: 'The organization’s V1 locations.',
    description:
      'Requires `inventory.view`. Answers the locations stock can sit in; the V1 default location is ' +
      'seeded deterministically on first touch (§15.4, “V1 seeds one default location”) and is exactly ' +
      'one per organization by a partial unique index.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: LocationListResponse })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async listLocations(@OrganizationId() organizationId: string): Promise<LocationListResponse> {
    const locations = await this.inventory.listLocations(organizationId);
    return { locations: [...locations] };
  }

  @Get('levels')
  @Authorize('inventory.view')
  @ApiOperation({
    summary: 'The derived stock levels.',
    description:
      'Requires `inventory.view`. Answers the §15.4 derived, cacheable quantity per (variant, location) ' +
      'joined with the variant SKU and the product name it moves; `variantId` and `locationId` narrow ' +
      'the page. A variant with no recorded movement has no level row — no stock has ever been claimed.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: LevelListResponse })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async listLevels(
    @OrganizationId() organizationId: string,
    @Query() query: ListLevelsQuery,
  ): Promise<LevelListResponse> {
    const levels = await this.inventory.listLevels(organizationId, query);
    return { levels: [...levels] };
  }

  @Get('movements')
  @Authorize('inventory.view')
  @ApiOperation({
    summary: 'The authoritative movement history.',
    description:
      'Requires `inventory.view`. Answers the §15.4 append-only quantity history, newest acceptance ' +
      'first by the per-organization `server_sequence`, with every §38.14.1 identity fact. A no-op ' +
      'read never writes anything.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: MovementListResponse })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async listMovements(
    @OrganizationId() organizationId: string,
    @Query() query: ListMovementsQuery,
  ): Promise<MovementListResponse> {
    const movements = await this.inventory.listMovements(organizationId, query);
    return { movements: [...movements] };
  }

  @Post('movements')
  @Authorize('inventory.adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record one stock movement behind the conditional guard.',
    description:
      'Requires `inventory.adjust`. The caller-generated `movementId` is the §38.14.1 identity and the ' +
      'whole operation’s idempotency key: an identical retry answers the stored movement with status ' +
      'REPLAY (§38.9.1), the same identity naming a different fact answers 409 MUTATION_CONTRADICTION ' +
      '(§38.9.2), and a quantity the §15.6 conditional guard cannot cover answers 409 ' +
      'INSUFFICIENT_STOCK with the balance untouched and no movement recorded. First acceptance ' +
      'answers status APPLIED; the movement, the derived level, and the audit event commit or roll ' +
      'back together (§32.5 class A).',
  })
  @ApiResponse({ status: HttpStatus.OK, type: MovementSubmissionResponse })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'MUTATION_CONTRADICTION, INSUFFICIENT_STOCK, or INVENTORY_OPENING_BALANCE_DUPLICATE.',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'NOT_FOUND — no such variant or location here.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'VALIDATION_FAILED — an invalid value.' })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'PERMISSION_DENIED — a caller without inventory.adjust.',
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async submitMovement(
    @Body() body: SubmitMovementRequest,
    @OrganizationId() organizationId: string,
    @VerifiedPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<MovementSubmissionResponse> {
    return this.inventory.submitMovement(
      {
        organizationId,
        actorUserId: principal.userId,
        offered: {
          movementId: body.movementId,
          cause: body.cause,
          variantId: body.variantId,
          ...(body.locationId === undefined ? {} : { locationId: body.locationId }),
          quantityDelta: body.quantityDelta,
          ...(body.reasonCode === undefined ? {} : { reasonCode: body.reasonCode }),
          ...(body.reasonNote === undefined ? {} : { reasonNote: body.reasonNote }),
          ...(body.documentRef === undefined ? {} : { documentRef: body.documentRef }),
        },
      },
      new Date(),
    );
  }
}

/** The level projection exported for the type check the controller's own read uses. */
export type LevelWire = LevelResponse;
export type MovementWire = MovementResponse;

/** Path constant, re-exported so a routing test can assert it without importing the file. */
export { INVENTORY_PATH };
