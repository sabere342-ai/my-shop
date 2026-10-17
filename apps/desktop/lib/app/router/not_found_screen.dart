import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_shop_desktop/app/router/route_paths.dart';
import 'package:my_shop_desktop/core/ui/components/app_error_state.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';
import 'package:my_shop_desktop/l10n/app_localizations.dart';

/// The catch-all screen for a location that matches no route (Master Plan
/// section 6.6).
///
/// `go_router` reports unmatched locations through `onException`, which lands
/// here, so a mistyped deep link degrades into one recoverable screen instead
/// of a stack trace.
class NotFoundScreen extends StatelessWidget {
  const NotFoundScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.appTitle)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.three),
          child: AppErrorState(
            title: l10n.notFoundTitle,
            description: l10n.notFoundBody,
            actionLabel: l10n.backToHome,
            onAction: () => context.go(RoutePaths.home),
          ),
        ),
      ),
    );
  }
}
