/**
 * The settings routes (Master Plan §22, §38.18; §40.7 row M3-S1; §34.1).
 *
 * Two thin handlers. Every decision — the §22.2 permission column per
 * provided field, the §38.18 version token, the typed writes, and the
 * class-A audit row — lives in `SettingsService`; the controller declares the
 * wire shape so the OpenAPI document and every generated client type come
 * from the same declaration the handler uses (§7.1, ADR-001).
 *
 * Guard order matters (§9.3): `@Authorize` first runs the bearer guard (a
 * verified principal), then the organization check (the route's tenant is in
 * the membership claim). The read declares `settings.view` for the guard to
 * enforce; the write declares none, because a settings update's required
 * permission is a property of the *provided fields* (§22.2) — the service
 * resolves the caller's effective authorization inside the write transaction
 * and refuses field by field there.
 *
 * No handler reads an organization id or a caller identity from a request
 * body: the tenant comes from the matched route parameter, the actor from the
 * verified principal.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

import { Authorize, OrganizationId } from '../authorization/authorization.guard';
import { VerifiedPrincipal } from '../identity/jwt-auth.guard';
import type { AuthenticatedPrincipal } from '../identity/auth.service';
import {
  OrganizationSettingsResponse,
  SETTINGS_PATH,
  UpdateOrganizationSettingsRequest,
} from './settings-view.contract';
import { SettingsService, type SettingsView } from './settings.service';

@Controller(SETTINGS_PATH)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Authorize('settings.view')
  @ApiOperation({
    summary: "The organization's typed settings.",
    description:
      'Requires `settings.view`. Answers the complete §22.2/§22.4 typed inventory with the §38.18 ' +
      '`settings_version` staleness fingerprint. An organization whose settings row was never ' +
      'materialized receives its defaults (version 1) — never a missing answer.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: OrganizationSettingsResponse,
    description: 'The typed settings, complete.',
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'PERMISSION_DENIED or ORGANIZATION_FORBIDDEN.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async get(@OrganizationId() organizationId: string): Promise<OrganizationSettingsResponse> {
    return toResponse(await this.settings.get(organizationId));
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @Authorize()
  @ApiOperation({
    summary: 'Update the organization’s typed settings.',
    description:
      'A field-authorized partial update: every provided member is checked against the §22.2/§22.4 ' +
      'permission column inside the write transaction (owner-exclusive fields need the owner), the ' +
      '§38.18 `settingsVersion` body token is enforced (a stale token answers the 409 below, ' +
      'never a silent lost update), and the changed row, its version increment, and the audited ' +
      'SETTINGS_UPDATED event commit in one transaction. Refused, unauthorized, conflicting, or ' +
      'failing updates advance nothing.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: OrganizationSettingsResponse,
    description: 'The updated settings with the advanced settings_version.',
  })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'SETTINGS_VERSION_CONFLICT — stale version token.' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'VALIDATION_FAILED — an invalid value or an empty update.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'PERMISSION_DENIED, ORGANIZATION_FORBIDDEN, or an owner-exclusive field held by a non-owner.',
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'UNAUTHENTICATED.' })
  async update(
    @Body() body: UpdateOrganizationSettingsRequest,
    @OrganizationId() organizationId: string,
    @VerifiedPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<OrganizationSettingsResponse> {
    const result = await this.settings.update(
      {
        organizationId,
        actorUserId: principal.userId,
        expectedSettingsVersion: body.settingsVersion,
        offered: {
          ...(body.organizationName === undefined ? {} : { organizationName: body.organizationName }),
          ...(body.currency === undefined ? {} : { currency: body.currency }),
          ...(body.minorUnitExponent === undefined ? {} : { minorUnitExponent: body.minorUnitExponent }),
          ...(body.displayNumerals === undefined ? {} : { displayNumerals: body.displayNumerals }),
          ...(body.pricingMode === undefined ? {} : { pricingMode: body.pricingMode }),
          ...(body.maxDiscountPercentage === undefined ? {} : { maxDiscountPercentage: body.maxDiscountPercentage }),
          ...(body.maxDiscountAmountMinor === undefined ? {} : { maxDiscountAmountMinor: body.maxDiscountAmountMinor }),
          ...(body.discountApprovalThresholdMinor === undefined
            ? {}
            : { discountApprovalThresholdMinor: body.discountApprovalThresholdMinor }),
          ...(body.discountAllowedForSalesperson === undefined
            ? {}
            : { discountAllowedForSalesperson: body.discountAllowedForSalesperson }),
          ...(body.blockDiscountBelowCost === undefined ? {} : { blockDiscountBelowCost: body.blockDiscountBelowCost }),
          ...(body.invoiceOutputDefault === undefined ? {} : { invoiceOutputDefault: body.invoiceOutputDefault }),
          ...(body.invoiceFooter === undefined ? {} : { invoiceFooter: body.invoiceFooter }),
          ...(body.invoiceShowLogo === undefined ? {} : { invoiceShowLogo: body.invoiceShowLogo }),
          ...(body.customerRequiredOnCreditSale === undefined
            ? {}
            : { customerRequiredOnCreditSale: body.customerRequiredOnCreditSale }),
          ...(body.roundingMode === undefined ? {} : { roundingMode: body.roundingMode }),
          ...(body.receivablesAgingEnabled === undefined
            ? {}
            : { receivablesAgingEnabled: body.receivablesAgingEnabled }),
          ...(body.offlineGraceDurationSeconds === undefined
            ? {}
            : { offlineGraceDurationSeconds: body.offlineGraceDurationSeconds }),
          ...(body.offlineReceiptIdFormat === undefined ? {} : { offlineReceiptIdFormat: body.offlineReceiptIdFormat }),
          ...(body.offlineReservedNumberBlocks === undefined
            ? {}
            : { offlineReservedNumberBlocks: body.offlineReservedNumberBlocks }),
          ...(body.reservedBlockSize === undefined ? {} : { reservedBlockSize: body.reservedBlockSize }),
          ...(body.featureFlags === undefined ? {} : { featureFlags: body.featureFlags }),
        },
      },
      new Date(),
    );
    return toResponse(result.view);
  }
}

/** The stable date-to-wire projection; 64-bit values ride the decimal-string the contract declares. */
function toResponse(view: SettingsView): OrganizationSettingsResponse {
  return {
    organizationId: view.organizationId,
    settingsVersion: Number(view.settingsVersion),
    organizationName: view.organizationName,
    currency: view.currency as OrganizationSettingsResponse['currency'],
    minorUnitExponent: view.minorUnitExponent,
    displayNumerals: view.displayNumerals as OrganizationSettingsResponse['displayNumerals'],
    pricingMode: view.pricingMode as OrganizationSettingsResponse['pricingMode'],
    maxDiscountPercentage: settingsDecimalToNumber(view.maxDiscountPercentage),
    maxDiscountAmountMinor: view.maxDiscountAmountMinor,
    discountApprovalThresholdMinor: view.discountApprovalThresholdMinor,
    discountAllowedForSalesperson: view.discountAllowedForSalesperson,
    blockDiscountBelowCost: view.blockDiscountBelowCost,
    invoiceOutputDefault: view.invoiceOutputDefault as OrganizationSettingsResponse['invoiceOutputDefault'],
    invoiceFooter: view.invoiceFooter,
    invoiceShowLogo: view.invoiceShowLogo,
    customerRequiredOnCreditSale: view.customerRequiredOnCreditSale,
    roundingMode: view.roundingMode as OrganizationSettingsResponse['roundingMode'],
    receivablesAgingEnabled: view.receivablesAgingEnabled,
    offlineGraceDurationSeconds: Number(view.offlineGraceDurationSeconds),
    offlineReceiptIdFormat: view.offlineReceiptIdFormat as OrganizationSettingsResponse['offlineReceiptIdFormat'],
    offlineReservedNumberBlocks: view.offlineReservedNumberBlocks,
    reservedBlockSize: view.reservedBlockSize,
    featureFlags: view.flags,
    updatedAt: view.updatedAt.toISOString(),
  };
}

/** The numeric(5,2) percentage is a bounded 0..100 decimal; its wire type is a plain number. */
function settingsDecimalToNumber(text: string): number {
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new Error('the stored max_discount_percentage is not a readable number');
  }
  return value;
}

/** Path constant, re-exported so a routing test can assert it without importing the file. */
export { SETTINGS_PATH };
