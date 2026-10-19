import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/app/router/shell_screen.dart';
import 'package:my_shop_desktop/core/auth/app_session_notifier.dart';
import 'package:my_shop_desktop/core/auth/auth_composition.dart';
import 'package:my_shop_desktop/core/auth/session_state.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_auth_gate.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_service.dart';
import 'package:my_shop_desktop/l10n/app_localizations.dart';

import 'auth_test_harness.dart';

/// Widget coverage of the shell's one calm grace line (slice record point 7,
/// AC-7, §38.31).
///
/// The shell reads the offline-grace status through the real session
/// controller's delegate into the real `OfflineGraceService` and never
/// re-implements admission; the fixture instead answers the delegate with the
/// three status postures, so each surface's honest line is asserted without
/// building an offline state machine (the service's own suites own that).
void main() {
  final AppLocalizations ar = lookupAppLocalizations(const Locale('ar'));

  OfflineGraceStatus status({
    required bool hasSession,
    bool readOnly = false,
  }) => OfflineGraceStatus(
    hasSession: hasSession,
    isReadOnlyForMutations: readOnly,
    refusalReason: readOnly ? MutationRefusalReason.graceExpired : null,
    expiresAt: hasSession
        ? DateTime.now().add(const Duration(hours: 24))
        : null,
    permissionsVersion: hasSession ? 7 : null,
    permissions: hasSession ? const <String>['sales.create'] : const <String>[],
  );

  Widget shellFor(FutureOr<OfflineGraceStatus> Function() answer) =>
      ProviderScope(
        overrides: [
          appSessionProvider.overrideWith(() => _FixedGraceSession(answer)),
          authKitProvider.overrideWithValue(
            testAuthKit(server: ScriptedServer()),
          ),
        ],
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          locale: Locale('ar'),
          home: ShellScreen(),
        ),
      );

  testWidgets('no grace session: no line at all — the honest shrink', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(shellFor(() => status(hasSession: false)));
    await tester.pumpAndSettle();

    expect(find.text(ar.shellGraceActive), findsNothing);
    expect(find.text(ar.shellGraceReadOnly), findsNothing);
    expect(find.byType(ShellScreen), findsOneWidget);
  });

  testWidgets('an admissible session renders one calm, non-shouting line', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(shellFor(() => status(hasSession: true)));
    await tester.pumpAndSettle();

    expect(find.text(ar.shellGraceActive), findsOneWidget);
    expect(find.text(ar.shellGraceReadOnly), findsNothing);
  });

  testWidgets(
    'a read-only session renders the expiry-consequence line, reads continue',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        shellFor(() => status(hasSession: true, readOnly: true)),
      );
      await tester.pumpAndSettle();

      expect(find.text(ar.shellGraceReadOnly), findsOneWidget);
      expect(find.text(ar.shellGraceActive), findsNothing);
    },
  );

  testWidgets('an unavailable grace read shows the unavailable line', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(shellFor(() => throw const _GraceUnread()));
    await tester.pumpAndSettle();

    // A grace read that could not answer never invents a posture: the shell
    // shows its own catalogued unavailable line (§38.31) and stays standing.
    expect(find.text(ar.shellGraceUnavailable), findsOneWidget);
    expect(find.text(ar.appTitle), findsOneWidget);
  });
}

class _GraceUnread implements Exception {
  const _GraceUnread();
}

/// A session controller whose only duty to the shell is the grace status the
/// fixture dictates. Build stays at signed-out — the shell under test never
/// reads the phase.
class _FixedGraceSession extends AppSessionNotifier {
  _FixedGraceSession(this._answer);

  final FutureOr<OfflineGraceStatus> Function() _answer;

  @override
  AppSessionState build() => const AppSessionState.signedOut();

  @override
  Future<OfflineGraceStatus> graceStatus() async => _answer();
}
