import 'package:flutter/material.dart';
import 'package:my_shop_desktop/core/ui/theme/app_colors.dart';
import 'package:my_shop_desktop/core/ui/theme/app_radius.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';

/// The tone a transient message carries (section 6.9).
enum AppSnackbarTone {
  /// Something completed: green.
  success,

  /// Something failed: red.
  error,

  /// Neutral context: the brand blue.
  info,
}

/// The client's transient message surface (section 6.9).
///
/// A static function rather than a widget because a snackbar is an effect on
/// the nearest `ScaffoldMessenger`, not a node a caller places in a tree; the
/// colour role is still chosen from the palette, never from a raw colour.
abstract final class AppSnackbar {
  /// Replaces any visible message with [message], painted in [tone]'s role.
  static void show(
    BuildContext context, {
    required String message,
    required AppSnackbarTone tone,
  }) {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    messenger.clearSnackBars();
    messenger.showSnackBar(
      SnackBar(
        content: Text(message),
        behavior: SnackBarBehavior.floating,
        backgroundColor: switch (tone) {
          AppSnackbarTone.success => AppColors.success,
          AppSnackbarTone.error => AppColors.danger,
          AppSnackbarTone.info => AppColors.primary,
        },
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.mediumBox),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.two,
          vertical: AppSpacing.one,
        ),
      ),
    );
  }
}
