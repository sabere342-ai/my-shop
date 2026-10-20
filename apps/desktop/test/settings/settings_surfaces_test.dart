import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/settings/settings_snapshot_cache.dart';
import 'package:my_shop_desktop/core/ui/components/app_button.dart';
import 'package:my_shop_desktop/features/settings/screens/general_settings_screen.dart';
import 'package:my_shop_desktop/features/settings/screens/pricing_settings_screen.dart';
import 'package:my_shop_desktop/features/settings/screens/settings_hub_screen.dart';
import 'package:my_shop_desktop/features/settings/screens/settings_scaffold.dart'
    show SettingsEditorActions;
import 'package:my_shop_desktop/features/settings/widgets/settings_status_line.dart';
import 'package:my_shop_desktop/l10n/app_localizations.dart';

import 'settings_test_harness.dart';

/// Widget coverage of the three settings surfaces: the §22 hub, the §22.2/§22.4
/// general editor, and the §17/§18 pricing editor.
///
/// Every suite drives the real pipeline screen → feed controller → repository
/// → scripted server (and the real §38.18 cache when an offline case needs
/// it), so what is asserted is what a user sees from the closed catalog
/// (§6.8): live-vs-cached naming, affordances arranged by the §22.2 column,
/// the unsaved-changes honesty, and the §38.18 conflict reconciliation —
/// whose save flow never touches a draft controller (mission §6).
void main() {
  final AppLocalizations ar = lookupAppLocalizations(const Locale('ar'));

  /// Pumps [home] under the one scope every settings surface needs: the
  /// scripted transport, the memory cache, and the fixed session context.
  Future<void> pumpSurface(
    WidgetTester tester, {
    required ScriptedServer server,
    SettingsSnapshotCache? cache,
    required Widget home,
  }) async {
    // The long settings lists are virtualized; this suite must see every row
    // (the editor row sits at the list's end), so the viewport is tall.
    tester.view.physicalSize = const Size(1000, 3000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final List<Override> overrides = <Override>[
      ...settingsOverrides(server, cache: cache),
      ...sessionContextOverrides(),
    ];
    await tester.pumpWidget(
      ProviderScope(
        overrides: overrides,
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          locale: const Locale('ar'),
          home: home,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  /// The TextField a keyed settings text field renders.
  TextField textFieldOf(WidgetTester tester, Key fieldKey) =>
      tester.widget<TextField>(
        find.descendant(
          of: find.byKey(fieldKey),
          matching: find.byType(TextField),
        ),
      );

  /// The switch of one settings switch row.
  Switch switchOf(WidgetTester tester, int index) =>
      tester.widget<Switch>(find.byType(Switch).at(index));

  /// The editor row's rendered state.
  SettingsEditorActions editorRow(WidgetTester tester) =>
      tester.widget<SettingsEditorActions>(find.byType(SettingsEditorActions));

  /// Seeds a §38.18 snapshot for a given organization and version.
  Future<SettingsSnapshotCache> seedCache(
    AppDatabase db, {
    int version = 5,
  }) {
    final SettingsSnapshotCache cache = SettingsSnapshotCache(db);
    return cache
        .save(
          payloadJson: settingsPayload(settingsVersion: version),
          fetchedAt: DateTime.utc(2026, 5, 1, 12),
          fetchedByUserId: testUserId,
        )
        .then((SettingsCacheWrite _) => cache);
  }

  group('the settings hub (§22)', () {
    testWidgets('a live display names the entries and the live source', (
      WidgetTester tester,
    ) async {
      final ScriptedServer server = ScriptedServer();
      routeStandard(server: server, settings: settingsPayload());

      await pumpSurface(
        tester,
        server: server,
        home: const SettingsHubScreen(),
      );

      expect(find.text(ar.settingsSourceLive), findsOneWidget);
      expect(find.text(ar.settingsEntryGeneral), findsOneWidget);
      expect(find.text(ar.settingsEntryPricing), findsOneWidget);
      // A live display needs no reconnect affordance; that is the offline
      // mirror's control (§38.18).
      expect(find.byType(SettingsRefreshAction), findsNothing);
    });

    testWidgets('a server denial renders the honest denied surface', (
      WidgetTester tester,
    ) async {
      final ScriptedServer server = ScriptedServer()
        ..route(
          'GET',
          '/api/v1/organizations/$testOrganizationId/authorization/me',
          (_, _) => problem('PERMISSION_DENIED', status: 403),
        )
        ..route(
          'GET',
          settingsPath,
          (_, _) => problem('PERMISSION_DENIED', status: 403),
        );

      await pumpSurface(
        tester,
        server: server,
        home: const SettingsHubScreen(),
      );

      expect(find.text(ar.settingsDeniedTitle), findsOneWidget);
      // A denial never renders a fabricated frame with entries on it.
      expect(find.text(ar.settingsEntryGeneral), findsNothing);
    });

    testWidgets('a withheld attempt with no cache names the missing cache', (
      WidgetTester tester,
    ) async {
      // No routes at all: both reads are withheld, and the §38.18 cache is
      // empty — the fresh-offline-device state (§38.18).
      final ScriptedServer server = ScriptedServer();

      await pumpSurface(
        tester,
        server: server,
        home: const SettingsHubScreen(),
      );

      expect(find.text(ar.settingsOfflineNoCache), findsOneWidget);
      expect(find.text(ar.settingsEntryGeneral), findsNothing);
    });

    testWidgets('a cached display shows the offline honesty and reconnect', (
      WidgetTester tester,
    ) async {
      final AppDatabase db = memoryDatabase();
      final SettingsSnapshotCache cache = await seedCache(db);
      // No route: the GET is withheld, so the display is the cached row.
      final ScriptedServer server = ScriptedServer();
      try {
        await pumpSurface(
          tester,
          server: server,
          cache: cache,
          home: const SettingsHubScreen(),
        );

        expect(find.text(ar.settingsOfflineBanner), findsOneWidget);
        // The cached display carries the reconnect affordance ("refresh when
        // connectivity returns") and still shows the entries over the cached
        // mirror.
        expect(find.byType(SettingsRefreshAction), findsOneWidget);
        expect(find.text(ar.settingsEntryGeneral), findsOneWidget);
      } finally {
        await db.close();
      }
    });
  });

  group('the general settings screen (§22.2/§22.4)', () {
    testWidgets('an owner live display: editable fields on, owner facts off', (
      WidgetTester tester,
    ) async {
      final ScriptedServer server = ScriptedServer();
      routeStandard(server: server, settings: settingsPayload());

      await pumpSurface(
        tester,
        server: server,
        home: const GeneralSettingsScreen(),
      );

      final TextField name = textFieldOf(
        tester,
        const Key('general-name-field'),
      );
      expect(name.enabled, isTrue);
      expect(name.controller!.text, 'مطعم النور');

      // The §22.2 owner-exclusive read-only facts (grace, block size, minor
      // unit, rounding mode) render disabled whatever the profile is — this
      // client offers them as facts, never as draft offers.
      expect(
        textFieldOf(tester, const Key('general-minor-unit-field')).enabled,
        isFalse,
      );

      expect(editorRow(tester).unsavedCount, 0);
    });

    testWidgets('typing shows the unsaved count; the save crosses exactly '
        'the touched fields and lands as the server row', (
      WidgetTester tester,
    ) async {
      final ScriptedServer server = ScriptedServer();
      routeStandard(server: server, settings: settingsPayload());
      Map<String, Object?>? sentBody;
      server.route('PUT', settingsPath, (request, _) {
        sentBody = bodyOf(request);
        return jsonOk(settingsPayload(settingsVersion: 8));
      });

      await pumpSurface(
        tester,
        server: server,
        home: const GeneralSettingsScreen(),
      );

      await tester.enterText(
        find.byKey(const Key('general-name-field')),
        'مطعم النور المطاعم',
      );
      await tester.pumpAndSettle();
      expect(editorRow(tester).unsavedCount, 1, reason: 'one touched field');
      expect(find.text(ar.settingsUnsavedLine(1)), findsOneWidget);

      await tester.tap(find.widgetWithText(AppButton, ar.settingsSaveAction));
      await tester.pumpAndSettle();

      // The PUT crossed only the touched field and the version token.
      expect(sentBody, isNotNull);
      expect(sentBody!['settingsVersion'], 7);
      expect(sentBody!['organizationName'], 'مطعم النور المطاعم');

      // The success banner shows, the draft was consumed, and the row is the
      // server's canonical answer (version 8).
      expect(find.text(ar.settingsSaved), findsOneWidget);
      expect(find.text(ar.settingsUnsavedLine(1)), findsNothing);
      expect(editorRow(tester).unsavedCount, 0);
    });

    testWidgets('a cached display locks every control and hides the save', (
      WidgetTester tester,
    ) async {
      final AppDatabase db = memoryDatabase();
      final SettingsSnapshotCache cache = await seedCache(db);
      // No routes: the display is the cached mirror (§38.18 read-only).
      final ScriptedServer server = ScriptedServer();
      try {
        await pumpSurface(
          tester,
          server: server,
          cache: cache,
          home: const GeneralSettingsScreen(),
        );

        expect(find.text(ar.settingsOfflineBanner), findsOneWidget);
        expect(
          textFieldOf(tester, const Key('general-name-field')).enabled,
          isFalse,
        );
        expect(switchOf(tester, 0).onChanged, isNull);
        // The save affordance is the row being hidden entirely — not a
        // disabled one (§38.18: the cache is a read-only mirror; there is no
        // offline edit path, not even a privileged one).
        expect(editorRow(tester).enabled, isFalse);
      } finally {
        await db.close();
      }
    });

    testWidgets('a view-only profile cannot edit a field', (
      WidgetTester tester,
    ) async {
      final ScriptedServer server = ScriptedServer();
      routeStandard(
        server: server,
        settings: settingsPayload(),
        permissions: viewerPermissions,
        isOwner: false,
      );

      await pumpSurface(
        tester,
        server: server,
        home: const GeneralSettingsScreen(),
      );

      expect(
        textFieldOf(tester, const Key('general-name-field')).enabled,
        isFalse,
      );
      expect(switchOf(tester, 0).onChanged, isNull);
      expect(editorRow(tester).enabled, isFalse);
    });
  });

  group('the pricing settings screen (§17/§18)', () {
    testWidgets('an owner live display offers the three explained modes', (
      WidgetTester tester,
    ) async {
      final ScriptedServer server = ScriptedServer();
      routeStandard(server: server, settings: settingsPayload());

      await pumpSurface(
        tester,
        server: server,
        home: const PricingSettingsScreen(),
      );

      expect(find.byKey(const Key('pricing-mode-FIXED')), findsOneWidget);
      expect(find.byKey(const Key('pricing-mode-VARIABLE')), findsOneWidget);
      expect(
        find.byKey(const Key('pricing-mode-FIXED_WITH_DISCOUNT')),
        findsOneWidget,
        reason: 'every §17 mode is offered',
      );
      final TextField percentage = textFieldOf(
        tester,
        const Key('pricing-percentage-field'),
      );
      expect(percentage.enabled, isTrue);
      expect(percentage.controller!.text, '25');
      expect(
        textFieldOf(tester, const Key('pricing-threshold-field')).enabled,
        isTrue,
      );
    });

    testWidgets('a material save runs the explicit confirmation first, then '
        'the PUT crosses the touched §18 fields', (WidgetTester tester) async {
      final ScriptedServer server = ScriptedServer();
      routeStandard(server: server, settings: settingsPayload());
      Map<String, Object?>? sentBody;
      server.route('PUT', settingsPath, (request, _) {
        sentBody = bodyOf(request);
        return jsonOk(settingsPayload(
          settingsVersion: 8,
          maxDiscountPercentage: 5,
        ));
      });

      await pumpSurface(
        tester,
        server: server,
        home: const PricingSettingsScreen(),
      );

      await tester.enterText(
        find.byKey(const Key('pricing-percentage-field')),
        '5',
      );
      await tester.pumpAndSettle();
      expect(find.text(ar.settingsUnsavedLine(1)), findsOneWidget);

      await tester.tap(find.widgetWithText(AppButton, ar.settingsSaveAction));
      await tester.pumpAndSettle();

      // The §18 materiality question came first — no PUT ran yet.
      expect(sentBody, isNull, reason: 'the confirmation gates the write');
      expect(find.text(ar.settingsConfirmMaterialTitle), findsOneWidget);
      await tester.tap(find.descendant(
        of: find.byType(AlertDialog),
        matching: find.widgetWithText(AppButton, ar.settingsSaveAction),
      ));
      await tester.pumpAndSettle();

      // An integral percentage crosses as a JSON number without a fraction
      // tail (the §34.1 rendering decision).
      expect(sentBody, isNotNull);
      expect(sentBody!['settingsVersion'], 7);
      expect(sentBody!['maxDiscountPercentage'], 5);
      expect(find.text(ar.settingsSaved), findsOneWidget);
      expect(find.text(ar.settingsUnsavedLine(1)), findsNothing);
    });

    testWidgets('a §38.18 conflict keeps the draft through the dialog while '
        'keep reconciles by reloading', (WidgetTester tester) async {
      final ScriptedServer server = ScriptedServer();
      routeStandard(server: server, settings: settingsPayload());
      server.route('PUT', settingsPath, (request, scripted) {
        // On the conflict, the server is where a concurrent winner's row
        // lands: the reconciliation's reload must answer it.
        scripted.route(
          'GET',
          settingsPath,
          (_, _) => jsonOk(settingsPayload(settingsVersion: 9)),
        );
        return problem('SETTINGS_VERSION_CONFLICT', status: 409);
      });

      await pumpSurface(
        tester,
        server: server,
        home: const PricingSettingsScreen(),
      );

      await tester.enterText(
        find.byKey(const Key('pricing-percentage-field')),
        '5',
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(AppButton, ar.settingsSaveAction));
      await tester.pumpAndSettle();
      await tester.tap(find.descendant(
        of: find.byType(AlertDialog),
        matching: find.widgetWithText(AppButton, ar.settingsSaveAction),
      ));
      // The conflict flow chains: confirmation → PUT → conflict dialog →
      // (later) keep → reload. Bounded pumps let the real async chain land
      // without depending on every frame settling.
      for (int i = 0; i < 30; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }

      // The conflict dialog shows with its catalogued choices, and the typed
      // draft is still in the field: the flow never touches a draft (§6).
      expect(find.text(ar.settingsConflictTitle), findsOneWidget);
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(
        textFieldOf(
          tester,
          const Key('pricing-percentage-field'),
        ).controller!.text,
        '5',
      );

      await tester.tap(
        find.widgetWithText(AppButton, ar.settingsKeepDraftAction),
      );
      for (int i = 0; i < 30; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }

      // Keep closes the dialog and reloads the winner's canonical row: the
      // line now names the winner's version (9), and the save row's busy
      // state is over.
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.text(ar.settingsVersionLive(9)), findsOneWidget);
      expect(editorRow(tester).busy, isFalse);
      // The new display re-baselines every untouched-draft field to the
      // winner's row: stale typed offers are never carried onto a new base.
      expect(
        textFieldOf(
          tester,
          const Key('pricing-percentage-field'),
        ).controller!.text,
        '25',
      );
    });

    testWidgets('a refused save keeps the draft intact for correction, and '
        'the refusal is the catalogued copy', (WidgetTester tester) async {
      final ScriptedServer server = ScriptedServer();
      routeStandard(server: server, settings: settingsPayload());
      server.route('PUT', settingsPath,
          (_, _) => problem('PERMISSION_DENIED', status: 403));

      await pumpSurface(
        tester,
        server: server,
        home: const PricingSettingsScreen(),
      );

      await tester.enterText(
        find.byKey(const Key('pricing-percentage-field')),
        '5',
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(AppButton, ar.settingsSaveAction));
      await tester.pumpAndSettle();
      await tester.tap(find.descendant(
        of: find.byType(AlertDialog),
        matching: find.widgetWithText(AppButton, ar.settingsSaveAction),
      ));
      await tester.pumpAndSettle();

      expect(find.text(ar.settingsSaveRefused), findsOneWidget);
      // The draft was not consumed by a refusal: the field still carries the
      // typed value, and the unsaved count stands at one.
      expect(
        textFieldOf(
          tester,
          const Key('pricing-percentage-field'),
        ).controller!.text,
        '5',
      );
      expect(find.text(ar.settingsUnsavedLine(1)), findsOneWidget);
    });

    testWidgets('a cached display locks the whole policy editor', (
      WidgetTester tester,
    ) async {
      final AppDatabase db = memoryDatabase();
      final SettingsSnapshotCache cache = await seedCache(db);
      final ScriptedServer server = ScriptedServer();
      try {
        await pumpSurface(
          tester,
          server: server,
          cache: cache,
          home: const PricingSettingsScreen(),
        );

        expect(find.text(ar.settingsOfflineBanner), findsOneWidget);
        expect(
          textFieldOf(tester, const Key('pricing-percentage-field')).enabled,
          isFalse,
        );
        expect(switchOf(tester, 0).onChanged, isNull);
        expect(editorRow(tester).enabled, isFalse);
      } finally {
        await db.close();
      }
    });
  });
}
