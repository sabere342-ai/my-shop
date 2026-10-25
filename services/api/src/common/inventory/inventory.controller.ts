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
 * the organization check against the token's membership claim. Reads declare
 * `inventory.view`; the movement write declares `inventory.adjust` — the §17
 * *server-side enforcement, resolved by the same effective-permission rule
 * every read path uses. Costing authority (`catalog.cost.edit`, §38.5's "when a
 * cost is involved") is the write's escalation: a cost-imposing cause resolves
 * it from the caller's effective set before the ledger is touched, and the
 * `PURCHASE_RECEIPT` cause also demands `inventory.receive` (§11.2's
 * stock-receiving authority; M6-S2's purchase documents remain the owning slice
 * above this movement path). `inventory.count` stays M4-S4's; neither
 * permission is invented here — both exist in the M2-S3 catalog and are wired
 * by their owning slices.
 *
 * No handler reads an organization id or a caller identity from a request
 * body: the tenant comes from the matched route parameter, the actor from the
 * verified principal.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

import { Authorize, OrganizationId } from '../authorization/authorization.guard';
import { AuthorizationService } from '../tenancy/authorization/authorization.service';
import { toPermissionSet } from '../tenancy/authorization/effective-permissions';
import { VerifiedPrincipal } from '../identity/jwt-auth.guard';
import type { AuthenticatedPrincipal } from '../identity/auth.service';
import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import { InventoryService } from './inventory.service';
import {
  INVENTORY_PATH,
  CostSnapshotListResponse,
  LevelListResponse,
  LevelResponse,
  ListLevelsQuery,
  ListMovementsQuery,
  LocationListResponse,
  MovementListResponse,
  MovementResponse,
  MovementSubmissionResponse,
  SubmitMovementRequest,
  ValuationResponse,
} from './inventory-view.contract';

/**
 * The inventory surface. Every route is organization-scoped; the reads answer
 * the derived truth, the writes ride the authoritative ledger and the §30
 * costing engine. Cost-bearing authority (`catalog.cost.edit`, §38.5's "when a
 * cost is involved") gates the valuation reads and the cost-imposing causes;
 * the same effective-permission resolver the `@Authorize` guard uses makes the
 * escalation, so route and escalation can never disagree.
 */
@Controller(INVENTORY_PATH)
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    /** The §11.4 resolver the escalation reuses — never a second permission rule. */
    private readonly authorization: AuthorizationService,
  ) {}

  /**
   * The cost-cause escalation of §38.5: a caller whose grants admit the plain
   * stockkeeping route (`inventory.adjust`) still needs the cost authority for
   * every movement that *sets* a cost — an opening balance, a purchase receipt
   * (which additionally demands the §11.2 stock-receiving authority), a
   * revaluation, or an adjustment the wire itself costs. Fails closed
   * `403 PERMISSION_DENIED` on the same effective set the guard resolved.
   */
  private async assertCostingPermissions(
    organizationId: string,
    userId: string,
    required: readonly string[],
  ): Promise<void> {
    if (required.length === 0) {
      return;
    }
    const effective = await this.authorization.resolveForMembership(organizationId, userId);
    const held = toPermissionSet(effective.permissions);
    for (const permission of required) {
      if (!held.has(permission)) {
        throw new DomainError(ERROR_CODES.PERMISSION_DENIED, 'the caller does not hold the required permission');
      }
    }
  }

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
    description:
      'MUTATION_CONTRADICTION, INSUFFICIENT_STOCK, INVENTORY_OPENING_BALANCE_DUPLICATE, or ' +
      'INVENTORY_COST_BASIS_REQUIRED (the stock has no cost basis; M4-S3).',
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
    // §38.5's escalation, before any database work: the cost authority is a
    // route-and-cause decision resolved from the caller's effective set.
    const costingPermissions = requiredCostingPermissions(body.cause, body.unitCostMinor);
    await this.assertCostingPermissions(organizationId, principal.userId, costingPermissions);
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
          ...(body.unitCostMinor === undefined || body.unitCostMinor === null
            ? {}
            : { unitCostMinor: body.unitCostMinor }),
          ...(body.reasonCode === undefined ? {} : { reasonCode: body.reasonCode }),
          ...(body.reasonNote === undefined ? {} : { reasonNote: body.reasonNote }),
          ...(body.documentRef === undefined ? {} : { documentRef: body.documentRef }),
        },
      },
      new Date(),
    );
  }

  @Get('valuation')
  @Authorize('catalog.cost.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The §30.2 inventory valuation.',
    description:
      'Requires `catalog.cost.edit` (§11.2: the cost-price authority; §38.5: "when a cost is involved"). ' +
      'Answers every level’s remaining quantity, the §30.2 moving average the engine maintains, and the ' +
      'exact value beneath them — quantity × average, an integer product of minor units. A level with no ' +
      'cost basis is answered null and counted in totals, never folded in at an invented cost. No-op read.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: ValuationResponse })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async listValuation(
    @OrganizationId() organizationId: string,
    @Query() query: ListLevelsQuery,
  ): Promise<ValuationResponse> {
    return this.inventory.listValuation(organizationId, query);
  }

  @Get('cost-snapshots')
  @Authorize('catalog.cost.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The movements that carry a recorded unit cost.',
    description:
      'Requires `catalog.cost.edit`. Answers the §30.2 snapshot ledger — every accepted movement that ' +
      'records the unit cost the engine applied, newest acceptance first, so any valuation point is ' +
      'reconstructible from the movements themselves. Cost is not a member of the `inventory.view` faces; ' +
      'this is the cost-authorized face of the same append-only rows. No-op read.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: CostSnapshotListResponse })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async listCostSnapshots(
    @OrganizationId() organizationId: string,
    @Query() query: ListLevelsQuery,
  ): Promise<CostSnapshotListResponse> {
    const costSnapshots = await this.inventory.listCostSnapshots(organizationId, query);
    return { costSnapshots: [...costSnapshots] };
  }
}

/**
 * The cause's costing escalation (§38.5 "plus `catalog.cost.edit` when a cost
 * is involved"): the cost-imposing causes decide the cost; a movement costing
 * is a cost decision; a plain quantity correction at the engine's own average
 * is not. `PURCHASE_RECEIPT` additionally demands `inventory.receive` — the §11.2
 * stock-receiving authority its cause names. Exported so the guard-acceptance
 * spec can pin the escalation matrix against the production decision the
 * controller makes.
 */
export function requiredCostingPermissions(
  cause: string,
  offeredUnitCostMinor: string | null | undefined,
): readonly string[] {
  if (cause === 'PURCHASE_RECEIPT') {
    return ['inventory.receive', 'catalog.cost.edit'];
  }
  if (cause === 'OPENING_BALANCE' || cause === 'REVALUATION' || offeredUnitCostMinor != null) {
    return ['catalog.cost.edit'];
  }
  return [];
}

/** The level projection exported for the type check the controller's own read uses. */
export type LevelWire = LevelResponse;
export type MovementWire = MovementResponse;

/** Path constant, re-exported so a routing test can assert it without importing the file. */
export { INVENTORY_PATH };
