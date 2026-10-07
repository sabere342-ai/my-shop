import 'package:flutter/material.dart';
import 'package:my_shop_desktop/core/ui/theme/app_colors.dart';
import 'package:my_shop_desktop/core/ui/theme/app_radius.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';
import 'package:my_shop_desktop/core/ui/theme/app_typography.dart';

/// The client's single-line and multi-line text input (section 6.9).
///
/// [label], [hint] and [errorText] are catalogued strings from the caller; the
/// localization gate rejects literals in those positions (section 6.8).
class AppTextField extends StatelessWidget {
  const AppTextField({
    this.label,
    this.hint,
    this.errorText,
    this.suffix,
    this.controller,
    this.onChanged,
    this.obscureText = false,
    this.keyboardType,
    this.maxLines = 1,
    this.enabled = true,
    super.key,
  });

  /// The catalogued field caption, floating above the value once filled.
  final String? label;

  /// The catalogued hint shown while the field is empty.
  final String? hint;

  /// The catalogued validation message; its presence marks the field invalid.
  final String? errorText;

  /// A catalogued unit shown after the value (currency, count).
  final String? suffix;

  /// Optional externally owned value.
  final TextEditingController? controller;

  /// Called on every edit; the caller owns parsing and validation.
  final ValueChanged<String>? onChanged;

  /// Masks the value for secrets.
  final bool obscureText;

  /// Keyboard or keypad shape the platform should show.
  final TextInputType? keyboardType;

  /// Lines to grow to before scrolling; a number above one makes it a box.
  final int maxLines;

  /// `false` renders the field read-only and dimmed.
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    return TextField(
      controller: controller,
      onChanged: onChanged,
      obscureText: obscureText,
      keyboardType: keyboardType,
      maxLines: maxLines,
      enabled: enabled,
      style: AppTypography.body,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        errorText: errorText,
        suffixText: suffix,
        filled: true,
        fillColor: AppColors.surfaceRaised,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.two,
          vertical: AppSpacing.one,
        ),
        border: const OutlineInputBorder(borderRadius: AppRadius.mediumBox),
        enabledBorder: const OutlineInputBorder(
          borderRadius: AppRadius.mediumBox,
          borderSide: BorderSide(color: AppColors.outline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AppRadius.mediumBox,
          borderSide: BorderSide(color: scheme.primary, width: 1.5),
        ),
        errorBorder: const OutlineInputBorder(
          borderRadius: AppRadius.mediumBox,
          borderSide: BorderSide(color: AppColors.danger),
        ),
        focusedErrorBorder: const OutlineInputBorder(
          borderRadius: AppRadius.mediumBox,
          borderSide: BorderSide(color: AppColors.danger, width: 1.5),
        ),
      ),
    );
  }
}
