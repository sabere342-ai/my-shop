import 'package:flutter/material.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';
import 'package:my_shop_desktop/core/ui/theme/app_typography.dart';

/// The placeholder a list or a section shows when it has nothing to render
/// yet (section 6.9).
class AppEmptyState extends StatelessWidget {
  const AppEmptyState({
    required this.title,
    required this.description,
    this.action,
    super.key,
  });

  /// The catalogued heading.
  final String title;

  /// The catalogued explanation of why the area is empty.
  final String description;

  /// An optional catalogued action to fill the area.
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final TextTheme textTheme = Theme.of(context).textTheme;
    final Widget? actionWidget = action;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: AppSpacing.panelWidth),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              title,
              style: textTheme.titleLarge ?? AppTypography.title,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.one),
            Text(
              description,
              style: textTheme.bodyMedium ?? AppTypography.body,
              textAlign: TextAlign.center,
            ),
            if (actionWidget != null) ...<Widget>[
              const SizedBox(height: AppSpacing.two),
              actionWidget,
            ],
          ],
        ),
      ),
    );
  }
}
