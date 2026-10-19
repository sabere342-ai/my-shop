import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/auth/app_session_notifier.dart';
import 'package:my_shop_desktop/core/auth/auth_composition.dart';
import 'package:my_shop_desktop/core/auth/session_state.dart';
import 'package:my_shop_desktop/core/ui/components/app_button.dart';
import 'package:my_shop_desktop/features/auth/sign_in_screen.dart';
import 'package:my_shop_desktop/l10n/app_localizations.dart';

import 'auth_test_harness.dart';

/// Widget coverage of the sign-in surface (slice record point 7, AC-3).
///
/// The screen is pumped over the real app session controller and a real
/// [AuthService] behind a scripted transport, so what is asserted is the
/// honest pipeline screen → controller → flow → server answer: the copy a
/// user sees comes only from the closed catalog (§34.3), and a refusal never
/// becomes a session.
void main() {
  final AppLocalizations ar = lookupAppLocalizations(const Locale('ar'));

  AppLocalizations localizationsOf(WidgetTester tester) =>
      AppLocalizations.of(tester.element(find.byType(SignInScreen)))!;

  Widget scope(ScriptedServer server) {
    return ProviderScope(
      overrides: [
        appSessionProvider.overrideWith(_SignedOutSession.new),
        authKitProvider.overrideWithValue(
          testAuthKit(server: server, keystore: RecordingKeystore()),
        ),
      ],
      child: const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        locale: Locale('ar'),
        home: SignInScreen(),
      ),
    );
  }

  testWidgets('renders the Arabic-first credential surface', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(scope(ScriptedServer()));
    await tester.pumpAndSettle();

    final AppLocalizations l10n = localizationsOf(tester);
    // The title and the action label share the same Arabic word pair in the
    // catalog, so the surface carries them twice by design.
    expect(find.text(ar.authSignInTitle), findsAtLeastNWidgets(1));
    expect(find.byType(TextField), findsNWidgets(2));
    expect(
      find.widgetWithText(AppButton, l10n.authSignInAction),
      findsOneWidget,
    );
  });

  testWidgets(
    'a refused sign-in surfaces the mapped problem message and no session',
    (WidgetTester tester) async {
      final ScriptedServer server = ScriptedServer()
        ..route(
          'POST',
          '/api/v1/auth/login',
          (_, _) => problem('RATE_LIMITED', status: 429),
        );
      await tester.pumpWidget(scope(server));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).at(0), 'owner@myshop.test');
      await tester.enterText(find.byType(TextField).at(1), 'wrong');
      await tester.tap(find.widgetWithText(AppButton, ar.authSignInAction));
      await tester.pumpAndSettle();

      expect(find.text(ar.authRateLimited), findsOneWidget);
      expect(
        find.byType(TextField),
        findsNWidgets(2),
        reason: 'the attempt is rendered, the fields stay',
      );
      expect(
        tester.widget<AppButton>(find.byType(AppButton)).onPressed,
        isNotNull,
        reason: 'the attempt is over; the user may try again',
      );
    },
  );

  testWidgets('an attempt the transport withheld is honest about it', (
    WidgetTester tester,
  ) async {
    // No login route: an unrouted call is the harness's stand-in for a
    // transport that never delivered a verdict.
    await tester.pumpWidget(scope(ScriptedServer()));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).at(0), 'owner@myshop.test');
    await tester.enterText(find.byType(TextField).at(1), 'x');
    await tester.tap(find.widgetWithText(AppButton, ar.authSignInAction));
    await tester.pumpAndSettle();

    expect(find.text(ar.authWithheld), findsOneWidget);
  });
}

/// A session controller pinned at signed-out, so the screen's own watcher has
/// an honest value while the flow does its work with the overridden kit.
class _SignedOutSession extends AppSessionNotifier {
  @override
  AppSessionState build() => const AppSessionState.signedOut();
}
