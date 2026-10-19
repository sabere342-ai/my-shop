import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/auth/app_session_notifier.dart';
import 'package:my_shop_desktop/core/auth/auth_composition.dart';
import 'package:my_shop_desktop/core/auth/auth_session.dart';
import 'package:my_shop_desktop/core/auth/session_state.dart';
import 'package:my_shop_desktop/features/auth/organization_setup_screen.dart';
import 'package:my_shop_desktop/l10n/app_localizations.dart';

import 'auth_test_harness.dart';

/// Widget coverage of the organization-setup surface (slice record point 7,
/// AC-4).
///
/// The surface can only ever render the membership ids the session carries —
/// ids the verified `/auth/me` put there — and choosing one goes through the
/// controller, which re-checks it against the same verified memberships. No
/// local organizer, no invented id.
void main() {
  final AppLocalizations ar = lookupAppLocalizations(const Locale('ar'));
  const AuthSession multiMembership = AuthSession(
    userId: testUserId,
    email: 'owner@myshop.test',
    sessionId: testSessionId,
    organizations: <String>[testOrganizationId, testSecondOrganizationId],
    organizationId: null,
  );

  MaterialApp screenSession(AppSessionNotifier notifier) => const MaterialApp(
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    locale: Locale('ar'),
    home: OrganizationSetupScreen(),
  );

  ProviderScope pump(AppSessionNotifier notifier) => ProviderScope(
    overrides: [
      appSessionProvider.overrideWith(() => notifier),
      authKitProvider.overrideWithValue(testAuthKit(server: ScriptedServer())),
    ],
    child: screenSession(notifier),
  );

  testWidgets('offers exactly the verified memberships, and nothing else', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(pump(_FixedSession(multiMembership)));
    await tester.pumpAndSettle();

    expect(find.byType(ListTile), findsNWidgets(2));
    expect(find.text(testOrganizationId), findsOneWidget);
    expect(find.text(testSecondOrganizationId), findsOneWidget);
    expect(find.text('99999999-9999-4999-8999-999999999999'), findsNothing);
  });

  testWidgets(
    'a refusal that leaves the session standing re-enables the choice',
    (WidgetTester tester) async {
      final _DeferringSession notifier = _DeferringSession(multiMembership);
      await tester.pumpWidget(pump(notifier));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey<String>(testOrganizationId)));
      await tester.pumpAndSettle();

      expect(notifier.choseWith, testOrganizationId);
      expect(
        tester
            .widget<ListTile>(
              find.byKey(const ValueKey<String>(testOrganizationId)),
            )
            .enabled,
        isTrue,
      );
    },
  );

  testWidgets('a missing session is an honest empty state', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(pump(_SignedOutStub()));
    await tester.pumpAndSettle();

    expect(find.text(ar.authSessionMissing), findsOneWidget);
    expect(find.byType(ListTile), findsNothing);
  });
}

/// A stub over the app session controller whose state is a fixed session —
/// the widget under test never touches the flow's durable home.
class _FixedSession extends AppSessionNotifier {
  _FixedSession(this._session);

  final AuthSession _session;

  @override
  AppSessionState build() => AppSessionState.signedIn(_session);
}

/// The same, but every choice is answered with the withheld kind — which, per
/// the screen's own contract, leaves the session standing and the row
/// un-busied again.
class _DeferringSession extends _FixedSession {
  _DeferringSession(super.session) : _choseWith = null;

  String? _choseWith;

  String? get choseWith => _choseWith;

  @override
  Future<SignInResult> chooseOrganization({
    required AuthSession session,
    required String organizationId,
  }) async {
    _choseWith = organizationId;
    return const SignInResult.withheld('the script refuses this choice');
  }
}

class _SignedOutStub extends AppSessionNotifier {
  @override
  AppSessionState build() => const AppSessionState.signedOut();
}
