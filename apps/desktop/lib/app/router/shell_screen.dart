import 'package:flutter/material.dart';
import 'package:my_shop_desktop/core/ui/components/app_empty_state.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';
import 'package:my_shop_desktop/l10n/app_localizations.dart';

/// The authenticated workspace shell (Master Plan section 6.6).
///
/// It is registered at `RoutePaths.home` and currently renders the section
/// 6.2 promise honestly: the frame, the chrome and the catalogued copy of a
/// shell, with no fabricated business screens.
class ShellScreen extends StatelessWidget {
  const ShellScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.appTitle)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.three),
          child: AppEmptyState(
            title: l10n.shellTitle,
            description: l10n.shellBody,
          ),
        ),
      ),
    );
  }
}
