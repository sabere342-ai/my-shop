import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/api/authorization_api.dart';
import 'package:my_shop_desktop/features/settings/settings_gates.dart';

import 'settings_test_harness.dart';

/// Unit coverage of the §13.4 affordance matrix (A9, A1): the
/// `SettingsAccessResolver` never *enforces* (the server re-checks every
/// accepted write) but it must arrange controls with exactly these answers:
/// owner rows only for owners, permission-gated rows for the granted, and
/// **locked for the unreadable** — a missing profile locks everything, never
/// unlocks (§13.4: the client never guesses a permission it cannot verify).
void main() {
  EffectiveAuthorization profile(
    List<String> permissions, {
    bool isOwner = false,
  }) =>
      EffectiveAuthorization(
        organizationId: testOrganizationId,
        userId: testUserId,
        permissionsVersion: 3,
        isOwner: isOwner,
        roleKey: null,
        permissions: permissions,
      );

  group('settings.view (the hub denial copy)', () {
    test('view-permission holders can view; denied-away callers cannot', () {
      expect(
        SettingsAccessResolver(profile(viewerPermissions)).canView,
        isTrue,
      );
      expect(
        SettingsAccessResolver(profile(deniedPermissions)).canView,
        isFalse,
      );
      // DENY overrides: §11.4 is resolved server-side; this client mirrors
      // the resolved set, so a hold of `settings.view` absent from it is
      // already refused here.
      expect(
        SettingsAccessResolver(profile(
          <String>[SettingsPermission.settingsView],
        )).canView,
        isTrue,
      );
    });
  });

  group('owner-exclusive rows', () {
    const List<SettingsField> ownerRows = <SettingsField>[
      SettingsField.minorUnitExponent,
      SettingsField.roundingMode,
      SettingsField.offlineGraceDurationSeconds,
      SettingsField.reservedBlockSize,
      SettingsField.featureFlags,
    ];

    test('only the owner may operate them; even a full-permission non-owner '
        'is locked', () {
      for (final SettingsField field in ownerRows) {
        final SettingsFieldAccess owner =
            SettingsAccessResolver(profile(ownerPermissions, isOwner: true))
                .access(field);
        expect(owner.editable, isTrue, reason: '$field for the owner');
        expect(owner.ownerExclusive, isTrue);

        final SettingsFieldAccess nonOwner =
            SettingsAccessResolver(profile(ownerPermissions))
                .access(field);
        expect(nonOwner.editable, isFalse, reason: '$field for non-owner');
        expect(nonOwner.ownerExclusive, isTrue);
        expect(nonOwner.viewable, isTrue,
            reason: 'owner rows stay visible but read-only');
      }
    });
  });

  group('permission-gated rows', () {
    test('a held settings.edit unlocks the general fields; a held '
        'pricing.policy.edit unlocks the policy fields', () {
      final SettingsAccessResolver manager =
          SettingsAccessResolver(profile(managerPermissions));
      expect(
        manager.access(SettingsField.organizationName).editable,
        isTrue,
      );
      expect(manager.access(SettingsField.currency).editable, isTrue);
      expect(manager.access(SettingsField.invoiceFooter).editable, isTrue);
      expect(manager.access(SettingsField.pricingMode).editable, isTrue);
      expect(
        manager.access(SettingsField.maxDiscountPercentage).editable,
        isTrue,
      );
      expect(
        manager.access(SettingsField.discountApprovalThresholdMinor).editable,
        isTrue,
      );
      expect(manager.mayEditArea(SettingsEditingArea.general), isTrue);
      expect(manager.mayEditArea(SettingsEditingArea.pricingPolicy), isTrue);
      expect(manager.mayEditPricing, isTrue);
    });

    test('a profile without pricing.policy.edit locks exactly the policy '
        'fields and nothing else', () {
      final SettingsAccessResolver withoutPricing = SettingsAccessResolver(
        profile(<String>[
          SettingsPermission.settingsView,
          SettingsPermission.settingsEdit,
        ]),
      );
      expect(
        withoutPricing.access(SettingsField.organizationName).editable,
        isTrue,
      );
      for (final SettingsField field in const <SettingsField>[
        SettingsField.pricingMode,
        SettingsField.maxDiscountPercentage,
        SettingsField.maxDiscountAmountMinor,
        SettingsField.discountApprovalThresholdMinor,
        SettingsField.discountAllowedForSalesperson,
        SettingsField.blockDiscountBelowCost,
      ]) {
        expect(
          withoutPricing.access(field).editable,
          isFalse,
          reason: '$field without the gate',
        );
      }
      expect(
        withoutPricing.mayEditArea(SettingsEditingArea.pricingPolicy),
        isFalse,
      );
      expect(withoutPricing.mayEditPricing, isFalse);
      // The save affordance's honesty: an area with zero editable fields
      // offers no save row at all.
      expect(withoutPricing.mayEditArea(SettingsEditingArea.general), isTrue);
    });

    test('a fields-locked profile generally locks its own area(s) only, '
        'per the §22.2 column', () {
      final SettingsAccessResolver allLocked = SettingsAccessResolver(
        profile(deniedPermissions),
      );
      expect(
        allLocked.access(SettingsField.organizationName).editable,
        isFalse,
      );
      expect(
        allLocked.access(SettingsField.pricingMode).editable,
        isFalse,
      );
      expect(allLocked.mayEditArea(SettingsEditingArea.general), isFalse);
      expect(allLocked.mayEditPricing, isFalse);
    });
  });

  group('the unreadable profile (§13.4)', () {
    test('a missing authorization profile locks every control — never '
        'unlocks anything', () {
      const SettingsAccessResolver unreadable = SettingsAccessResolver(null);
      for (final SettingsField field in SettingsField.values) {
        final SettingsFieldAccess access = unreadable.access(field);
        expect(access.editable, isFalse, reason: '$field must stay locked');
        expect(access.viewable, isTrue, reason: '$field stays displayable');
      }
      expect(unreadable.canView, isFalse);
      expect(unreadable.mayEditArea(SettingsEditingArea.general), isFalse);
      expect(unreadable.mayEditPricing, isFalse);
    });
  });
}
