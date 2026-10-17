import 'package:flutter/material.dart';
import 'package:my_shop_desktop/core/ui/components/app_text_field.dart';

/// A numeric field for money amounts (section 6.9).
///
/// Deliberately presentational: the value crosses the widget boundary as the
/// text the user typed, because no money type exists at this slice and a field
/// that pretends to parse one would be inventing a domain rule the plan has
/// not yet granted. Section 6.8's digit decision is honoured by the keypad
/// request: Western digits, not the Arabic-Indic set, until a localization
/// decision says otherwise.
class AppMoneyField extends StatelessWidget {
  const AppMoneyField({
    this.label,
    this.hint,
    this.errorText,
    this.suffix,
    this.controller,
    this.onChanged,
    this.enabled = true,
    super.key,
  });

  /// The catalogued field caption.
  final String? label;

  /// The catalogued hint shown while the field is empty.
  final String? hint;

  /// The catalogued validation message.
  final String? errorText;

  /// The catalogued currency hint shown after the amount.
  final String? suffix;

  /// Optional externally owned value.
  final TextEditingController? controller;

  /// Called on every edit; the caller owns parsing.
  final ValueChanged<String>? onChanged;

  /// `false` renders the field read-only and dimmed.
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return AppTextField(
      label: label,
      hint: hint,
      errorText: errorText,
      suffix: suffix,
      controller: controller,
      onChanged: onChanged,
      enabled: enabled,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
    );
  }
}
