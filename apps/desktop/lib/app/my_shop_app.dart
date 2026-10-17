import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:my_shop_desktop/app/router/app_router.dart';
import 'package:my_shop_desktop/core/ui/theme/app_theme.dart';
import 'package:my_shop_desktop/l10n/app_localizations.dart';

/// The material root of the client (Master Plan section 6.2).
///
/// It wires the three decisions the plan fixes for every screen: Riverpod for
/// state, `go_router` for navigation, and one Arabic-first theme and catalog
/// pair. The locale is pinned to `ar` rather than left to the platform so the
/// direction of every screen derives from an explicit choice (section 6.8) —
/// there is no `Directionality` wrapper anywhere in the client.
class MyShopApp extends ConsumerWidget {
  const MyShopApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final GoRouter router = ref.watch(appRouterProvider);
    return MaterialApp.router(
      routerConfig: router,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      locale: const Locale('ar'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
    );
  }
}
