// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'My Shop';

  @override
  String get shellTitle => 'Workspace';

  @override
  String get shellBody => 'Choose a workspace entry from the list.';

  @override
  String get shellOpenSettings => 'Settings';

  @override
  String get notFoundTitle => 'Page not found';

  @override
  String get notFoundBody => 'The link may have been removed or changed.';

  @override
  String get backToHome => 'Back to start';

  @override
  String get authSignInTitle => 'Sign in';

  @override
  String get authEmailLabel => 'Email';

  @override
  String get authPasswordLabel => 'Password';

  @override
  String get authSignInAction => 'Sign in';

  @override
  String get authInvalidCredentials => 'The email or password is not correct.';

  @override
  String get authRateLimited =>
      'Too many attempts; wait a moment and try again.';

  @override
  String get authRefused =>
      'The server refused the request; review the details and try again.';

  @override
  String get authWithheld =>
      'No answer arrived from the server; check the connection and try again.';

  @override
  String get authChooseOrganizationTitle => 'Choose your organization';

  @override
  String get authChooseOrganizationBody =>
      'Your account belongs to more than one organization; choose the one this device will work on.';

  @override
  String get authSessionMissing => 'No active session; you were signed out.';

  @override
  String get shellGraceActive =>
      'The permissions stored on this device are valid; editing works offline.';

  @override
  String get shellGraceReadOnly =>
      'Reading works offline; editing stops until a new server connection.';

  @override
  String get shellGraceUnavailable =>
      'The local session status has not been read yet.';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get settingsHubSubtitle =>
      'This organization\'s settings, pricing, and discount policy.';

  @override
  String get settingsEntryGeneral => 'General settings';

  @override
  String get settingsEntryGeneralDescription =>
      'Organization identity, currency, invoices, and sales.';

  @override
  String get settingsEntryPricing => 'Pricing & discounts';

  @override
  String get settingsEntryPricingDescription =>
      'The pricing mode, discount ceilings, and the approval gate.';

  @override
  String get settingsSourceLive => 'Live data from the server.';

  @override
  String get settingsSourceCached => 'A cached, read-only copy.';

  @override
  String settingsVersionLive(int version) {
    return 'Settings version: $version';
  }

  @override
  String settingsCachedLine(int version, String time) {
    return 'Cached version: $version — last sync: $time';
  }

  @override
  String get settingsOfflineBanner =>
      'No connection to the server; cached settings are on display, and editing is stopped.';

  @override
  String get settingsOfflineNoCache =>
      'No cached copy of the settings exists; one connection loads them.';

  @override
  String get settingsCacheCorrupted =>
      'The cached copy is corrupt and was refused; a connection to the server will replace it.';

  @override
  String get settingsLoadError => 'The settings could not be loaded.';

  @override
  String get settingsLoading => 'جارٍ تحميل الإعدادات…';

  @override
  String get settingsDeniedTitle =>
      'You do not have permission to view settings';

  @override
  String get settingsDeniedBody =>
      'The server answered; the \'settings.view\' permission is not in your effective set here.';

  @override
  String get settingsRetry => 'Retry';

  @override
  String get settingsSaved => 'The settings were saved on the server.';

  @override
  String get settingsSaveWithheld =>
      'No answer arrived from the server; nothing was saved. Your changes remain in the fields.';

  @override
  String get settingsSaveRefused =>
      'The server refused the changes; review the values and try again.';

  @override
  String get settingsSaveValidationError => 'Fix the marked fields, then save.';

  @override
  String get settingsSavePermissionDenied =>
      'You do not have permission to change these fields.';

  @override
  String get settingsOwnerOnly => 'Owner only';

  @override
  String get settingsOwnerOnlyCaption =>
      'Only the organization\'s owner adjusts these.';

  @override
  String settingsUnsavedLine(int count) {
    return 'Unsaved changes: $count';
  }

  @override
  String get settingsSaveAction => 'Save';

  @override
  String get settingsCancelAction => 'Cancel';

  @override
  String get settingsReloadAction => 'Reload values';

  @override
  String get settingsKeepDraftAction => 'Keep my draft';

  @override
  String get settingsDiscardDraftAction => 'Discard my draft';

  @override
  String get settingsConfirmMaterialTitle => 'Confirm the policy change';

  @override
  String get settingsConfirmMaterialBody =>
      'This is a pricing or discount policy change; it takes effect on the server\'s upcoming decisions. Save?';

  @override
  String get settingsConflictTitle => 'The settings changed on the server';

  @override
  String get settingsConflictBody =>
      'The settings version changed while you were editing. Reload to see the authoritative values; your draft is not lost.';

  @override
  String get settingsSectionIdentity => 'Organization identity';

  @override
  String get settingsSectionMoney => 'Currency & display';

  @override
  String get settingsSectionInvoice => 'Invoices';

  @override
  String get settingsSectionSales => 'Sales';

  @override
  String get settingsSectionOffline => 'Offline settings';

  @override
  String get settingsFieldOrganizationName => 'Organization name';

  @override
  String get settingsFieldCurrency => 'Currency';

  @override
  String get settingsCurrencyEgp => 'Egyptian pound (EGP)';

  @override
  String get settingsFieldDisplayNumerals => 'Display numerals';

  @override
  String get settingsNumeralsWestern => 'Western digits';

  @override
  String get settingsNumeralsEastern => 'Eastern Arabic digits';

  @override
  String get settingsFieldInvoiceOutput => 'Default invoice output';

  @override
  String get settingsInvoiceAlwaysAsk => 'Always ask';

  @override
  String get settingsInvoicePrintAutomatically => 'Print automatically';

  @override
  String get settingsInvoiceNoAutomaticOutput => 'No automatic output';

  @override
  String get settingsFieldInvoiceFooter => 'Invoice footer';

  @override
  String get settingsFieldInvoiceShowLogo => 'Show organization logo';

  @override
  String get settingsFieldCustomerRequiredOnCredit =>
      'Customer required on credit sale';

  @override
  String get settingsFieldReceivablesAging => 'Receivables aging';

  @override
  String get settingsFieldOfflineGrace => 'Offline window duration (seconds)';

  @override
  String get settingsFieldReceiptFormat => 'Device receipt id format';

  @override
  String get settingsReceiptFormatOrgDevSeq => 'Organization-device-sequence';

  @override
  String get settingsFieldOfflineReservedBlocks =>
      'Offline reserved number blocks';

  @override
  String get settingsFieldReservedBlockSize => 'Reserved block size';

  @override
  String get settingsFieldMinorUnitExponent => 'Minor-unit exponent';

  @override
  String get settingsFieldRoundingMode => 'Rounding mode';

  @override
  String get settingsRoundingHalfUp => 'Half up (HALF_UP)';

  @override
  String get settingsRoundingHalfEven => 'Half even (HALF_EVEN)';

  @override
  String get settingsFeatureFlagsHeading => 'Feature flags';

  @override
  String get settingsFeatureFlagsEmpty =>
      'No flags are defined in this version.';

  @override
  String get settingsFieldNameError =>
      'The name is required and cannot be empty.';

  @override
  String get settingsFieldFooterError =>
      'The footer is longer than the accepted bound (2000 characters).';

  @override
  String get settingsFieldPricingMode => 'Pricing mode';

  @override
  String get settingsModeFixedName => 'Fixed price (FIXED)';

  @override
  String get settingsModeFixedDescription =>
      'The posted selling price is authoritative; prices do not move without a server-checked override permission.';

  @override
  String get settingsModeVariableName => 'Variable price (VARIABLE)';

  @override
  String get settingsModeVariableDescription =>
      'The price is entered by hand; a sale below cost is permitted and reported.';

  @override
  String get settingsModeFixedWithDiscountName =>
      'Fixed with discount (FIXED_WITH_DISCOUNT)';

  @override
  String get settingsModeFixedWithDiscountDescription =>
      'The base price stays fixed; the final price derives from the discount, inside the policy ceilings and the approval gate.';

  @override
  String get settingsSectionDiscountPolicy => 'Discount policy';

  @override
  String get settingsDiscountModeCaption =>
      'This policy applies in the \'fixed with discount\' mode, and the server re-checks it on every decision.';

  @override
  String get settingsFieldMaxDiscountPercentage =>
      'Maximum discount percentage (%)';

  @override
  String get settingsFieldMaxDiscountAmount =>
      'Maximum discount amount (minor units)';

  @override
  String get settingsFieldApprovalThreshold =>
      'Discount approval threshold (minor units)';

  @override
  String get settingsApprovalThresholdClearCaption =>
      'Clear the threshold (no approvals required)';

  @override
  String get settingsApprovalThresholdEmptyCaption =>
      'No threshold; approvals are never required.';

  @override
  String get settingsFieldSalespersonAllowed =>
      'Salespersons may apply discounts';

  @override
  String get settingsFieldBlockBelowCost => 'Block discounts below cost';

  @override
  String get settingsPercentageError =>
      'Not a valid percentage (0–100, at most two decimals).';

  @override
  String get settingsAmountError =>
      'Not a valid amount (a non-negative integer).';

  @override
  String get settingsAmountRangeError =>
      'The amount is outside the accepted bounds.';

  @override
  String get settingsReadonlyOfflineCaption =>
      'Not editable offline; the server owns the decision.';
}
