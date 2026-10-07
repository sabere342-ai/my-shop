import 'package:flutter/material.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';
import 'package:my_shop_desktop/core/ui/theme/app_typography.dart';

/// The heading that opens a block of content (section 6.9).
///
/// The title occupies the start of the row and any trailing control sits at
/// the end, so the header mirrors wholesale when the locale is Arabic.
class AppSectionHeader extends StatelessWidget {
  const AppSectionHeader({required this.title, this.trailing, super.key});

  /// The catalogued heading.
  final String title;

  /// An optional control pinned to the logical end of the row.
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final Widget? trailingWidget = trailing;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.one),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Text(
              title,
              style:
                  Theme.of(context).textTheme.titleLarge ?? AppTypography.title,
            ),
          ),
          ?trailingWidget,
        ],
      ),
    );
  }
}
