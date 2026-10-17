import 'package:flutter/material.dart';
import 'package:my_shop_desktop/core/ui/theme/app_colors.dart';
import 'package:my_shop_desktop/core/ui/theme/app_radius.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';
import 'package:my_shop_desktop/core/ui/theme/app_typography.dart';

/// The client's bottom sheet (section 6.9).
///
/// Used for secondary detail that must not lose the screen behind it.
class AppSheet extends StatelessWidget {
  const AppSheet({
    required this.title,
    required this.content,
    super.key,
  });

  /// The catalogued heading.
  final String title;

  /// The sheet body.
  final Widget content;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.three,
          vertical: AppSpacing.two,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              title,
              style: Theme.of(context).textTheme.titleLarge ?? AppTypography.title,
            ),
            const SizedBox(height: AppSpacing.two),
            content,
          ],
        ),
      ),
    );
  }

  /// Presents [sheet] from the bottom edge and resolves when it is dismissed.
  static Future<T?> show<T>({
    required BuildContext context,
    required Widget sheet,
  }) =>
      showModalBottomSheet<T>(
        context: context,
        isScrollControlled: true,
        backgroundColor: AppColors.surfaceRaised,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(AppRadius.large),
          ),
        ),
        builder: (BuildContext _) => sheet,
      );
}
