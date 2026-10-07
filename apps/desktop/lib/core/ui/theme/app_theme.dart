import 'package:flutter/material.dart';
import 'package:my_shop_desktop/core/ui/theme/app_colors.dart';
import 'package:my_shop_desktop/core/ui/theme/app_typography.dart';

/// Master Plan section 6.9: the theme composed from the tokens.
///
/// The theme carries the palette and the type scale. Control geometry (radii,
/// heights, paddings) lives on the controls themselves in
/// `lib/core/ui/components`, because a button that has to look right in a
/// dialog, a table cell and a toolbar cannot be expressed as one global
/// `ButtonStyleData` without three escape hatches.
abstract final class AppTheme {
  /// The light theme.
  ///
  /// One deliberate theme at this slice: section 6.9 asks for colour roles and
  /// a type scale, not for a second palette before there is a screen to read in
  /// the dark.
  static ThemeData light() {
    final ColorScheme scheme = ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      brightness: Brightness.light,
      primary: AppColors.primary,
      onPrimary: AppColors.onPrimary,
      surface: AppColors.surface,
      onSurface: AppColors.onSurface,
      error: AppColors.danger,
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: AppColors.surface,
      disabledColor: AppColors.disabled,
      textTheme: textTheme,
    );
  }

  /// The five-step type scale bound into Material's text slots.
  ///
  /// Material names thirteen slots and section 6.9 defines five steps, so the
  /// steps collapse where the two disagree (`titleLarge` and `titleMedium` are
  /// both [AppTypography.title]); every slot a screen can reach resolves to a
  /// token rather than to a platform default.
  static const TextTheme textTheme = TextTheme(
    displayMedium: AppTypography.display,
    titleLarge: AppTypography.title,
    titleMedium: AppTypography.title,
    bodyLarge: AppTypography.body,
    bodyMedium: AppTypography.body,
    bodySmall: AppTypography.caption,
    labelLarge: AppTypography.label,
    labelMedium: AppTypography.label,
    labelSmall: AppTypography.caption,
  );
}
