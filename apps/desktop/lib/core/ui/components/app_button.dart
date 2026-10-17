import 'package:flutter/material.dart';
import 'package:my_shop_desktop/core/ui/theme/app_colors.dart';
import 'package:my_shop_desktop/core/ui/theme/app_radius.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';
import 'package:my_shop_desktop/core/ui/theme/app_typography.dart';

/// The three tones a button can carry (section 6.9).
enum AppButtonVariant {
  /// The affirmative action of a screen: blue, filled.
  primary,

  /// The quiet alternative: outlined, never filled.
  secondary,

  /// The destructive action: red, filled, never the default focus.
  danger,
}

/// The client's single button (section 6.9).
///
/// Callers pass a [label] that must come from an ARB catalog: the localization
/// gate rejects string literals in every user-visible argument of
/// `apps/desktop/lib` (section 6.8).
class AppButton extends StatelessWidget {
  const AppButton({
    required this.label,
    required this.onPressed,
    this.variant = AppButtonVariant.primary,
    this.busy = false,
    super.key,
  });

  /// The catalogued caption.
  final String label;

  /// `null` disables the button, which is also what [busy] forces.
  final VoidCallback? onPressed;

  /// Which of the three tones to paint.
  final AppButtonVariant variant;

  /// Shows a spinner and disables presses while an action is in flight.
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final bool enabled = onPressed != null && !busy;
    final VoidCallback? press = enabled ? onPressed : null;
    final Widget child = busy
        ? SizedBox(
            width: AppSpacing.two,
            height: AppSpacing.two,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: variant == AppButtonVariant.secondary
                  ? AppColors.primary
                  : AppColors.onPrimary,
            ),
          )
        : Text(label);

    return switch (variant) {
      AppButtonVariant.secondary => OutlinedButton(
          onPressed: press,
          style: _styleFor(variant),
          child: child,
        ),
      AppButtonVariant.primary || AppButtonVariant.danger => FilledButton(
          onPressed: press,
          style: _styleFor(variant),
          child: child,
        ),
    };
  }

  static ButtonStyle _styleFor(AppButtonVariant variant) {
    const EdgeInsetsGeometry padding = EdgeInsets.symmetric(
      horizontal: AppSpacing.three,
      vertical: AppSpacing.one,
    );
    const RoundedRectangleBorder shape = RoundedRectangleBorder(
      borderRadius: AppRadius.mediumBox,
    );
    return switch (variant) {
      AppButtonVariant.primary => FilledButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: AppColors.onPrimary,
          disabledBackgroundColor: AppColors.disabled,
          disabledForegroundColor: AppColors.surfaceRaised,
          textStyle: AppTypography.label,
          padding: padding,
          minimumSize: const Size(0, AppSpacing.controlHeight),
          shape: shape,
        ),
      AppButtonVariant.secondary => OutlinedButton.styleFrom(
          foregroundColor: AppColors.primary,
          disabledForegroundColor: AppColors.disabled,
          side: const BorderSide(color: AppColors.primary),
          textStyle: AppTypography.label,
          padding: padding,
          minimumSize: const Size(0, AppSpacing.controlHeight),
          shape: shape,
        ),
      AppButtonVariant.danger => FilledButton.styleFrom(
          backgroundColor: AppColors.danger,
          foregroundColor: AppColors.onPrimary,
          disabledBackgroundColor: AppColors.disabled,
          disabledForegroundColor: AppColors.surfaceRaised,
          textStyle: AppTypography.label,
          padding: padding,
          minimumSize: const Size(0, AppSpacing.controlHeight),
          shape: shape,
        ),
    };
  }
}
