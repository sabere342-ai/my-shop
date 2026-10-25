/**
 * The catalog service (Master Plan §15.1, §15.2, §15.3A, §17, §30.1;
 * §40.8 row M4-S1).
 *
 * The same three structural rules the settings service states, restated for
 * the catalog:
 *
 * 1. **Tenant scope is server-derived.** Every read and write runs inside the
 *    trusted tenant transaction (§8.2 `withTenantTransaction`) with the route
 *    organization id the authorization guard matched against the token's
 *    membership claim (§9.3). The three catalog tables are forced-RLS tenant
 *    tables, so the database refuses a context-free or foreign-context
 *    statement before the service touches a row — and the child tables'
 *    composite foreign key keeps a variant or a unit structurally unowned by
 *    another tenant's product.
 * 2. **The SKU rule is a database fact, never a preflight.** Per-organization
 *    SKU uniqueness is the `product_variants_organization_id_sku_key` unique
 *    index (§15.3A SKU rule): two racing writers for one SKU cannot both
 *    commit — PostgreSQL serializes them, one commits, the loser answers
 *    `409 CATALOG_SKU_DUPLICATE`. The service maps the database refusal, it
 *    never purchases the guarantee with a read-then-write race.
 * 3. **The change and its audit events are one transaction.** §32.5's class-A
 *    law, at catalog granularity: the protected row and *every* event it
 *    produces — the product event and one `CATALOG_VARIANT_CREATED` per
 *    created variant — commit or roll back together with it.
 *
 * Money is exact: a wire decimal string becomes a `bigint` minor-unit value in
 * the domain half (§30.1), and a stored `bigint` becomes a decimal string on
 * the way out. Effective price resolution (§15.3A.2) answers `VARIANT`,
 * `PRODUCT`, or `UNSET` — unset is never silently zero. Costing answers
 * `false` (`COSTING_UNAVAILABLE`) until the M4-S3 engine exists.
 */

import { Prisma, type Product, type ProductUnit, type ProductVariant } from '@prisma/client';
import type { Logger as PinoLogger } from 'pino';

import type { AuditStreamWriter } from '../audit/audit-stream-writer';
import { DomainError } from '../errors/domain.error';
import { ERROR_CODES } from '../errors/problem';
import { withTenantTransaction } from '../database/tenant-context';
import type { PrismaHost } from '../identity/prisma-host';
import {
  CATALOG_CONTRACT_VERSION,
  COSTING_UNAVAILABLE,
  type PriceSource,
  type UnitKind,
} from './catalog.contract';
import { resolveEffectivePrice } from './catalog.domain';
import type {
  CreateProductOfferWire,
  CreateVariantOfferWire,
  UpdateProductOfferWire,
  UpdateVariantOfferWire,
} from './catalog.domain';
import {
  canonicalizeCreateProductOffer,
  canonicalizeCreateVariantOffer,
  canonicalizeUpdateProductOffer,
  canonicalizeUpdateVariantOffer,
  classifyChanges,
  type CreateProductOffer,
  type UnitOffer,
  type UpdateProductOffer,
  type UpdateVariantOffer,
} from './catalog.domain';

/** The audit target types the catalog rows carry (§32.2 vocabulary). */
export const CATALOG_TARGET_TYPES = {
  product: 'PRODUCT',
  variant: 'PRODUCT_VARIANT',
  unit: 'PRODUCT_UNITS',
} as const;

/** One unit row as the wire answers it: the exact factor rides a decimal string. */
export interface ProductUnitView {
  readonly kind: UnitKind;
  readonly code: string;
  readonly name: string;
  readonly baseQuantityFactor: string;
}

/** One variant as the wire answers it: the effective price and its source. */
export interface ProductVariantView {
  readonly id: string;
  readonly sku: string;
  readonly attributes: Readonly<Record<string, string | number>>;
  /** The variant's own override in minor units, or null when it inherits (§15.3A.2). */
  readonly priceMinor: string | null;
  readonly isActive: boolean;
  /** The §15.3A.2 resolved selling price — never a fabricated zero. */
  readonly effectivePriceMinor: string | null;
  readonly priceSource: PriceSource;
  /**
   * The M4-S1 honest costing answer: `false` until the M4-S3 engine exists —
   * "costing not available", never a real zero cost.
   */
  readonly hasCost: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One product as the wire answers it, with its §15.2 units and its variants. */
export interface ProductView {
  readonly id: string;
  readonly organizationId: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly category: string | null;
  readonly brand: string | null;
  readonly unitPriceMinor: string | null;
  readonly isActive: boolean;
  readonly units: readonly ProductUnitView[];
  readonly variants: readonly ProductVariantView[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The list answer: summaries without the variant bodies, deterministic order. */
export interface ProductSummaryView {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly category: string | null;
  readonly brand: string | null;
  readonly unitPriceMinor: string | null;
  readonly isActive: boolean;
  readonly variantCount: number;
  readonly hasPurchasingUnit: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One create-product attempt: the raw wire offer, proven inside the service before any connection. */
export interface CreateProductInput {
  readonly organizationId: string;
  /** The verified principal's user id — the §32.6 attribution, never a body field. */
  readonly actorUserId: string;
  readonly offered: CreateProductOfferWire;
}

/** One update-product attempt (absent field = untouched; `null` clears where legal). */
export interface UpdateProductInput {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly productId: string;
  readonly offered: UpdateProductOfferWire;
}

/** One soft-delete attempt. The §15.1 reason is required text, never an afterthought. */
export interface DeleteProductInput {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly productId: string;
  readonly reason: string;
}

/** One create-variant attempt under an existing product. */
export interface CreateVariantInput {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly productId: string;
  readonly offered: CreateVariantOfferWire;
}

/** One update-variant attempt (absent field = untouched; `null` clears the price override). */
export interface UpdateVariantInput {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly productId: string;
  readonly variantId: string;
  readonly offered: UpdateVariantOfferWire;
}

/** One unit-configuration attempt: the whole §15.2 configuration is the new truth. */
export interface UpdateUnitsInput {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly productId: string;
  readonly base: UnitOffer;
  readonly purchasing: UnitOffer | null;
}

type Tx = Prisma.TransactionClient;

/** The stored unit rows of one product, grouped by their kind. */
interface StoredUnits {
  readonly base: ProductUnit;
  readonly purchasing: ProductUnit | null;
}

export class CatalogService {
  constructor(
    /** The database host the service depends on: the connected client, read at call time. */
    private readonly host: PrismaHost,
    /** The §32.5 class-A transactional audit writer; always wired in production. */
    private readonly audit: AuditStreamWriter,
    private readonly logger?: PinoLogger,
  ) {}

  /**
   * Creates a product with its §15.2 units, in one transaction: the product
   * row, the `BASE` unit row (factor exactly 1 by definition), the optional
   * `PURCHASING` unit row at its exact integer factor, and the `CATALOG_PRODUCT_CREATED`
   * audit row — all commit or roll back together. Variants have their own
   * route: the wire offer carries no variant, so a product never half-creates
   * a.Future inventory rows (M4-S2) under an invisible transaction edge.
   */
  async createProduct(input: CreateProductInput, now: Date = new Date()): Promise<ProductView> {
    const offer = canonicalizeCreateProductOffer(input.offered);
    return withTenantTransaction(this.host, input.organizationId, async (tx) => {
      const product = await tx.product.create({
        data: {
          organizationId: input.organizationId,
          nameAr: offer.nameAr,
          nameEn: offer.nameEn,
          category: offer.category,
          brand: offer.brand,
          unitPriceMinor: offer.unitPriceMinor,
        },
      });
      // The unit rows name their parent now that the product id exists; they
      // are in the same transaction, so a refusal rolls the product back too
      // (the §32.5 class-A law covers the whole group, not each row).
      const unitRows: { kind: UnitKind; code: string; name: string; baseQuantityFactor: bigint }[] = [
        {
          kind: 'BASE',
          code: offer.baseUnit.code,
          name: offer.baseUnit.name,
          baseQuantityFactor: offer.baseUnit.baseQuantityFactor,
        },
        ...(offer.purchasingUnit === null
          ? []
          : [
              {
                kind: 'PURCHASING' as const,
                code: offer.purchasingUnit.code,
                name: offer.purchasingUnit.name,
                baseQuantityFactor: offer.purchasingUnit.baseQuantityFactor,
              },
            ]),
      ];
      await tx.productUnit.createMany({
        data: unitRows.map((unit) => ({ ...unit, organizationId: input.organizationId, productId: product.id })),
      });
      await this.appendProductCreated(tx, input, offer, product, now);
      const units = await this.readUnits(tx, product.id);
      return this.toProductView({
        product,
        units,
        variants: [],
      });
    });
  }

  /**
   * Reads one product with its units and variants (`catalog.view` is the
   * guard's decision, before this method runs). A deleted product is a
   * `404 NOT_FOUND` — the §15.1 soft delete removes it from the live catalog
   * without a physical delete — and a product of another organization is the
   * same answer, because RLS fails closed either way.
   */
  async getProduct(organizationId: string, productId: string): Promise<ProductView> {
    return withTenantTransaction(this.host, organizationId, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, deletedAt: null },
        include: {
          variants: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] },
          units: { orderBy: [{ kind: 'asc' as const }, { id: 'asc' as const }] },
        },
      });
      if (product === null) {
        throw new DomainError(ERROR_CODES.NOT_FOUND, 'no such live product in this organization');
      }
      return this.toProductView({
        product,
        units: groupedUnits(product.units),
        variants: product.variants,
      });
    });
  }

  /**
   * Lists the organization's live products (deterministic `createdAt`/`id`
   * order, never a database-dependent order). `search` filters the Arabic and
   * the English name case-insensitively; `includeDeleted` is an explicit,
   * audited answer to callers that legitimately need the §15.1 soft-deleted
   * rows for support, never a default behaviour.
   */
  async listProducts(
    organizationId: string,
    query: { readonly search?: string; readonly includeDeleted?: boolean; readonly limit?: number } = {},
  ): Promise<readonly ProductSummaryView[]> {
    return withTenantTransaction(this.host, organizationId, async (tx) => {
      const rows = await tx.product.findMany({
        where: {
          ...(query.includeDeleted === true ? {} : { deletedAt: null }),
          ...(query.search === undefined || query.search.trim().length === 0
            ? {}
            : {
                OR: [
                  { nameAr: { contains: query.search.trim(), mode: 'insensitive' as const } },
                  { nameEn: { contains: query.search.trim(), mode: 'insensitive' as const } },
                ],
              }),
        },
        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        ...(query.limit === undefined ? {} : { take: query.limit }),
        include: {
          _count: { select: { variants: true } },
          units: { select: { kind: true } },
        },
      });
      return rows.map((row) => toSummaryView(row));
    });
  }

  /**
   * Applies a partial product update in one transaction: the canonicalized
   * fields, the changed-field classification against the stored row, and the
   * `CATALOG_PRODUCT_UPDATED` audit row with exactly the changes that land.
   * Nothing offered means nothing written and nothing audited.
   */
  async updateProduct(input: UpdateProductInput, now: Date = new Date()): Promise<ProductView> {
    const offer = canonicalizeUpdateProductOffer(input.offered);
    return withTenantTransaction(this.host, input.organizationId, async (tx) => {
      const product = await this.lockLiveProduct(tx, input.productId);
      const changes = classifyChanges(this.productShape(product), productShapeFromOffer(offer));
      if (changes.length === 0) {
        // A no-op update is not a write: no version churn, no audit noise.
        const units = await this.readUnits(tx, product.id);
        return this.toProductView({
          product,
          units,
          variants: await tx.productVariant.findMany({
            where: { productId: product.id },
            orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
          }),
        });
      }
      const updated = await tx.product.update({
        where: { id: product.id },
        data: {
          ...(offer.nameAr === undefined ? {} : { nameAr: offer.nameAr }),
          ...(offer.nameEn === undefined ? {} : { nameEn: offer.nameEn }),
          ...(offer.category === undefined ? {} : { category: offer.category }),
          ...(offer.brand === undefined ? {} : { brand: offer.brand }),
          ...(offer.unitPriceMinor === undefined ? {} : { unitPriceMinor: offer.unitPriceMinor }),
          ...(offer.isActive === undefined ? {} : { isActive: offer.isActive }),
          updatedAt: now,
        },
      });
      await this.appendAudit(tx, input.organizationId, input.actorUserId, {
        eventType: 'CATALOG_PRODUCT_UPDATED',
        targetType: CATALOG_TARGET_TYPES.product,
        targetId: product.id,
        documentRef: `product:${product.id}`,
        occurredAt: now,
        payload: { changes: changes.map((change) => ({ ...change })) },
      });
      const units = await this.readUnits(tx, product.id);
      return this.toProductView({
        product: updated,
        units,
        variants: await tx.productVariant.findMany({
          where: { productId: product.id },
          orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        }),
      });
    });
  }

  /**
   * Soft-deletes a product (§15.1): `deleted_at` and the required recorded
   * reason in one transaction with its `CATALOG_PRODUCT_DELETED` audit row.
   * The variants and units stay — the §16.7 no-destructive-path discipline —
   * and the live views simply stop seeing the product.
   */
  async softDeleteProduct(input: DeleteProductInput, now: Date = new Date()): Promise<void> {
    return withTenantTransaction(this.host, input.organizationId, async (tx) => {
      const product = await this.lockLiveProduct(tx, input.productId);
      await tx.product.update({
        where: { id: product.id },
        data: { deletedAt: now, deleteReason: input.reason, updatedAt: now },
      });
      await this.appendAudit(tx, input.organizationId, input.actorUserId, {
        eventType: 'CATALOG_PRODUCT_DELETED',
        targetType: CATALOG_TARGET_TYPES.product,
        targetId: product.id,
        documentRef: `product:${product.id}`,
        occurredAt: now,
        payload: { nameAr: product.nameAr, reason: input.reason },
      });
      this.logger?.info(
        { component: 'catalog', organizationId: input.organizationId, productId: product.id },
        'the product was soft-deleted with its recorded reason',
      );
    });
  }

  /**
   * Replaces the §15.2 unit configuration (the whole configuration is the new
   * truth, exactly as `canonicalizeUnitOffer` proves it): upsert the `BASE`
   * row at factor 1, upsert or remove the `PURCHASING` row, and audit
   * `CATALOG_UNITS_UPDATED` with the outcome. One transaction.
   */
  async updateUnits(input: UpdateUnitsInput, now: Date = new Date()): Promise<ProductView> {
    return withTenantTransaction(this.host, input.organizationId, async (tx) => {
      const product = await this.lockLiveProduct(tx, input.productId);
      const before = await this.readUnits(tx, product.id);
      await tx.productUnit.upsert({
        where: { productId_kind: { productId: product.id, kind: 'BASE' } },
        create: {
          organizationId: input.organizationId,
          productId: product.id,
          kind: 'BASE',
          code: input.base.code,
          name: input.base.name,
          baseQuantityFactor: input.base.baseQuantityFactor,
        },
        update: { code: input.base.code, name: input.base.name, baseQuantityFactor: input.base.baseQuantityFactor },
      });
      if (input.purchasing === null) {
        if (before.purchasing !== null) {
          await tx.productUnit.delete({
            where: { productId_kind: { productId: product.id, kind: 'PURCHASING' } },
          });
        }
      } else {
        await tx.productUnit.upsert({
          where: { productId_kind: { productId: product.id, kind: 'PURCHASING' } },
          create: {
            organizationId: input.organizationId,
            productId: product.id,
            kind: 'PURCHASING',
            code: input.purchasing.code,
            name: input.purchasing.name,
            baseQuantityFactor: input.purchasing.baseQuantityFactor,
          },
          update: {
            code: input.purchasing.code,
            name: input.purchasing.name,
            baseQuantityFactor: input.purchasing.baseQuantityFactor,
          },
        });
      }
      const units = await this.readUnits(tx, product.id);
      await this.appendAudit(tx, input.organizationId, input.actorUserId, {
        eventType: 'CATALOG_UNITS_UPDATED',
        targetType: CATALOG_TARGET_TYPES.unit,
        targetId: product.id,
        documentRef: `product:${product.id}:units`,
        occurredAt: now,
        payload: {
          units: unitsOf(units).map((unit) => ({
            kind: unit.kind,
            code: unit.code,
            name: unit.name,
            baseQuantityFactor: unit.baseQuantityFactor,
          })),
        },
      });
      return this.toProductView({
        product,
        units,
        variants: await tx.productVariant.findMany({
          where: { productId: product.id },
          orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        }),
      });
    });
  }

  /**
   * Creates one variant (§15.3A.2) under a live product: the validated
   * attributes object, the optional exact price override, and its own
   * `CATALOG_VARIANT_CREATED` audit row. The SKU rule is the database's: a
   * duplicate — single writer or racing writers — is mapped from the unique
   * index refusal to `409 CATALOG_SKU_DUPLICATE`.
   */
  async createVariant(input: CreateVariantInput, now: Date = new Date()): Promise<ProductVariantView> {
    const offer = canonicalizeCreateVariantOffer(input.offered);
    return withTenantTransaction(this.host, input.organizationId, async (tx) => {
      const product = await this.lockLiveProduct(tx, input.productId);
      let variant: ProductVariant;
      try {
        variant = await tx.productVariant.create({
          data: {
            organizationId: input.organizationId,
            productId: product.id,
            sku: offer.sku,
            attributes: offer.attributes,
            priceMinor: offer.priceMinor,
            isActive: offer.isActive,
          },
        });
      } catch (error) {
        throw this.mapUniqueRefusal(error);
      }
      await this.appendAudit(tx, input.organizationId, input.actorUserId, {
        eventType: 'CATALOG_VARIANT_CREATED',
        targetType: CATALOG_TARGET_TYPES.variant,
        targetId: variant.id,
        documentRef: `variant:${variant.id}`,
        occurredAt: now,
        payload: {
          productId: product.id,
          sku: variant.sku,
          attributes: { ...variantAttributesOf(variant) },
          ...(variant.priceMinor === null ? {} : { priceMinor: variant.priceMinor.toString() }),
        },
      });
      return this.toVariantView(product, variant);
    });
  }

  /**
   * Applies a partial variant update in one transaction: absent fields stay,
   * an explicit `null` price clears the override back to product inheritance
   * (§15.3A.2), a whole replacement attribute object is committed only if it
   * is fully valid, and the `CATALOG_VARIANT_UPDATED` audit row carries the
   * classified changes. Duplicate-SKU refusals map to 409 exactly as creates.
   */
  async updateVariant(input: UpdateVariantInput, now: Date = new Date()): Promise<ProductVariantView> {
    const offer = canonicalizeUpdateVariantOffer(input.offered);
    return withTenantTransaction(this.host, input.organizationId, async (tx) => {
      const product = await this.lockLiveProduct(tx, input.productId);
      const variant = await tx.productVariant.findFirst({
        where: { id: input.variantId, productId: product.id },
      });
      if (variant === null) {
        throw new DomainError(ERROR_CODES.NOT_FOUND, 'no such variant under this product');
      }
      const before = this.variantShape(variant);
      const after = variantShapeFromOffer(offer);
      const changes = classifyChanges(before, after);
      if (changes.length === 0) {
        return this.toVariantView(product, variant);
      }
      let updated: ProductVariant;
      try {
        updated = await tx.productVariant.update({
          where: { id: variant.id },
          data: {
            ...(offer.sku === undefined ? {} : { sku: offer.sku }),
            ...(offer.attributes === undefined ? {} : { attributes: offer.attributes }),
            ...(offer.priceMinor === undefined ? {} : { priceMinor: offer.priceMinor }),
            ...(offer.isActive === undefined ? {} : { isActive: offer.isActive }),
            updatedAt: now,
          },
        });
      } catch (error) {
        throw this.mapUniqueRefusal(error);
      }
      await this.appendAudit(tx, input.organizationId, input.actorUserId, {
        eventType: 'CATALOG_VARIANT_UPDATED',
        targetType: CATALOG_TARGET_TYPES.variant,
        targetId: variant.id,
        documentRef: `variant:${variant.id}`,
        occurredAt: now,
        payload: { changes: changes.map((change) => ({ ...change })) },
      });
      return this.toVariantView(product, updated);
    });
  }

  // --- internals ---

  /**
   * Locks and returns the live product row for a write (§8.2: the RLS
   * context-of-the-transaction scopes the query; a deleted or foreign id is
   * the same honest 404). The SELECT…FOR UPDATE step keeps two racing unit
   * reconfigurations serialized before either upsert runs.
   */
  private async lockLiveProduct(tx: Tx, productId: string): Promise<Product> {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM products WHERE id = ${productId}::uuid AND deleted_at IS NULL FOR UPDATE`;
    if (locked.length === 0) {
      throw new DomainError(ERROR_CODES.NOT_FOUND, 'no such live product in this organization');
    }
    return tx.product.findUniqueOrThrow({ where: { id: productId } });
  }

  /** Reads the product's units and groups them (deterministic kind order). */
  private async readUnits(tx: Tx, productId: string): Promise<StoredUnits> {
    const rows = await tx.productUnit.findMany({
      where: { productId },
      orderBy: [{ kind: 'asc' as const }, { id: 'asc' as const }],
    });
    return groupedUnits(rows);
  }

  /** The class-A append: one audited catalog event inside the caller's transaction. */
  private async appendAudit(
    tx: Tx,
    organizationId: string,
    actorUserId: string,
    input: {
      readonly eventType: 'CATALOG_PRODUCT_CREATED' | 'CATALOG_PRODUCT_UPDATED' | 'CATALOG_PRODUCT_DELETED' | 'CATALOG_VARIANT_CREATED' | 'CATALOG_VARIANT_UPDATED' | 'CATALOG_UNITS_UPDATED';
      readonly targetType: string;
      readonly targetId: string;
      readonly documentRef: string;
      readonly occurredAt: Date;
      readonly payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.audit.appendAuditEvent(tx, {
      eventType: input.eventType,
      organizationId,
      actor: { kind: 'USER', userId: actorUserId },
      occurredAt: input.occurredAt,
      targetType: input.targetType,
      targetId: input.targetId,
      documentRef: input.documentRef,
      payload: { contractVersion: CATALOG_CONTRACT_VERSION, ...input.payload },
    });
  }

  private async appendProductCreated(
    tx: Tx,
    input: CreateProductInput,
    offer: CreateProductOffer,
    product: Product,
    now: Date,
  ): Promise<void> {
    await this.appendAudit(tx, input.organizationId, input.actorUserId, {
      eventType: 'CATALOG_PRODUCT_CREATED',
      targetType: CATALOG_TARGET_TYPES.product,
      targetId: product.id,
      documentRef: `product:${product.id}`,
      occurredAt: now,
      payload: {
        nameAr: offer.nameAr,
        nameEn: offer.nameEn,
        category: offer.category,
        brand: offer.brand,
        ...(offer.unitPriceMinor === null ? {} : { unitPriceMinor: offer.unitPriceMinor.toString() }),
        units: [
          { kind: 'BASE', code: offer.baseUnit.code, baseQuantityFactor: '1' },
          ...(offer.purchasingUnit === null
            ? []
            : [
                {
                  kind: 'PURCHASING' as const,
                  code: offer.purchasingUnit.code,
                  baseQuantityFactor: offer.purchasingUnit.baseQuantityFactor.toString(),
                },
              ]),
        ],
      },
    });
  }

  /** Maps the database's unique-index refusal to the catalog's honest 409. */
  private mapUniqueRefusal(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new DomainError(ERROR_CODES.CATALOG_SKU_DUPLICATE, 'a variant of this organization already uses this SKU');
    }
    return error;
  }

  /** One product as the wire view, with §15.3A.2 resolution per variant. */
  private toProductView(input: {
    readonly product: Product;
    readonly units: StoredUnits;
    readonly variants: readonly ProductVariant[];
  }): ProductView {
    const { product } = input;
    return {
      id: product.id,
      organizationId: product.organizationId,
      nameAr: product.nameAr,
      nameEn: product.nameEn,
      category: product.category,
      brand: product.brand,
      unitPriceMinor: product.unitPriceMinor === null ? null : product.unitPriceMinor.toString(),
      isActive: product.isActive,
      units: unitsOf(input.units),
      variants: input.variants.map((variant) => this.toVariantView(product, variant)),
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }

  /** One variant with the §15.3A.2 effective price resolved against its product. */
  private toVariantView(product: Product, variant: ProductVariant): ProductVariantView {
    const { effective, source } = resolveEffectivePrice(product.unitPriceMinor, variant.priceMinor);
    return {
      id: variant.id,
      sku: variant.sku,
      attributes: variantAttributesOf(variant),
      priceMinor: variant.priceMinor === null ? null : variant.priceMinor.toString(),
      isActive: variant.isActive,
      effectivePriceMinor: effective === null ? null : effective.toString(),
      priceSource: source,
      hasCost: COSTING_UNAVAILABLE,
      createdAt: variant.createdAt.toISOString(),
      updatedAt: variant.updatedAt.toISOString(),
    };
  }

  /** The stored scalars the product classifier compares (values only, no ids). */
  private productShape(product: Product) {
    return {
      nameAr: product.nameAr,
      nameEn: product.nameEn,
      category: product.category,
      brand: product.brand,
      unitPriceMinor: product.unitPriceMinor === null ? null : product.unitPriceMinor.toString(),
      isActive: product.isActive,
    };
  }

  /** The offered scalars in the classifier's shape. */
  private variantShape(variant: ProductVariant) {
    return {
      sku: variant.sku,
      priceMinor: variant.priceMinor === null ? null : variant.priceMinor.toString(),
      isActive: variant.isActive,
    };
  }
}

/** The stored units of one product, in wire order (BASE first). */
function groupedUnits(rows: readonly ProductUnit[]): StoredUnits {
  const base = rows.find((row) => row.kind === 'BASE');
  const purchasing = rows.find((row) => row.kind === 'PURCHASING') ?? null;
  if (base === undefined) {
    throw new DomainError(
      ERROR_CODES.INTERNAL_ERROR,
      'a stored product must always carry its BASE unit row',
    );
  }
  return { base, purchasing };
}

/** The units as the wire answers them. */
function unitsOf(units: StoredUnits): readonly ProductUnitView[] {
  return [
    {
      kind: units.base.kind as UnitKind,
      code: units.base.code,
      name: units.base.name,
      baseQuantityFactor: units.base.baseQuantityFactor.toString(),
    },
    ...(units.purchasing === null
      ? []
      : [
          {
            kind: units.purchasing.kind as UnitKind,
            code: units.purchasing.code,
            name: units.purchasing.name,
            baseQuantityFactor: units.purchasing.baseQuantityFactor.toString(),
          },
        ]),
  ];
}

/** The stored attributes as a plain JSON object (Prisma returns a `JsonValue`). */
function variantAttributesOf(variant: ProductVariant): Record<string, string | number> {
  const raw = variant.attributes as unknown;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number') out[key] = value;
  }
  return out;
}

/** The summary projection for the list answer. */
function toSummaryView(
  row: Product & { _count: { variants: number }; units: readonly { kind: string }[] },
): ProductSummaryView {
  return {
    id: row.id,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    category: row.category,
    brand: row.brand,
    unitPriceMinor: row.unitPriceMinor === null ? null : row.unitPriceMinor.toString(),
    isActive: row.isActive,
    variantCount: row._count.variants,
    hasPurchasingUnit: row.units.some((unit) => unit.kind === 'PURCHASING'),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The offered product scalars in the classifier's shape: absent offer fields are dropped, never null-compared. */
function productShapeFromOffer(offer: UpdateProductOffer) {
  const shape: { [key: string]: string | boolean | null } = {};
  const entries = Object.entries(offer as unknown as Record<string, unknown>);
  for (const [field, value] of entries) {
    if (value === undefined) continue;
    if (field === 'unitPriceMinor') {
      const price = offer.unitPriceMinor;
      shape['unitPriceMinor'] = price === null ? null : (price as bigint).toString();
    } else {
      shape[field] = value as string | boolean | null;
    }
  }
  return shape;
}

/** The offered variant scalars in the classifier's shape: absent offer fields are dropped, never null-compared. */
function variantShapeFromOffer(offer: UpdateVariantOffer) {
  const shape: { [key: string]: string | boolean | null } = {};
  if (offer.sku !== undefined) shape['sku'] = offer.sku;
  if (offer.priceMinor !== undefined) {
    shape['priceMinor'] = offer.priceMinor === null ? null : offer.priceMinor.toString();
  }
  if (offer.isActive !== undefined) shape['isActive'] = offer.isActive;
  return shape;
}
