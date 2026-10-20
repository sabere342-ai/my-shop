/// The editing drafts the settings screens maintain between the displayed
/// (server-owned) values and what the user has typed (Master Plan §22.3,
/// mission §5/§6).
///
/// Three disciplines drive the shape:
///
/// - **The server's row is the baseline; the draft is only a set of *offered
///   changes*.** An untouched field appears in neither the diff indicator nor
///   the PUT body, so the §22.2 field-authorized partial update semantics are
///   respected end to end — the client never re-sends a value it did not
///   mean to change.
/// - **Every value parses exactly.** Money stays [BigInt] minor units, the
///   percentage stays integer hundredths; no float ever decides validity
///   (§30, §18.2). A field that does not parse is a validation error, never a
///   quietly-wrong number.
/// - **Clearing (§22.2's nullable threshold) is distinct from leaving alone.**
///   A user who deletes the approval threshold changes the setting to
///   `null`; that crosses the wire as an explicit `null`, which the
///   field-authorized contract accepts as a clearing write.
library;

import 'package:my_shop_desktop/features/settings/models/organization_settings.dart';

/// One validation refusal, field-scoped (§34.2: readable validation).
enum SettingsDraftError {
  /// The organization name would not survive the server's trimming rule.
  organizationNameEmpty,

  /// The footer exceeds the published length bound.
  invoiceFooterTooLong,

  /// The percentage field is empty-ish or malformed (grammar of §18).
  percentageInvalid,

  /// The minor-unit amount field is malformed or refuses to be an integer.
  amountInvalid,

  /// The minor-unit amount is below zero or above the 64-bit bound.
  amountOutOfRange,
}

/// Which field a [SettingsDraftError] belongs to.
extension SettingsDraftErrorField on SettingsDraftError {
  String get field => switch (this) {
        SettingsDraftError.organizationNameEmpty ||
        SettingsDraftError.invoiceFooterTooLong =>
          'general',
        SettingsDraftError.percentageInvalid ||
        SettingsDraftError.amountInvalid ||
        SettingsDraftError.amountOutOfRange =>
          'pricing',
      };
}

/// The general-settings editor's draft (§22.2/§22.4 `settings.edit` fields and
/// the §38.18 read-only presentation rows the screen shows cannot be edited
/// here — owner-exclusive rows never enter this draft because the client
/// refuses to offer a control the caller's permissions do not allow using).
final class GeneralSettingsDraft {
  GeneralSettingsDraft();

  String? _organizationName;
  CurrencyCode? _currency;
  DisplayNumerals? _displayNumerals;
  InvoiceOutputDefault? _invoiceOutputDefault;
  String? _invoiceFooter;
  bool? _invoiceShowLogo;
  bool? _customerRequiredOnCreditSale;
  bool? _receivablesAgingEnabled;
  OfflineReceiptIdFormat? _offlineReceiptIdFormat;
  bool? _offlineReservedNumberBlocks;

  bool get hasChanges =>
      _organizationName != null ||
      _currency != null ||
      _displayNumerals != null ||
      _invoiceOutputDefault != null ||
      _invoiceFooter != null ||
      _invoiceShowLogo != null ||
      _customerRequiredOnCreditSale != null ||
      _receivablesAgingEnabled != null ||
      _offlineReceiptIdFormat != null ||
      _offlineReservedNumberBlocks != null;

  /// The offered values, `null` meaning "the server row still rules". The
  /// controls read these instead of re-deriving them from the PUT body, so
  /// the draft stays the single source of offered changes.
  String? get organizationName => _organizationName;
  CurrencyCode? get currency => _currency;
  DisplayNumerals? get displayNumerals => _displayNumerals;
  InvoiceOutputDefault? get invoiceOutputDefault => _invoiceOutputDefault;
  String? get invoiceFooter => _invoiceFooter;
  bool? get invoiceShowLogo => _invoiceShowLogo;
  bool? get customerRequiredOnCreditSale => _customerRequiredOnCreditSale;
  bool? get receivablesAgingEnabled => _receivablesAgingEnabled;
  OfflineReceiptIdFormat? get offlineReceiptIdFormat => _offlineReceiptIdFormat;
  bool? get offlineReservedNumberBlocks => _offlineReservedNumberBlocks;

  /// The number of fields the user touched — the unsaved-changes indicator's
  /// count.
  int get changedFieldCount => <bool>[
        _organizationName != null,
        _currency != null,
        _displayNumerals != null,
        _invoiceOutputDefault != null,
        _invoiceFooter != null,
        _invoiceShowLogo != null,
        _customerRequiredOnCreditSale != null,
        _receivablesAgingEnabled != null,
        _offlineReceiptIdFormat != null,
        _offlineReservedNumberBlocks != null,
      ].where((bool changed) => changed).length;

  /// Replaces name with the trimmed text; an empty result is the caller's
  /// problem to show (the draft accepts it, the validator refuses it).
  void setOrganizationName(String trimmed) => _organizationName = trimmed;

  void setCurrency(CurrencyCode value) => _currency = value;

  void setDisplayNumerals(DisplayNumerals value) => _displayNumerals = value;

  void setInvoiceOutputDefault(InvoiceOutputDefault value) =>
      _invoiceOutputDefault = value;

  /// Stores the footer exactly as typed (the §22.2 bound is validated, not
  /// silently truncated).
  void setInvoiceFooter(String text) => _invoiceFooter = text;

  void setInvoiceShowLogo(bool value) => _invoiceShowLogo = value;

  void setCustomerRequiredOnCreditSale(bool value) =>
      _customerRequiredOnCreditSale = value;

  void setReceivablesAgingEnabled(bool value) => _receivablesAgingEnabled = value;

  void setOfflineReceiptIdFormat(OfflineReceiptIdFormat value) =>
      _offlineReceiptIdFormat = value;

  void setOfflineReservedNumberBlocks(bool value) =>
      _offlineReservedNumberBlocks = value;

  /// Validates against the same rules the server re-checks (§22.1): an
  /// organization name must carry non-whitespace content after its own
  /// trimming, and the footer may not exceed the published length bound.
  List<SettingsDraftError> validate({int invoiceFooterMaxLength = 2000}) {
    final List<SettingsDraftError> errors = <SettingsDraftError>[];
    if (_organizationName != null && _organizationName!.trim().isEmpty) {
      errors.add(SettingsDraftError.organizationNameEmpty);
    }
    if (_invoiceFooter != null && _invoiceFooter!.length > invoiceFooterMaxLength) {
      errors.add(SettingsDraftError.invoiceFooterTooLong);
    }
    return errors;
  }

  /// The §34.1 PUT body: **only** touched fields, plus the §38.18 version
  /// token. Validating first is the caller's duty (`validate()` empty).
  Map<String, Object?> requestBody(int settingsVersion) {
    final Map<String, Object?> body = <String, Object?>{
      'settingsVersion': settingsVersion,
    };
    if (_organizationName != null) {
      body['organizationName'] = _organizationName!.trim();
    }
    if (_currency != null) {
      body['currency'] = _currency!.wire;
    }
    if (_displayNumerals != null) body['displayNumerals'] = _displayNumerals!.wire;
    if (_invoiceOutputDefault != null) {
      body['invoiceOutputDefault'] = _invoiceOutputDefault!.wire;
    }
    if (_invoiceFooter != null) body['invoiceFooter'] = _invoiceFooter;
    if (_invoiceShowLogo != null) body['invoiceShowLogo'] = _invoiceShowLogo;
    if (_customerRequiredOnCreditSale != null) {
      body['customerRequiredOnCreditSale'] = _customerRequiredOnCreditSale;
    }
    if (_receivablesAgingEnabled != null) {
      body['receivablesAgingEnabled'] = _receivablesAgingEnabled;
    }
    if (_offlineReceiptIdFormat != null) {
      body['offlineReceiptIdFormat'] = _offlineReceiptIdFormat!.wire;
    }
    if (_offlineReservedNumberBlocks != null) {
      body['offlineReservedNumberBlocks'] = _offlineReservedNumberBlocks;
    }
    return body;
  }

  /// Discards every offered change (the reload path in §5, mission §6).
  void reset() {
    _organizationName = null;
    _currency = null;
    _displayNumerals = null;
    _invoiceOutputDefault = null;
    _invoiceFooter = null;
    _invoiceShowLogo = null;
    _customerRequiredOnCreditSale = null;
    _receivablesAgingEnabled = null;
    _offlineReceiptIdFormat = null;
    _offlineReservedNumberBlocks = null;
  }
}

/// The pricing & discount editor's draft (§18's five typed policy fields plus
/// the §17 mode selection, every field being `pricing.policy.edit`-gated).
final class PricingPolicyDraft {
  PricingPolicyDraft();

  PricingMode? _pricingMode;

  /// The raw percentage text; `null` means untouched, an empty string is an
  /// explicit clear-back that the validator refuses (the ceiling must stay a
  /// stated value — the server default of `0` is reached by typing `0`).
  String? _percentageText;

  /// The raw amount text for the minor-unit ceilings; `null` = untouched.
  String? _maxAmountText;
  String? _thresholdText;

  /// Clearing the nullable approval threshold is a distinct outcome
  /// (§22.2 nullable by decision): touched-and-empty → explicit `null`.
  bool _thresholdChanged = false;

  bool? _salespersonAllowed;
  bool? _blockBelowCost;

  bool get hasChanges =>
      _pricingMode != null ||
      _percentageText != null ||
      _maxAmountText != null ||
      _thresholdChanged ||
      _salespersonAllowed != null ||
      _blockBelowCost != null;

  int get changedFieldCount => <bool>[
        _pricingMode != null,
        _percentageText != null,
        _maxAmountText != null,
        _thresholdChanged,
        _salespersonAllowed != null,
        _blockBelowCost != null,
      ].where((bool changed) => changed).length;

  /// The offered values (see [GeneralSettingsDraft]'s note): `null` means
  /// "the server row still rules", except the threshold's cleared state,
  /// which [thresholdCleared] carries distinctly.
  PricingMode? get pricingMode => _pricingMode;
  String? get percentageText => _percentageText;
  String? get maxAmountText => _maxAmountText;
  String? get thresholdText => _thresholdText;
  bool? get salespersonAllowed => _salespersonAllowed;
  bool? get blockBelowCost => _blockBelowCost;

  /// The threshold was touched-and-emptied — the §22.2 explicit-null write.
  bool get thresholdCleared => _thresholdChanged;

  void setPricingMode(PricingMode value) => _pricingMode = value;

  void setPercentageText(String text) => _percentageText = text;

  void setMaxAmountText(String text) => _maxAmountText = text;

  /// Typing replaces the threshold; clearing (empty text) marks the change.
  void setThresholdText(String text) {
    _thresholdText = text;
    _thresholdChanged = true;
  }

  void setSalespersonAllowed(bool value) => _salespersonAllowed = value;

  void setBlockBelowCost(bool value) => _blockBelowCost = value;

  /// The parsed §18 percentage in exact integer hundredths, or a validation
  /// refusal. Refuses the empty field (the ceiling must be a stated value),
  /// malformed grammars, negatives, and values above 100.
  int? parsePercentageScaled() {
    final String? text = _percentageText;
    if (text == null) return null;
    try {
      return parseExactPercentage(text);
    } on InvalidSettingsException {
      return null;
    }
  }

  /// The parsed §18 fixed-amount ceiling in exact minor units, or `null` when
  /// untouched. A typed-but-invalid text is a [SettingsDraftError], never a
  /// silently clamped number.
  BigInt? parseMaxAmountMinor() {
    final String? text = _maxAmountText;
    if (text == null) return null;
    return _tryParseMinorUnits(text);
  }

  /// The parsed threshold, `null` when cleared, or `null` too when untouched —
  /// disambiguated by [_thresholdChanged].
  BigInt? parseThresholdMinor() {
    final String? text = _thresholdText;
    if (text == null) return null;
    if (text.isEmpty) return null;
    return _tryParseMinorUnits(text);
  }

  BigInt? _tryParseMinorUnits(String text) {
    if (text.isEmpty) {
      return null;
    }
    if (!RegExp(r'^\d+$').hasMatch(text) || text.length > 19) {
      return null;
    }
    return BigInt.parse(text);
  }

  List<SettingsDraftError> validate() {
    final List<SettingsDraftError> errors = <SettingsDraftError>[];
    if (_percentageText != null) {
      if (_percentageText!.trim().isEmpty ||
          parsePercentageScaled() == null) {
        errors.add(SettingsDraftError.percentageInvalid);
      }
    }
    if (_maxAmountText != null) {
      final String text = _maxAmountText!;
      if (text.isEmpty ||
          !RegExp(r'^\d+$').hasMatch(text) ||
          text.length > 19) {
        errors.add(SettingsDraftError.amountInvalid);
      } else {
        final BigInt zero = BigInt.zero;
        final BigInt parsed = BigInt.parse(text);
        if (parsed < zero) {
          errors.add(SettingsDraftError.amountOutOfRange);
        }
        if (parsed > (BigInt.one << 63) - BigInt.one) {
          errors.add(SettingsDraftError.amountOutOfRange);
        }
      }
    }
    if (_thresholdChanged && _thresholdText != null && _thresholdText!.isNotEmpty) {
      final String text = _thresholdText!;
      if (!RegExp(r'^\d+$').hasMatch(text) || text.length > 19) {
        errors.add(SettingsDraftError.amountInvalid);
      }
    }
    return errors;
  }

  /// The §34.1 PUT body: only touched fields, the percentage crossing as a
  /// JSON number with at-most-two fraction digits (exactly what integer
  /// hundredths divide back to), money as decimal strings, and a threshold
  /// clearing crossing as **explicit** `null`.
  Map<String, Object?> requestBody(int settingsVersion) {
    final Map<String, Object?> body = <String, Object?>{
      'settingsVersion': settingsVersion,
    };
    if (_pricingMode != null) body['pricingMode'] = _pricingMode!.wire;
    final int? scaled = parsePercentageScaled();
    if (_percentageText != null && scaled != null) {
      if (scaled % PercentageSemantics.scale == 0) {
        body['maxDiscountPercentage'] = scaled ~/ PercentageSemantics.scale;
      } else {
        // `scaled / 100` for a ≤2dp integer-hundredth value is an exact
        // rendering decision, not a computation: 1233/100 renders "12.33".
        body['maxDiscountPercentage'] = scaled / PercentageSemantics.scale;
      }
    }
    final BigInt? amount = parseMaxAmountMinor();
    if (_maxAmountText != null && amount != null) {
      body['maxDiscountAmountMinor'] = amount.toString();
    }
    if (_thresholdChanged) {
      body['discountApprovalThresholdMinor'] =
          parseThresholdMinor()?.toString();
    }
    if (_salespersonAllowed != null) {
      body['discountAllowedForSalesperson'] = _salespersonAllowed;
    }
    if (_blockBelowCost != null) body['blockDiscountBelowCost'] = _blockBelowCost;
    return body;
  }

  void reset() {
    _pricingMode = null;
    _percentageText = null;
    _maxAmountText = null;
    _thresholdText = null;
    _thresholdChanged = false;
    _salespersonAllowed = null;
    _blockBelowCost = null;
  }
}
