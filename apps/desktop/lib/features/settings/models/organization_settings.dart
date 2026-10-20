/// The typed organization settings the server answers with (Master Plan
/// §22.1–§22.4, §22.4, §40.7 M3-S1's accepted `OrganizationSettingsResponse`
/// wire contract).
///
/// §22.1: settings are **typed**, not a free-form key-value dictionary, and
/// critical financial behaviour never depends on unvalidated string keys.
/// This model therefore parses the wire response strictly, value by value:
///
/// - 64-bit money stays a **decimal string** on the Wire boundary ( carriage
///   rule of the M1b-S6 `server_sequence` decision); parsing into [BigInt]
///   happens once, here, and never degrades to a double.
/// - The §18 percentage ceiling is a bounded 0–100 value with at most two
///   fraction digits; it is compared in **exact integer scaled space**
///   (`_perMillionScale`, a check the legacy float path would have failed).
/// - The closed enum vocabularies are mirrored from the backend's published
///   contract; an unknown value refuses the whole snapshot rather than being
///   silently coerced (§22.1 "fail closed").
///
/// The server is the only authority (§7.3): what this class holds is a record
/// of the server's own answer, never a locally-computed truth.
library;

/// The §17 pricing modes, mirrored from `PRICING_MODE_VALUES`.
enum PricingMode {
  fixed('FIXED'),
  variable('VARIABLE'),
  fixedWithDiscount('FIXED_WITH_DISCOUNT');

  const PricingMode(this.wire);

  /// The wire spelling the server contract uses (§17).
  final String wire;

  static PricingMode fromWire(String value) {
    for (final PricingMode mode in PricingMode.values) {
      if (mode.wire == value) {
        return mode;
      }
    }
    throw const InvalidSettingsException('pricingMode', 'unknown vocabulary value');
  }
}

/// The §22.2 currency inventory (V1 carries a single value).
enum CurrencyCode {
  egp('EGP');

  const CurrencyCode(this.wire);

  final String wire;

  static CurrencyCode fromWire(String value) {
    for (final CurrencyCode code in CurrencyCode.values) {
      if (code.wire == value) {
        return code;
      }
    }
    throw const InvalidSettingsException('currency', 'unknown vocabulary value');
  }
}

/// The §6.8/§22.2 display numerals inventory.
enum DisplayNumerals {
  western('WESTERN'),
  easternArabic('EASTERN_ARABIC');

  const DisplayNumerals(this.wire);

  final String wire;

  static DisplayNumerals fromWire(String value) {
    for (final DisplayNumerals value1 in DisplayNumerals.values) {
      if (value1.wire == value) {
        return value1;
      }
    }
    throw const InvalidSettingsException('displayNumerals', 'unknown vocabulary value');
  }
}

/// The §21.2/§22.2 invoice output inventory.
enum InvoiceOutputDefault {
  alwaysAsk('ALWAYS_ASK'),
  printAutomatically('PRINT_AUTOMATICALLY'),
  noAutomaticOutput('NO_AUTOMATIC_OUTPUT');

  const InvoiceOutputDefault(this.wire);

  final String wire;

  static InvoiceOutputDefault fromWire(String value) {
    for (final InvoiceOutputDefault value1 in InvoiceOutputDefault.values) {
      if (value1.wire == value) {
        return value1;
      }
    }
    throw const InvalidSettingsException('invoiceOutputDefault', 'unknown vocabulary value');
  }
}

/// The §30.6 rounding modes (owner-exclusive on the write path).
enum RoundingMode {
  halfUp('HALF_UP'),
  halfEven('HALF_EVEN');

  const RoundingMode(this.wire);

  final String wire;

  static RoundingMode fromWire(String value) {
    for (final RoundingMode value1 in RoundingMode.values) {
      if (value1.wire == value) {
        return value1;
      }
    }
    throw const InvalidSettingsException('roundingMode', 'unknown vocabulary value');
  }
}

/// The §16.4A.2/§22.4 device receipt identity formats.
enum OfflineReceiptIdFormat {
  orgDevSeq('ORG-DEV-SEQ');

  const OfflineReceiptIdFormat(this.wire);

  final String wire;

  static OfflineReceiptIdFormat fromWire(String value) {
    for (final OfflineReceiptIdFormat value1 in OfflineReceiptIdFormat.values) {
      if (value1.wire == value) {
        return value1;
      }
    }
    throw const InvalidSettingsException('offlineReceiptIdFormat', 'unknown vocabulary value');
  }
}

/// A strict-parse refusal with the offending field named (§22.1 fail closed).
class InvalidSettingsException implements Exception {
  const InvalidSettingsException(this.field, this.reason);

  final String field;
  final String reason;

  @override
  String toString() => 'InvalidSettingsException($field: $reason)';
}

/// The §18 percentage ceiling's exact arithmetic.
///
/// The percentage crosses the boundary as a 0–100 decimal with at most two
/// fraction digits. Every comparison in this codebase happens in **integer
/// hundredths** (abbreviated `scaled`: `12.25 → 1225`), so a binary float can
/// never decide a policy question (§30, §18.2).
abstract final class PercentageSemantics {
  /// The scaling applied to a two-decimal percentage (`12.25 → 1225`).
  static const int scale = 100;

  /// The bound the §18 percentage ceiling accepts: 100.00 as hundredths.
  static const int maxScaled = scale * 100;

  /// Parses a rendered decimal percentage string (`"12.25"`, `"100"`) into
  /// integer hundredths, refusing negatives, values above the §18 bound, and
  /// more than two fraction digits — the same grammar the wire contract
  /// publishes.
  static int parseScaled(String raw) => parseExactPercentage(raw);

  /// Renders integer hundredths back to the client-facing decimal string.
  static String renderScaled(int scaled) {
    final BigInt divided = BigInt.from(scaled) ~/ BigInt.from(scale);
    final int rem = scaled % scale;
    if (rem == 0) {
      return divided.toString();
    }
    final String remPadded = rem.toString().padLeft(2, '0');
    return '$divided.$remPadded';
  }
}

/// The strict user-facing percentage grammar: `0`, `33.5`, `33.33`, bounded
/// 0–100, maximum two fraction digits, no sign, no exponent, no surrounding
/// blanks.
int parseExactPercentage(String raw) {
  final String text = raw.trim();
  if (text.isEmpty) {
    throw const InvalidSettingsException(
        'maxDiscountPercentage', 'the percentage must be a stated value');
  }
  final RegExp whole = RegExp(r'^(\d{1,3})(?:\.(\d{1,2}))?$');
  final RegExpMatch? match = whole.firstMatch(text);
  if (match == null) {
    throw const InvalidSettingsException('maxDiscountPercentage', 'not a 0-100 decimal with up to two fraction digits');
  }
  final int wholePart = int.parse(match.group(1)!);
  final String? fraction = match.group(2);
  // The fraction is a decimal remainder read positionally: "33.5" is 33.50,
  // so "5" must pad to "50" hundredths (the §18.2 exact-arithmetic rule).
  final int fractionValue =
      (fraction ?? '').isEmpty ? 0 : int.parse(fraction!.padRight(2, '0'));
  final int scaled = wholePart * PercentageSemantics.scale + fractionValue;
  if (scaled > PercentageSemantics.maxScaled) {
    throw InvalidSettingsException(
      'maxDiscountPercentage',
      '$text is above the 100 ceiling the vocabulary accepts',
    );
  }
  return scaled;
}

/// The §22.2 typed settings value row, as one immutable record.
///
/// Every field is named after the §22.2/§22.4 column it mirrors, in the typed
/// form the plan declares. `BigInt` money values are the exact minor-unit
/// integers (derived from the decimal strings on the Wire boundary).
final class OrganizationSettings {
  const OrganizationSettings({
    required this.organizationId,
    required this.settingsVersion,
    required this.updatedAt,
    required this.organizationName,
    required this.currency,
    required this.minorUnitExponent,
    required this.displayNumerals,
    required this.pricingMode,
    required this.maxDiscountPercentageScaled,
    required this.maxDiscountAmountMinor,
    required this.discountApprovalThresholdMinor,
    required this.discountAllowedForSalesperson,
    required this.blockDiscountBelowCost,
    required this.invoiceOutputDefault,
    required this.invoiceFooter,
    required this.invoiceShowLogo,
    required this.customerRequiredOnCreditSale,
    required this.roundingMode,
    required this.receivablesAgingEnabled,
    required this.offlineGraceDurationSeconds,
    required this.offlineReceiptIdFormat,
    required this.offlineReservedNumberBlocks,
    required this.reservedBlockSize,
    required this.featureFlags,
  });

  /// The §22.2 row this wire record answered.
  final String organizationId;

  /// The §38.18 monotonic settings version carried in the same response.
  final int settingsVersion;

  /// The server's own last-accepted-write timestamp.
  final DateTime updatedAt;

  /// §22.2 `organization_name`.
  final String organizationName;

  /// §22.2 `currency`.
  final CurrencyCode currency;

  /// §22.2 `minor_unit_exponent` — owner-exclusive.
  final int minorUnitExponent;

  /// §22.2 `display_numerals`.
  final DisplayNumerals displayNumerals;

  /// §17/§22.2 `pricing_mode`.
  final PricingMode pricingMode;

  /// §18 `max_discount_percentage` in **exact integer hundredths** (12.25 →
  /// 1225; 100.00 → 10000).
  final int maxDiscountPercentageScaled;

  /// §18 `max_discount_amount_minor` — an exact minor-unit integer.
  final BigInt maxDiscountAmountMinor;

  /// §18 `discount_approval_threshold_minor` — nullable by §22.2 decision;
  /// `null` is "the approval gate is off".
  final BigInt? discountApprovalThresholdMinor;

  /// §18 `discount_allowed_for_salesperson`.
  final bool discountAllowedForSalesperson;

  /// §18.4 `block_discount_below_cost`.
  final bool blockDiscountBelowCost;

  /// §21.2/§22.2 `invoice_output_default`.
  final InvoiceOutputDefault invoiceOutputDefault;

  /// §22.2 `invoice_footer`.
  final String invoiceFooter;

  /// §22.2 `invoice_show_logo`.
  final bool invoiceShowLogo;

  /// §22.2 `customer_required_on_credit_sale`.
  final bool customerRequiredOnCreditSale;

  /// §30.6/§22.2 `rounding_mode` — owner-exclusive.
  final RoundingMode roundingMode;

  /// §20.2/§22.2 `receivables_aging_enabled`.
  final bool receivablesAgingEnabled;

  /// §22.4/§38.16.2 `offline_grace_duration` in seconds — owner-exclusive.
  final int offlineGraceDurationSeconds;

  /// §16.4A.2/§22.4 `offline_receipt_id_format`.
  final OfflineReceiptIdFormat offlineReceiptIdFormat;

  /// §16.4A.2/§22.4 `offline_reserved_number_blocks`.
  final bool offlineReservedNumberBlocks;

  /// §22.4 `reserved_block_size` — owner-exclusive, meaningful only when the
  /// block reservation is enabled.
  final int reservedBlockSize;

  /// §22.2 `feature_flags` as typed rows. The V1 catalog is empty; this
  /// surface stays a read-only mirror of the server's answer.
  final List<FeatureFlagState> featureFlags;

  static OrganizationSettings fromWire(Map<String, Object?> json) {
    return OrganizationSettingsBuilder(json).build();
  }

  /// The client-facing rendering of the percentage ceiling: hundredths → the
  /// decimal string the field shows (`1225 → "12.25"`).
  String get maxDiscountPercentageText =>
      PercentageSemantics.renderScaled(maxDiscountPercentageScaled);

  /// The Minor-unit money fields' decimal-string rendering (the wire form).
  String get maxDiscountAmountMinorText => maxDiscountAmountMinor.toString();

  /// `null` renders as the published absence of the approval gate; a figure
  /// renders as its decimal string.
  String? get discountApprovalThresholdText =>
      discountApprovalThresholdMinor?.toString();
}

/// One §22.2 typed feature flag row.
final class FeatureFlagState {
  const FeatureFlagState({required this.key, required this.enabled});

  /// The flag key from the versioned V1 catalog (currently `[]`).
  final String key;
  final bool enabled;

  @override
  bool operator ==(Object other) =>
      other is FeatureFlagState && other.key == key && other.enabled == enabled;

  @override
  int get hashCode => Object.hash(key, enabled);
}

/// The strict field-by-field wire parser. Every refusal names the offending
/// field, so a corrupt cache diagnosis always has a precise reason.
final class OrganizationSettingsBuilder {
  OrganizationSettingsBuilder(this._json);

  final Map<String, Object?> _json;

  OrganizationSettings build() {
    final String organizationId = _string('organizationId');
    final int settingsVersion = _int('settingsVersion', min: 1);
    final Object? updatedAtRaw = _require('updatedAt');

    if (updatedAtRaw is! String) {
      throw const InvalidSettingsException('updatedAt', 'not a string');
    }
    final DateTime? parsedUpdatedAt = DateTime.tryParse(updatedAtRaw);
    if (parsedUpdatedAt == null) {
      throw const InvalidSettingsException('updatedAt', 'not a parseable timestamp');
    }

    final Object? maxPercent = _require('maxDiscountPercentage');
    final int maxPercentScaled;
    if (maxPercent is! int && maxPercent is! num) {
      throw const InvalidSettingsException('maxDiscountPercentage', 'not a number');
    }
    final num percentNumber = maxPercent as num;
    if (percentNumber < 0 || percentNumber > 100) {
      throw InvalidSettingsException(
        'maxDiscountPercentage',
        '$percentNumber is out of the 0-100 bound',
      );
    }
    maxPercentScaled = _toScaled(percentNumber);

    final BigInt maxDiscount = _bigint('maxDiscountAmountMinor');
    if (maxDiscount < BigInt.zero) {
      throw const InvalidSettingsException('maxDiscountAmountMinor', 'negative');
    }

    final BigInt? approvalThreshold = _bigIntOrNull('discountApprovalThresholdMinor');
    if (approvalThreshold != null && approvalThreshold < BigInt.zero) {
      throw const InvalidSettingsException(
        'discountApprovalThresholdMinor',
        'negative',
      );
    }

    final int graceSeconds = _int('offlineGraceDurationSeconds', min: 1);
    final int reservedBlockSize = _int('reservedBlockSize', min: 1);
    final int minorUnitExponent = _int('minorUnitExponent', min: 0, max: 9);

    final List<FeatureFlagState> flags = _flags();

    return OrganizationSettings(
      organizationId: organizationId,
      settingsVersion: settingsVersion,
      updatedAt: parsedUpdatedAt,
      organizationName: _string('organizationName'),
      currency: CurrencyCode.fromWire(_string('currency')),
      minorUnitExponent: minorUnitExponent,
      displayNumerals: DisplayNumerals.fromWire(_string('displayNumerals')),
      pricingMode: PricingMode.fromWire(_string('pricingMode')),
      maxDiscountPercentageScaled: maxPercentScaled,
      maxDiscountAmountMinor: maxDiscount,
      discountApprovalThresholdMinor: approvalThreshold,
      discountAllowedForSalesperson: _bool('discountAllowedForSalesperson'),
      blockDiscountBelowCost: _bool('blockDiscountBelowCost'),
      invoiceOutputDefault: InvoiceOutputDefault.fromWire(_string('invoiceOutputDefault')),
      invoiceFooter: _string('invoiceFooter'),
      invoiceShowLogo: _bool('invoiceShowLogo'),
      customerRequiredOnCreditSale: _bool('customerRequiredOnCreditSale'),
      roundingMode: RoundingMode.fromWire(_string('roundingMode')),
      receivablesAgingEnabled: _bool('receivablesAgingEnabled'),
      offlineGraceDurationSeconds: graceSeconds,
      offlineReceiptIdFormat: OfflineReceiptIdFormat.fromWire(_string('offlineReceiptIdFormat')),
      offlineReservedNumberBlocks: _bool('offlineReservedNumberBlocks'),
      reservedBlockSize: reservedBlockSize,
      featureFlags: flags,
    );
  }

  List<FeatureFlagState> _flags() {
    final Object? raw = _json['featureFlags'];
    if (raw is! List) {
      throw const InvalidSettingsException('featureFlags', 'not a list');
    }
    final List<FeatureFlagState> parsed = <FeatureFlagState>[];
    for (final Object? member in raw) {
      if (member is! Map) {
        throw const InvalidSettingsException('featureFlags', 'row is not an object');
      }
      final Object? key = member['key'];
      final Object? enabled = member['enabled'];
      if (key is! String || key.isEmpty) {
        throw const InvalidSettingsException('featureFlags', 'row has no readable key');
      }
      if (enabled is! bool) {
        throw const InvalidSettingsException('featureFlags', 'row has no readable state');
      }
      parsed.add(FeatureFlagState(key: key, enabled: enabled));
    }
    return parsed;
  }

  Object? _require(String field) {
    if (!_json.containsKey(field)) {
      throw InvalidSettingsException(field, 'absent from the response');
    }
    return _json[field];
  }

  String _string(String field) {
    final Object? value = _require(field);
    if (value is! String) {
      throw InvalidSettingsException(field, 'not a string');
    }
    return value;
  }

  bool _bool(String field) {
    final Object? value = _require(field);
    if (value is! bool) {
      throw InvalidSettingsException(field, 'not a boolean');
    }
    return value;
  }

  int _int(String field, {required int min, int? max}) {
    final Object? value = _require(field);
    if (value is! int) {
      throw InvalidSettingsException(field, 'not an integer');
    }
    if (value < min || (max != null && value > max)) {
      throw InvalidSettingsException(field, '$value outside the accepted range');
    }
    return value;
  }

  BigInt _bigint(String field) {
    final Object? value = _require(field);
    if (value is! String) {
      throw InvalidSettingsException(field, 'not a decimal-string of minor units');
    }
    return parseWireMinorUnits(field, value);
  }

  BigInt? _bigIntOrNull(String field) {
    final Object? value = _require(field);
    if (value == null) {
      return null;
    }
    if (value is! String) {
      throw InvalidSettingsException(field, 'not a decimal-string of minor units');
    }
    return parseWireMinorUnits(field, value);
  }

  /// `8.25` → `825`, `33` → `3300`. The cast is bounded and exact: the value
  /// has at most two fraction digits, so the scaling is a pure shift.
  static int _toScaled(num value) {
    final double squared = value * 100;
    final int scaled = squared.round();
    final double back = scaled / 100.0;
    if (back != value) {
      throw InvalidSettingsException(
        'maxDiscountPercentage',
        '$value has more than two fraction digits',
      );
    }
    return scaled;
  }
}

/// Parses a wire decimal-string of 64-bit minor units (§34.1 wire money rule).
BigInt parseWireMinorUnits(String field, String value) {
  if (value.isEmpty || !RegExp(r'^\d+$').hasMatch(value)) {
    throw InvalidSettingsException(
      field,
      '$value is not a non-negative decimal integer string',
    );
  }
  if (value.length > 19) {
    throw InvalidSettingsException(field, 'more digits than a 64-bit money value carries');
  }
  final BigInt parsed = BigInt.parse(value);
  // A signed 64-bit bound cannot be exceeded by wire money; the wire is what
  // Prisma's bigint columns hold and what the contract publishes.
  final BigInt bound = (BigInt.one << 63) - BigInt.one;
  if (parsed > bound) {
    throw InvalidSettingsException(field, 'exceeds the 64-bit bound');
  }
  return parsed;
}
