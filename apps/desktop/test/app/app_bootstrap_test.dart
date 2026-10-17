import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:my_shop_desktop/app/my_shop_app.dart';
import 'package:my_shop_desktop/app/router/not_found_screen.dart';
import 'package:my_shop_desktop/app/router/shell_screen.dart';

/// App-bootstrap behaviour (Master Plan sections 6.2, 6.6 and 6.8, slice S-8).
///
/// The first frame is asserted to be Arabic-first: the direction comes from
/// `Locale('ar')`, the copy comes from the committed catalog, and the routing
/// decision (notProvisioned allows home) is visible as the shell screen.
void main() {
  testWidgets(
    'boots in Arabic: RTL derives from the locale and the catalog renders',
    (WidgetTester tester) async {
      await tester.pumpWidget(const ProviderScope(child: MyShopApp()));
      await tester.pumpAndSettle();

      expect(find.byType(ShellScreen), findsOneWidget);

      final BuildContext context = tester.element(find.byType(ShellScreen));
      expect(Localizations.localeOf(context), const Locale('ar'));
      expect(Directionality.of(context), TextDirection.rtl);

      expect(find.text('My Shop'), findsOneWidget);
      expect(find.text('الأساس الجاهز'), findsOneWidget);
      expect(find.text('لا توجد شاشات عمل في هذه النسخة.'), findsOneWidget);
    },
  );

  testWidgets('an unmatched location resolves to the catch-all screen', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const ProviderScope(child: MyShopApp()));
    await tester.pumpAndSettle();

    final BuildContext context = tester.element(find.byType(ShellScreen));
    context.go('/no-such-location');
    await tester.pumpAndSettle();

    expect(find.byType(NotFoundScreen), findsOneWidget);
    expect(find.text('الصفحة غير موجودة'), findsOneWidget);
  });
}
