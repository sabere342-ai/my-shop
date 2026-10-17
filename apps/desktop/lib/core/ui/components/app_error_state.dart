import 'package:flutter/material.dart';
import 'package:my_shop_desktop/core/ui/components/app_button.dart';
import 'package:my_shop_desktop/core/ui/theme/app_colors.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';
import 'package:my_shop_desktop/core/ui/theme/app_typography.dart';

/// The state an area falls into when loading or rendering fails (section 6.9).
///
/// The heading carries the danger role instead of a red decoration, so the
/// failure reads as part of the type scale rather than as an inline colour.
class AppErrorState extends StatelessWidget {
  const AppErrorState({
    required this.title,
    required this.description,
    this.actionLabel,
    this.onAction,
    super.key,
  });

  /// The catalogued heading.
  final String title;

  /// The catalogued explanation of the failure.
  final String description;

  /// The catalogued label of the recovery action, if there is one.
  final String? actionLabel;

  /// The recovery action; both it and [actionLabel] must be present to show.
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final TextTheme textTheme = Theme.of(context).textTheme;
    final String? actionCaption = actionLabel;
    final VoidCallback? action = onAction;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: AppSpacing.panelWidth),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              title,
              style: (textTheme.titleLarge ?? AppTypography.title).copyWith(
                color: AppColors.danger,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.one),
            Text(
              description,
              style: textTheme.bodyMedium ?? AppTypography.body,
              textAlign: TextAlign.center,
            ),
            if (actionCaption != null && action != null) ...<Widget>[
              const SizedBox(height: AppSpacing.two),
              AppButton(
                label: actionCaption,
                onPressed: action,
                variant: AppButtonVariant.secondary,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
