/**
 * The catalog routes (Master Plan §15.1, §15.2, §15.3A, §17, §30.1; §40.8 row
 * M4-S1; §34.1).
 *
 * Thin handlers. Every rule — the bounded text, the typed attributes, the
 * exact money, the §15.2 unit semantics, the per-organization SKU uniqueness,
 * the soft delete's recorded reason — is decided by `CatalogService` and
 * restated by migration 0013's CHECKs; the controller declares the wire shape
 * so the OpenAPI document and every generated client type come from the same
 * declaration the handler uses (§7.1, ADR-001).
 *
 * Guard order matters (§9.3): `@Authorize` first runs the bearer guard, then
 * the organization check against the membership claim. Reads declare
 * `catalog.view`; writes declare `catalog.edit` — the §17 server-side
 * enforcement, resolved by the same effective-permission rule every read path
 * uses. `catalog.cost.edit` is deliberately absent from every route: costing
 * arrives with M4-S3 (§30.2), and a cost gate on a selling-price surface would
 * be an invented authority.
 *
 * No handler reads an organization id or a caller identity from a request
 * body: the tenant comes from the matched route parameter, the actor from the
 * verified principal.
 */

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

import { Authorize, OrganizationId } from '../authorization/authorization.guard';
import { VerifiedPrincipal } from '../identity/jwt-auth.guard';
import type { AuthenticatedPrincipal } from '../identity/auth.service';
import { canonicalizeUnitOffer, normalizeRequiredText } from './catalog.domain';
import { DELETE_REASON_MAX_LENGTH } from './catalog.contract';
import {
  CatalogService,
  type ProductSummaryView,
  type ProductView,
  type ProductVariantView,
} from './catalog.service';
import {
  CATALOG_PATH,
  CreateProductRequest,
  CreateVariantRequest,
  DeleteProductRequest,
  ListProductsQuery,
  ProductListResponse,
  ProductResponse,
  ProductUnitWire,
  ProductVariantResponse,
  ProductSummaryResponse,
  UpdateProductRequest,
  UpdateUnitsRequest,
  UpdateVariantRequest,
} from './catalog-view.contract';

/**
 * The catalog surface. Every product-scoped route names its parent product in
 * the path, so a variant can never be created "somewhere else" — the parent is
 * a verified server-side row before any child write runs (§15.3A.1).
 */
@Controller(CATALOG_PATH)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  @Authorize('catalog.view')
  @ApiOperation({
    summary: 'The organization’s live products.',
    description:
      'Requires `catalog.view`. Answers the live catalog in deterministic order; `search` filters the ' +
      'Arabic and English names case-insensitively, and `includeDeleted` is an explicit opt into the ' +
      '§15.1 soft-deleted rows.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: ProductListResponse })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async list(
    @OrganizationId() organizationId: string,
    @Query() query: ListProductsQuery,
  ): Promise<ProductListResponse> {
    const products = await this.catalog.listProducts(organizationId, query);
    return {
      products: products.map((product) => toSummaryResponse(product)),
    };
  }

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  @Authorize('catalog.edit')
  @ApiOperation({
    summary: 'Create a product with its §15.2 units.',
    description:
      'Requires `catalog.edit`. The base unit is required at factor exactly 1; the purchasing unit is ' +
      'optional at an exact integer factor 2..1000000. Forty-two bits of money arrive as a decimal ' +
      'string of minor units (§30.1) and the priced rows, the units, and the CATALOG_PRODUCT_CREATED ' +
      'audit event commit in one transaction.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: ProductResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'VALIDATION_FAILED — an invalid value.' })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'PERMISSION_DENIED, ORGANIZATION_FORBIDDEN, or a view-only caller.',
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async create(
    @Body() body: CreateProductRequest,
    @OrganizationId() organizationId: string,
    @VerifiedPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<ProductResponse> {
    return toResponse(
      await this.catalog.createProduct(
        {
          organizationId,
          actorUserId: principal.userId,
          offered: {
            nameAr: body.nameAr,
            ...(body.nameEn === undefined ? {} : { nameEn: body.nameEn }),
            ...(body.category === undefined ? {} : { category: body.category }),
            ...(body.brand === undefined ? {} : { brand: body.brand }),
            ...(body.unitPriceMinor === undefined ? {} : { unitPriceMinor: body.unitPriceMinor }),
            baseUnit: { ...body.baseUnit, kind: 'BASE' as const },
            ...(body.purchasingUnit === undefined
              ? {}
              : { purchasingUnit: body.purchasingUnit === null ? null : { ...body.purchasingUnit, kind: 'PURCHASING' as const } }),
          },
        },
        new Date(),
      ),
    );
  }

  @Get('products/:productId')
  @Authorize('catalog.view')
  @ApiOperation({
    summary: 'One product with its units and variants.',
    description:
      'Requires `catalog.view`. Every variant answers its §15.3A.2 effective price and where it came ' +
      'from (VARIANT, PRODUCT, or UNSET — never a fabricated zero), and `hasCost` answers false ' +
      'because the costing engine arrives with M4-S3 (§30.2).',
  })
  @ApiResponse({ status: HttpStatus.OK, type: ProductResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'NOT_FOUND — no such live product here.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async get(
    @OrganizationId() organizationId: string,
    @Param('productId') productId: string,
  ): Promise<ProductResponse> {
    return toResponse(await this.catalog.getProduct(organizationId, productId));
  }

  @Patch('products/:productId')
  @Authorize('catalog.edit')
  @ApiOperation({
    summary: 'Partially update a product.',
    description:
      'Requires `catalog.edit`. Every provided member changes; absent members stay; explicit null ' +
      'clears an optional price. The classified changes and the CATALOG_PRODUCT_UPDATED audit event ' +
      'commit in one transaction; an update that changes nothing audits nothing (§32.5 class A).',
  })
  @ApiResponse({ status: HttpStatus.OK, type: ProductResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'NOT_FOUND — no such live product here.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'VALIDATION_FAILED — an invalid value.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async update(
    @Body() body: UpdateProductRequest,
    @OrganizationId() organizationId: string,
    @Param('productId') productId: string,
    @VerifiedPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<ProductResponse> {
    return toResponse(
      await this.catalog.updateProduct(
        {
          organizationId,
          actorUserId: principal.userId,
          productId,
          offered: { ...body },
        },
        new Date(),
      ),
    );
  }

  @Delete('products/:productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authorize('catalog.edit')
  @ApiOperation({
    summary: 'Soft-delete a product with its recorded reason.',
    description:
      'Requires `catalog.edit`. The §15.1 soft delete: `deleted_at` and the required reason in one ' +
      'transaction with the CATALOG_PRODUCT_DELETED audit event. The variants and units stay; the ' +
      'live catalog simply stops seeing the product.',
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'The product left the live catalog.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'NOT_FOUND — no such live product here.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'VALIDATION_FAILED — a missing or malformed reason.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async softDelete(
    @Body() body: DeleteProductRequest,
    @OrganizationId() organizationId: string,
    @Param('productId') productId: string,
    @VerifiedPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<void> {
    const reason = normalizeRequiredText('reason', body.reason, {
      patternError: 'reason must be bounded text',
      maxLength: DELETE_REASON_MAX_LENGTH,
    });
    await this.catalog.softDeleteProduct(
      { organizationId, actorUserId: principal.userId, productId, reason },
      new Date(),
    );
  }

  @Put('products/:productId/units')
  @Authorize('catalog.edit')
  @ApiOperation({
    summary: 'Replace the product’s §15.2 unit configuration.',
    description:
      'Requires `catalog.edit`. The whole configuration is the new truth: the base unit at factor ' +
      'exactly 1, the purchasing unit at its exact factor or removed. The rows and the ' +
      'CATALOG_UNITS_UPDATED audit event commit in one transaction.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: ProductResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'NOT_FOUND — no such live product here.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'VALIDATION_FAILED — an invalid unit or factor.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async updateUnits(
    @Body() body: UpdateUnitsRequest,
    @OrganizationId() organizationId: string,
    @Param('productId') productId: string,
    @VerifiedPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<ProductResponse> {
    const units = canonicalizeUnitOffer({ base: body.baseUnit, purchasing: body.purchasingUnit });
    return toResponse(
      await this.catalog.updateUnits(
        {
          organizationId,
          actorUserId: principal.userId,
          productId,
          base: units.base,
          purchasing: units.purchasing,
        },
        new Date(),
      ),
    );
  }

  @Post('products/:productId/variants')
  @HttpCode(HttpStatus.CREATED)
  @Authorize('catalog.edit')
  @ApiOperation({
    summary: 'Create one variant under a live product.',
    description:
      'Requires `catalog.edit`. The typed attributes are canonicalized against the closed V1 catalog;' +
      ' the SKU is unique per organization by a real database index — two racing writers cannot both' +
      ' commit one SKU, and the loser answers 409 CATALOG_SKU_DUPLICATE. The variant and its ' +
      'CATALOG_VARIANT_CREATED audit event commit in one transaction.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: ProductVariantResponse })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'CATALOG_SKU_DUPLICATE — the SKU is taken.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'NOT_FOUND — no such live product here.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'VALIDATION_FAILED — an invalid value or attribute shape.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async createVariant(
    @Body() body: CreateVariantRequest,
    @OrganizationId() organizationId: string,
    @Param('productId') productId: string,
    @VerifiedPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<ProductVariantResponseBody> {
    return toVariantResponse(
      await this.catalog.createVariant(
        {
          organizationId,
          actorUserId: principal.userId,
          productId,
          offered: {
            sku: body.sku,
            ...(body.attributes === undefined ? {} : { attributes: body.attributes }),
            ...(body.priceMinor === undefined ? {} : { priceMinor: body.priceMinor }),
            ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
          },
        },
        new Date(),
      ),
    );
  }

  @Patch('products/:productId/variants/:variantId')
  @Authorize('catalog.edit')
  @ApiOperation({
    summary: 'Partially update one variant.',
    description:
      'Requires `catalog.edit`. Provided members change; absent members stay; an explicit null price' +
      ' clears the override back to §15.3A.2 inheritance; a whole replacement attribute object is' +
      ' accepted only when it is fully valid. A duplicate SKU answers 409 CATALOG_SKU_DUPLICATE, and' +
      ' the committed changes ride the CATALOG_VARIANT_UPDATED audit event in the same transaction.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: ProductVariantResponse })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'CATALOG_SKU_DUPLICATE — the SKU is taken.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'NOT_FOUND — no such product or variant here.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'VALIDATION_FAILED — an invalid value or attribute shape.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async updateVariant(
    @Body() body: UpdateVariantRequest,
    @OrganizationId() organizationId: string,
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @VerifiedPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<ProductVariantResponseBody> {
    return toVariantResponse(
      await this.catalog.updateVariant(
        {
          organizationId,
          actorUserId: principal.userId,
          productId,
          variantId,
          offered: {
            ...(body.sku === undefined ? {} : { sku: body.sku }),
            ...(body.attributes === undefined ? {} : { attributes: body.attributes }),
            ...(body.priceMinor === undefined ? {} : { priceMinor: body.priceMinor }),
            ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
          },
        },
        new Date(),
      ),
    );
  }
}

export type ProductVariantResponseBody = ProductVariantResponse;

/** The stable view-to-wire projection: money and factors ride decimal strings. */
function toResponse(view: ProductView): ProductResponse {
  return {
    id: view.id,
    organizationId: view.organizationId,
    nameAr: view.nameAr,
    nameEn: view.nameEn,
    category: view.category,
    brand: view.brand,
    unitPriceMinor: view.unitPriceMinor,
    isActive: view.isActive,
    units: view.units.map((unit) => {
      const wire: ProductUnitWire = {
        kind: unit.kind,
        code: unit.code,
        name: unit.name,
        baseQuantityFactor: unit.baseQuantityFactor,
      };
      return wire;
    }),
    variants: view.variants.map((variant) => toVariantResponse(variant)),
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

/** The summary projection for the list answer. */
function toSummaryResponse(view: ProductSummaryView): ProductSummaryResponse {
  return {
    id: view.id,
    nameAr: view.nameAr,
    nameEn: view.nameEn,
    category: view.category,
    brand: view.brand,
    unitPriceMinor: view.unitPriceMinor,
    isActive: view.isActive,
    variantCount: view.variantCount,
    hasPurchasingUnit: view.hasPurchasingUnit,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

/** The variant projection: the §15.3A.2 resolution is already the view's decision. */
function toVariantResponse(view: ProductVariantView): ProductVariantResponseBody {
  return {
    id: view.id,
    sku: view.sku,
    attributes: { ...view.attributes },
    priceMinor: view.priceMinor,
    isActive: view.isActive,
    effectivePriceMinor: view.effectivePriceMinor,
    priceSource: view.priceSource,
    hasCost: view.hasCost,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

/** Path constant, re-exported so a routing test can assert it without importing the file. */
export { CATALOG_PATH };
