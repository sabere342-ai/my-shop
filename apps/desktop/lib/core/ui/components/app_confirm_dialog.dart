import 'package:flutter/material.dart';
import 'package:my_shop_desktop/core/ui/components/app_button.dart';

/// A yes/no confirmation whose confirm button can be painted as a danger
/// action (section 6.9).
///
/// Every destructive flow in the client is expected to route through this one
/// dialog so the wording, the ordering and the red confirm button are a single
/// decision instead of a per-screen reinvention.
class AppConfirmDialog extends StatelessWidget {
  const AppConfirmDialog({
    required this.title,
    required this.message,
    required this.confirmLabel,
    required this.cancelLabel,
    this.destructive = false,
    super.key,
  });

  /// The catalogued question.
  final String title;

  /// The catalogued consequence of confirming.
  final String message;

  /// The catalogued affirmative label.
  final String confirmLabel;

  /// The catalogued dismissal label.
  final String cancelLabel;

  /// Paints the confirm button as [AppButtonVariant.danger].
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: <Widget>[
        AppButton(
          label: cancelLabel,
          onPressed: () => Navigator.of(context).pop(false),
          variant: AppButtonVariant.secondary,
        ),
        AppButton(
          label: confirmLabel,
          onPressed: () => Navigator.of(context).pop(true),
          variant: destructive ? AppButtonVariant.danger : AppButtonVariant.primary,
        ),
      ],
      actionsAlignment: MainAxisAlignment.end,
    );
  }

  /// Presents [dialog] and resolves to `true` only when the confirm button was
  /// pressed; dismissing or cancelling resolves to `false`.
  static Future<bool> show({
    required BuildContext context,
    required AppConfirmDialog dialog,
  }) async {
    final bool? result = await showDialog<bool>(
      context: context,
      builder: (BuildContext _) => dialog,
    );
    return result ?? false;
  }
}
