import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/features/settings/models/organization_settings.dart';

import 'settings_test_harness.dart';

/// Unit coverage of the §22.1 typed-settings parser (A10, A3): every
/// acceptance row that says "the client refuses to guess" is executable
/// here — the money grammar, the percentage ceiling in exact scaled space,
/// the closed enum vocabularies, and the refusal shape (the offending field
/// is always named).
void main() {
  group('canonical payload parses into the typed record', () {
    test('parses every §22.2/§22.4 field exactly', () {
      final settings = OrganizationSettings.fromWire(
        settingsPayload(
          settingsVersion: 12,
          maxDiscountPercentage: 12.25,
          maxDiscountAmountMinor: '9223372036854775807',
        ),
      );

      expect(settings.organizationId, testOrganizationId);
      expect(settings.settingsVersion, 12);
      expect(settings.organizationName, 'مطعم النور');
      expect(settings.currency, CurrencyCode.egp);
      expect(settings.minorUnitExponent, 2);
      expect(settings.displayNumerals, DisplayNumerals.western);
      expect(settings.pricingMode, PricingMode.fixed);
      expect(settings.maxDiscountPercentageScaled, 1225,
          reason: '12.25 scaling is exact integer hundredths');
      // A 64-bit money value survives as a BigInt, never a double.
      expect(settings.maxDiscountAmountMinor,
          BigInt.parse('9223372036854775807'));
      expect(settings.discountApprovalThresholdMinor, isNull,
          reason: 'the §22.2 nullable approval gate is "off" when null');
      expect(settings.invoiceOutputDefault, InvoiceOutputDefault.alwaysAsk);
      expect(settings.roundingMode, RoundingMode.halfUp);
      expect(settings.offlineGraceDurationSeconds, 900);
      expect(settings.reservedBlockSize, 100);
      expect(settings.featureFlags, isEmpty);
    });

    test('nullable money fields accept explicit values and parse them as BigInt',
        () {
      final settings = OrganizationSettings.fromWire(
        settingsPayload(
          discountApprovalThresholdMinor: '50000',
          maxDiscountPercentage: 0,
        ),
      );
      expect(settings.discountApprovalThresholdMinor, BigInt.from(50000));
      expect(settings.maxDiscountPercentageScaled, 0);
    });

    test('a zero discount ceiling is stated, not defaulted', () {
      final settings = OrganizationSettings.fromWire(
        settingsPayload(maxDiscountPercentage: 0),
      );
      expect(settings.maxDiscountPercentageScaled, 0);
      expect(settings.maxDiscountPercentageText, '0');
    });
  });

  group('refusals name the offending field (§22.1 fail closed)', () {
    test('an unknown enum value refuses the snapshot', () {
      void refuse({required String field, required Map<String, Object?> over}) {
        expect(
          () => OrganizationSettings.fromWire(settingsPayload(overrides: over)),
          throwsA(isA<InvalidSettingsException>()
              .having((InvalidSettingsException error) => error.field, 'field',
                  field)),
        );
      }

      refuse(field: 'currency', over: {'currency': 'USD'});
      refuse(field: 'displayNumerals', over: {'displayNumerals': 'NON'});
      refuse(field: 'pricingMode', over: {'pricingMode': 'MARKET'});
      refuse(field: 'roundingMode', over: {'roundingMode': 'CEILING'});
      refuse(
        field: 'invoiceOutputDefault',
        over: {'invoiceOutputDefault': 'SEND_VIA_FAX'},
      );
      refuse(
        field: 'offlineReceiptIdFormat',
        over: {'offlineReceiptIdFormat': 'RANDOM'},
      );
    });

    test('a wrong-typed money value refuses (money is a decimal string)', () {
      expect(
        () => OrganizationSettings.fromWire(
          settingsPayload(overrides: {'maxDiscountAmountMinor': 100000}),
        ),
        throwsA(isA<InvalidSettingsException>().having(
          (InvalidSettingsException error) => error.field,
          'field',
          'maxDiscountAmountMinor',
        )),
      );
    });

    test('negative money refuses', () {
      expect(
        () => OrganizationSettings.fromWire(settingsPayload(
          discountApprovalThresholdMinor: '-1',
        )),
        throwsA(isA<InvalidSettingsException>()),
      );
    });

    test('more than 19 digits refuses (64-bit bound)', () {
      expect(
        () => OrganizationSettings.fromWire(
          settingsPayload(overrides: {'maxDiscountAmountMinor': '1' * 20}),
        ),
        throwsA(isA<InvalidSettingsException>()
            .having(
              (InvalidSettingsException error) => error.reason,
              'reason',
              contains('64-bit'),
            )),
      );
    });

    test('a percentage above the §18 bound refuses', () {
      expect(
        () => OrganizationSettings.fromWire(
          settingsPayload(overrides: {'maxDiscountPercentage': 100.5}),
        ),
        throwsA(isA<InvalidSettingsException>()),
      );
      expect(
        () => OrganizationSettings.fromWire(
          settingsPayload(overrides: {'maxDiscountPercentage': -1}),
        ),
        throwsA(isA<InvalidSettingsException>()),
      );
    });

    test('more than two fraction digits on the percentage refuses', () {
      expect(
        () => OrganizationSettings.fromWire(
          settingsPayload(overrides: {'maxDiscountPercentage': 12.345}),
        ),
        throwsA(isA<InvalidSettingsException>()
            .having(
              (InvalidSettingsException error) => error.reason,
              'reason',
              contains('fraction'),
            )),
      );
    });

    test('a missing field refuses with the field name', () {
      final Map<String, Object?> payload = settingsPayload();
      payload.remove('currency');
      expect(
        () => OrganizationSettings.fromWire(payload),
        throwsA(isA<InvalidSettingsException>()
            .having((InvalidSettingsException error) => error.field, 'field',
                'currency')),
      );
    });

    test('an out-of-range clamp candidate refuses (grace seconds)',
        () {
      expect(
        () =>
            OrganizationSettings.fromWire(settingsPayload(
              offlineGraceDurationSeconds: 0,
            )),
        throwsA(isA<InvalidSettingsException>()
            .having((InvalidSettingsException error) => error.field, 'field',
                'offlineGraceDurationSeconds')),
      );
    });

    test('an unparseable timestamp refuses', () {
      expect(
        () => OrganizationSettings.fromWire(
          settingsPayload(overrides: {'updatedAt': 'not a time'}),
        ),
        throwsA(isA<InvalidSettingsException>()
            .having((InvalidSettingsException error) => error.field, 'field',
                'updatedAt')),
      );
    });

    test('a feature flag row with an unreadable shape refuses', () {
      expect(
        () => OrganizationSettings.fromWire(
          settingsPayload(featureFlags: <Object?>[<String, Object?>{'key': 1}]),
        ),
        throwsA(isA<InvalidSettingsException>()
            .having((InvalidSettingsException error) => error.field, 'field',
                'featureFlags')),
      );
    });
  });

  group('PercentageSemantics', () {
    test('parses the published grammar exactly', () {
      expect(
          PercentageSemantics.parseScaled('0'), 0, reason: 'zero is stated');
      expect(PercentageSemantics.parseScaled('100'), 10000);
      expect(PercentageSemantics.parseScaled('33.5'), 3350);
      expect(PercentageSemantics.parseScaled('33.33'), 3333);
      expect(PercentageSemantics.parseScaled('0.05'), 5);
      expect(PercentageSemantics.parseScaled('12.25'), 1225);
      expect(PercentageSemantics.parseScaled(' 12.25 '), 1225,
          reason: 'surrounding blanks trim');
    });

    test('refuses signs, exponents, 3dp and out-of-bound values', () {
      for (final String bad in const <String>['-1', '+1', '1e2', '1.234', '100.01', '120', 'forever', '', '1,5']) {
        expect(
          () => PercentageSemantics.parseScaled(bad),
          throwsA(isA<InvalidSettingsException>()),
          reason: '"$bad" is not the §18 grammar and must refuse',
        );
      }
    });

    test('renderScaled is the exact inverse', () {
      for (final int scaled in const <int>[0, 5, 1225, 3350, 9999, 10000]) {
        expect(
          PercentageSemantics.parseScaled(PercentageSemantics.renderScaled(scaled)),
          scaled,
          reason: 'render→parse of $scaled must round-trip',
        );
      }
      expect(PercentageSemantics.renderScaled(1225), '12.25');
      expect(PercentageSemantics.renderScaled(3400), '34');
      expect(PercentageSemantics.renderScaled(10000), '100');
    });

    test('the maximum is 100.00, the negativity bound is zero', () {
      expect(PercentageSemantics.maxScaled, 10000);
      expect(() => PercentageSemantics.parseScaled('-0.1'),
          throwsA(isA<InvalidSettingsException>()));
    });
  });
}
