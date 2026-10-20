import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:my_shop_desktop/app/my_shop_app.dart';
import 'package:my_shop_desktop/app/router/not_found_screen.dart';
import 'package:my_shop_desktop/app/router/shell_screen.dart';
import 'package:my_shop_desktop/core/auth/app_session_notifier.dart';
import 'package:my_shop_desktop/core/auth/auth_composition.dart';
import 'package:my_shop_desktop/core/auth/keystore.dart';
import 'package:my_shop_desktop/core/auth/session_state.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';

/// App-bootstrap behaviour (Master Plan sections 6.2, 6.6 and 6.8, slice S-8).
///
/// The first frame is asserted to be Arabic-first: the direction comes from
/// `Locale('ar')`, the copy comes from the committed catalog, and the routing
/// decision (notProvisioned allows home) is visible as the shell screen.
///
/// Since M2-S7 the shell reads the session store (§38.16.2: boot pending,
/// then the keystore's answer) and the offline grace status of the same
/// session (§38.31). The fixtures pin exactly what this suite's names claim:
/// the session stays at `bootPending` — the first frame, before the keystore
/// has answered — and the authentication capability is composed for a test
/// origin over an in-memory database, so the platform keystore and no network
/// are ever touched (there is no engine in a widget test).
class _BootPendingSession extends AppSessionNotifier {
  @override
  AppSessionState build() => const AppSessionState.bootPending();
}

ProviderScope _bootScope() {
  // Each test owns its own throw-away in-memory database; they never share
  // an executor, so drift's shared-executor corruption warning is noise here.
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  final AuthKit kit = AuthKit.compose(
    baseUrl: 'https://myshop.test',
    keystore: FlutterSecureKeystore(),
    db: AppDatabase.forTesting(NativeDatabase.memory()),
  );
  return ProviderScope(
    overrides: [
      appSessionProvider.overrideWith(_BootPendingSession.new),
      authKitProvider.overrideWithValue(kit),
    ],
    child: const MyShopApp(),
  );
}

void main() {
  testWidgets(
    'boots in Arabic: RTL derives from the locale and the catalog renders',
    (WidgetTester tester) async {
      await tester.pumpWidget(_bootScope());
      await tester.pumpAndSettle();

      expect(find.byType(ShellScreen), findsOneWidget);

      final BuildContext context = tester.element(find.byType(ShellScreen));
      expect(Localizations.localeOf(context), const Locale('ar'));
      expect(Directionality.of(context), TextDirection.rtl);

      expect(find.text('My Shop'), findsOneWidget);
      // The shell copy (the catalog renamed the workspace copy when the
      // settings entry was added in M3-S4).
      expect(find.text('مساحة العمل'), findsOneWidget);
      expect(find.text('اختر مكان العمل من القائمة.'), findsOneWidget);
      expect(find.text('الإعدادات'), findsOneWidget);
    },
  );

  testWidgets('an unmatched location resolves to the catch-all screen', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_bootScope());
    await tester.pumpAndSettle();

    final BuildContext context = tester.element(find.byType(ShellScreen));
    context.go('/no-such-location');
    await tester.pumpAndSettle();

    expect(find.byType(NotFoundScreen), findsOneWidget);
    expect(find.text('الصفحة غير موجودة'), findsOneWidget);
  });
}
