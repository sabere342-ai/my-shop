import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/features/settings/models/organization_settings.dart';
import 'package:my_shop_desktop/features/settings/models/settings_draft.dart';

/// Unit coverage of the editing drafts (A3, A10): the §22.3 field-authorized
/// partial update must re-send **only** touched fields, the nullable
/// threshold clearing must cross as an explicit null, and the percentage /
/// money grammars must refuse everything they cannot parse exactly.
void main() {
  group('GeneralSettingsDraft', () {
    test('an untouched draft sends only the version token', () {
      final GeneralSettingsDraft draft = GeneralSettingsDraft();
      expect(draft.hasChanges, isFalse);
      expect(draft.changedFieldCount, 0);
      expect(draft.requestBody(9), <String, Object?>{'settingsVersion': 9});
    });

    test('each touched field appears exactly once in the body', () {
      final GeneralSettingsDraft draft = GeneralSettingsDraft()
        ..setOrganizationName('  نور  ')
        ..setInvoiceShowLogo(false)
        ..setCurrency(CurrencyCode.egp);

      expect(draft.changedFieldCount, 3);
      expect(draft.requestBody(4), <String, Object?>{
        'settingsVersion': 4,
        'organizationName': 'نور',
        'invoiceShowLogo': false,
        'currency': 'EGP',
      });
    });

    test('the offered values stay readable for the controls', () {
      final GeneralSettingsDraft draft = GeneralSettingsDraft();
      expect(draft.currency, isNull);
      draft.setDisplayNumerals(DisplayNumerals.easternArabic);
      expect(draft.displayNumerals, DisplayNumerals.easternArabic);
      expect(draft.hasChanges, isTrue);
      draft.reset();
      expect(draft.displayNumerals, isNull, reason: 'reset discards offers');
      expect(draft.hasChanges, isFalse);
    });

    test('validation refuses an all-whitespace name', () {
      final GeneralSettingsDraft draft = GeneralSettingsDraft()
        ..setOrganizationName('   ');
      expect(draft.validate(), contains(SettingsDraftError.organizationNameEmpty));
    });

    test('validation refuses a footer over the length bound', () {
      final GeneralSettingsDraft draft = GeneralSettingsDraft()
        ..setInvoiceFooter('x' * 2001);
      expect(
        draft.validate(),
        contains(SettingsDraftError.invoiceFooterTooLong),
      );
      expect(draft.validate(invoiceFooterMaxLength: 2001), isEmpty,
          reason: 'the bound is the caller-published contract, not a constant');
    });
  });

  group('PricingPolicyDraft', () {
    test('an untouched draft sends only the version token', () {
      final PricingPolicyDraft draft = PricingPolicyDraft();
      expect(draft.hasChanges, isFalse);
      expect(draft.requestBody(3), <String, Object?>{'settingsVersion': 3});
    });

    test('a whole-hundredths percentage crosses as a JSON integer', () {
      final PricingPolicyDraft draft = PricingPolicyDraft()
        ..setPercentageText('34');
      expect(draft.requestBody(1), <String, Object?>{
        'settingsVersion': 1,
        'maxDiscountPercentage': 34,
      });
    });

    test('a fractional percentage crosses at exactly two fraction digits', () {
      final PricingPolicyDraft draft = PricingPolicyDraft()
        ..setPercentageText('12.25');
      final Map<String, Object?> body = draft.requestBody(1);
      expect(body['maxDiscountPercentage'], 12.25);
      // No float drift: the number must still read 12.25 exactly.
      expect((body['maxDiscountPercentage'] as num).toString(), '12.25');
    });

    test('money crosses as decimal strings', () {
      final PricingPolicyDraft draft = PricingPolicyDraft()
        ..setMaxAmountText('9223372036854775807');
      expect(draft.requestBody(1), <String, Object?>{
        'settingsVersion': 1,
        'maxDiscountAmountMinor': '9223372036854775807',
      });
    });

    test('clearing the threshold crosses as an explicit null (§22.2)', () {
      final PricingPolicyDraft draft = PricingPolicyDraft()..setThresholdText('');
      expect(draft.hasChanges, isTrue,
          reason: 'a clearing is a change, distinct from leaving the field alone');
      expect(draft.thresholdCleared, isTrue);
      expect(draft.thresholdText, '');
      final Map<String, Object?> body = draft.requestBody(2);
      expect(body.containsKey('discountApprovalThresholdMinor'), isTrue);
      expect(body['discountApprovalThresholdMinor'], isNull);
    });

    test('typing a threshold crosses its decimal string', () {
      final PricingPolicyDraft draft = PricingPolicyDraft()
        ..setThresholdText('75000');
      final Map<String, Object?> body = draft.requestBody(2);
      expect(body['discountApprovalThresholdMinor'], '75000');
    });

    test('an empty typed threshold without clearing does not send the field',
        () {
      // Defensive: only setThresholdText marks a change; a caller that never
      // touches the field keeps the version-only body.
      final PricingPolicyDraft draft = PricingPolicyDraft();
      expect(draft.requestBody(2), <String, Object?>{'settingsVersion': 2});
    });

    test('percentage validation refuses the grammatically impossible', () {
      for (final String bad in const <String>['', '   ', 'abc', '1.234', '-1', '100.01']) {
        final PricingPolicyDraft draft = PricingPolicyDraft()..setPercentageText(bad);
        expect(
          draft.validate(),
          contains(SettingsDraftError.percentageInvalid),
          reason: '"$bad" must refuse',
        );
      }
    });

    test('amount validation refuses malformed and 64-bit-overflowing integers',
        () {
      final PricingPolicyDraft malformed = PricingPolicyDraft()
        ..setMaxAmountText('12.5');
      expect(malformed.validate(), contains(SettingsDraftError.amountInvalid));
      // The typed grammar refuses anything above 19 digits outright…
      final PricingPolicyDraft tooLong = PricingPolicyDraft()
        ..setMaxAmountText('92233720368547758080');
      expect(tooLong.validate(), contains(SettingsDraftError.amountInvalid));
      // …and a 19-digit figure above the signed 64-bit bound is a range error.
      final PricingPolicyDraft overflow = PricingPolicyDraft()
        ..setMaxAmountText('9999999999999999999');
      expect(overflow.validate(), contains(SettingsDraftError.amountOutOfRange));
    });

    test('a malformed threshold refusing text is a validation error', () {
      final PricingPolicyDraft draft = PricingPolicyDraft()
        ..setThresholdText('nope');
      expect(draft.validate(), contains(SettingsDraftError.amountInvalid));
    });

    test('mode changes ride in the body as the wire vocabulary', () {
      final PricingPolicyDraft draft = PricingPolicyDraft()
        ..setPricingMode(PricingMode.fixedWithDiscount)
        ..setSalespersonAllowed(false)
        ..setBlockBelowCost(true);
      expect(draft.requestBody(5), <String, Object?>{
        'settingsVersion': 5,
        'pricingMode': 'FIXED_WITH_DISCOUNT',
        'discountAllowedForSalesperson': false,
        'blockDiscountBelowCost': true,
      });
      expect(draft.changedFieldCount, 3);
    });

    test('reset discards every offer including the cleared threshold', () {
      final PricingPolicyDraft draft = PricingPolicyDraft()
        ..setThresholdText('')
        ..setPricingMode(PricingMode.variable);
      draft.reset();
      expect(draft.hasChanges, isFalse);
      expect(draft.thresholdCleared, isFalse);
      expect(
        draft.requestBody(1),
        <String, Object?>{'settingsVersion': 1},
      );
    });
  });
}
