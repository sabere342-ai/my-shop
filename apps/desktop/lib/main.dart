import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_shop_desktop/app/my_shop_app.dart';

/// My Shop client entry point.
///
/// Master Plan section 6.2 fixes the layout of `apps/desktop`, and this file
/// is the composition root: it owns process start and the root provider scope,
/// and nothing else. The router, the theme and the catalogs are wired in
/// `app/my_shop_app.dart` (sections 6.4, 6.6, 6.8 and 6.9), so every decision
/// a screen depends on is reachable from one place and testable without
/// starting a process.
void main() {
  runApp(const ProviderScope(child: MyShopApp()));
}
