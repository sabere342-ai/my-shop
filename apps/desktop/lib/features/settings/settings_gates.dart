/// The client-side mirror of §22.2/§22.4's permission column — the
/// affordance layer only (mission §8: UI gating is never a substitute for
/// backend authorization; every value here arranges controls, the server
/// re-checks everything it accepts).
///
/// Two sources shape the answer, both server-derived facts rather than role
/// names (§11.4):
///
/// - the **effective permission set** and `isOwner` from `authorization/me`;
/// - the server's own §22.2 column, transcribed once as data (which
///   permission id gates each field, and which fields are owner-exclusive).
///
/// A field whose gate is unreadable (the authorization profile missing or a
/// transport failure) is necessarily **locked** — the client never guesses a
/// permission it cannot verify (§13.4).
library;

import 'package:my_shop_desktop/core/api/authorization_api.dart'
    show EffectiveAuthorization;
/// The §22.2/§22.4 permission ids the field column uses.
abstract final class SettingsPermission {
  static const String settingsView = 'settings.view';
  static const String settingsEdit = 'settings.edit';
  static const String pricingPolicyEdit = 'pricing.policy.edit';
}

/// The field inventory, named as one closed set.
enum SettingsField {
  organizationName,
  currency,
  minorUnitExponent,
  displayNumerals,
  pricingMode,
  maxDiscountPercentage,
  maxDiscountAmountMinor,
  discountApprovalThresholdMinor,
  discountAllowedForSalesperson,
  blockDiscountBelowCost,
  invoiceOutputDefault,
  invoiceFooter,
  invoiceShowLogo,
  customerRequiredOnCreditSale,
  roundingMode,
  receivablesAgingEnabled,
  offlineGraceDurationSeconds,
  offlineReceiptIdFormat,
  offlineReservedNumberBlocks,
  reservedBlockSize,
  featureFlags,
}

/// Which organization settings are on a general or pricing screen.
enum SettingsEditingArea { general, pricingPolicy }

/// The transcribed §22.2/§22.4 column.
extension SettingsFieldGateX on SettingsField {
  /// The permission id this field's accepted write must present, or `null`
  /// when only the organization's owner may write it (§22.2 rows whose
  /// permission cell reads "owner-exclusive").
  String? get requiredPermissionId {
    return switch (this) {
      SettingsField.minorUnitExponent ||
      SettingsField.roundingMode ||
      SettingsField.offlineGraceDurationSeconds ||
      SettingsField.reservedBlockSize ||
      SettingsField.featureFlags =>
        null,
      SettingsField.pricingMode ||
      SettingsField.maxDiscountPercentage ||
      SettingsField.maxDiscountAmountMinor ||
      SettingsField.discountApprovalThresholdMinor ||
      SettingsField.discountAllowedForSalesperson ||
      SettingsField.blockDiscountBelowCost =>
        SettingsPermission.pricingPolicyEdit,
      _ => SettingsPermission.settingsEdit,
    };
  }

  /// The screen area the field administers on.
  SettingsEditingArea get area => switch (this) {
        SettingsField.pricingMode ||
        SettingsField.maxDiscountPercentage ||
        SettingsField.maxDiscountAmountMinor ||
        SettingsField.discountApprovalThresholdMinor ||
        SettingsField.discountAllowedForSalesperson ||
        SettingsField.blockDiscountBelowCost =>
          SettingsEditingArea.pricingPolicy,
        _ => SettingsEditingArea.general,
      };
}

/// The control answer for one field, given the effective profile.
final class SettingsFieldAccess {
  const SettingsFieldAccess._({
    required this.viewable,
    required this.editable,
    required this.ownerExclusive,
    required this.granted,
  });

  /// Whether the field may be rendered as a control at all.
  final bool viewable;

  /// Whether the control may accept input. `false` renders the field
  /// disabled with its owner-exclusive or permission caption. The §22.2
  /// permission column decides; the server remains the enforcement point.
  final bool editable;

  /// The field is owner-only (§22.2 owner-exclusive rows) — used by the UI
  /// caption.
  final bool ownerExclusive;

  /// The gate was actually granted for this caller (true for owner rows
  /// when the actor is the owner).
  final bool granted;
}

/// Resolves the §22.2 affordance matrix for one display.
final class SettingsAccessResolver {
  const SettingsAccessResolver(this.authorization);

  final EffectiveAuthorization? authorization;

  SettingsFieldAccess access(SettingsField field) {
    final EffectiveAuthorization? profile = authorization;
    final String? gate = field.requiredPermissionId;
    final bool ownerExclusive = gate == null;
    if (profile == null) {
      return SettingsFieldAccess._(
        viewable: true,
        editable: false,
        ownerExclusive: ownerExclusive,
        granted: false,
      );
    }
    if (ownerExclusive) {
      final bool granted = profile.isOwner;
      return SettingsFieldAccess._(
        viewable: true,
        editable: granted,
        ownerExclusive: true,
        granted: granted,
      );
    }
    final bool granted = profile.has(gate);
    return SettingsFieldAccess._(
      viewable: true,
      editable: granted,
      ownerExclusive: false,
      granted: granted,
    );
  }

  /// Whether the actor may see the settings surfaces at all (§22.2
  /// `settings.view`). The hub decides its denial copy with this.
  bool get canView => authorization?.has(SettingsPermission.settingsView) ?? false;

  /// Whether either screening area has any editable field for this caller —
  /// the editor screens use it to place their save affordance honestly.
  bool mayEditArea(SettingsEditingArea area) {
    final Iterable<SettingsField> fields = SettingsField.values.where(
      (SettingsField field) => field.area == area,
    );
    return fields.any((SettingsField field) => access(field).editable);
  }

  /// Whether any field on the pricing screen is editable for this caller.
  bool get mayEditPricing => mayEditArea(SettingsEditingArea.pricingPolicy);
}
