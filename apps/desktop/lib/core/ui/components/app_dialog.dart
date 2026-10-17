import 'package:flutter/material.dart';
import 'package:my_shop_desktop/core/ui/theme/app_colors.dart';
import 'package:my_shop_desktop/core/ui/theme/app_radius.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';

/// The client's modal dialog surface (section 6.9).
///
/// [title] is a catalogued string; [content] and [actions] are composed by the
/// caller from other design-system parts, so a dialog never needs a one-off
/// layout.
class AppDialog extends StatelessWidget {
  const AppDialog({
    required this.title,
    required this.content,
    this.actions = const <Widget>[],
    super.key,
  });

  /// The catalogued heading.
  final String title;

  /// The body, constrained to the panel width so the dialog does not track the
  /// host window.
  final Widget content;

  /// Buttons pinned to the dialog's action row, logically ordered.
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppColors.surfaceRaised,
      shape: const RoundedRectangleBorder(borderRadius: AppRadius.largeBox),
      title: Text(title),
      content: SizedBox(width: AppSpacing.panelWidth, child: content),
      actions: actions,
      actionsAlignment: MainAxisAlignment.end,
    );
  }

  /// Presents [dialog] on the nearest navigator and resolves when it is
  /// dismissed.
  static Future<T?> show<T>({
    required BuildContext context,
    required Widget dialog,
  }) =>
      showDialog<T>(context: context, builder: (BuildContext _) => dialog);
}
