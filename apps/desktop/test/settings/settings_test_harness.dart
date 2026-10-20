/// The M3-S4 settings test harness — shared fixtures and provider overrides
/// (§6.5: tests drive real transitions with injectable fakes; no service
/// locator).
///
/// It reuses the M2-S7 auth harness's scripted HTTP server (`ScriptedServer`,
/// `jsonOk`, `problem`, `bodyOf`) so the settings wire surface is driven
/// exactly as production would be, and the M1b memory-database helper so the
/// §38.18 cache runs against real Drift, not a mock.
///
/// Test ids and sentinel token rules are inherited from the auth harness.
library;

import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:my_shop_desktop/core/auth/auth_composition.dart';
import 'package:my_shop_desktop/core/offline/settings/settings_snapshot_cache.dart';
import 'package:my_shop_desktop/features/settings/settings_composition.dart';
import 'package:my_shop_desktop/features/settings/settings_gates.dart';

import '../auth/auth_test_harness.dart';

export '../auth/auth_test_harness.dart'
    show
        ScriptedServer,
        jsonOk,
        problem,
        bodyOf,
        memoryDatabase,
        testOrganizationId,
        testSecondOrganizationId,
        testDeviceId,
        testUserId;

/// The §22.2 owner-exclusive fields' effective profile for an owner with the
/// settings and pricing grants (§11.4: explicit server-derived sets, never
/// role names).
const List<String> ownerPermissions = <String>[
  SettingsPermission.settingsView,
  SettingsPermission.settingsEdit,
  SettingsPermission.pricingPolicyEdit,
];

/// A general-manager profile: same grants, non-owner.
const List<String> managerPermissions = ownerPermissions;

/// A cashier-style profile: view only.
const List<String> viewerPermissions = <String>[SettingsPermission.settingsView];

/// A profile whose view grant was denied away (§11.4: deny over allow).
const List<String> deniedPermissions = <String>[];

/// The canonical §22.2/§22.4 settings row the server would answer with —
/// every field the strict parser requires, with per-field overridable
/// values (acceptance tests pass `overrides` to corrupt one field at a
/// time).
Map<String, Object?> settingsPayload({
  String organizationId = testOrganizationId,
  Object? settingsVersion = 7,
  Object? organizationName = 'مطعم النور',
  Object? displayNumerals = 'WESTERN',
  Object? pricingMode = 'FIXED',
  Object? maxDiscountPercentage = 25,
  Object? maxDiscountAmountMinor = '100000',
  Object? discountApprovalThresholdMinor,
  Object? discountAllowedForSalesperson = true,
  Object? blockDiscountBelowCost = true,
  Object? invoiceFooter = '',
  Object? invoiceShowLogo = true,
  Object? customerRequiredOnCreditSale = true,
  Object? roundingMode = 'HALF_UP',
  Object? receivablesAgingEnabled = true,
  Object? offlineGraceDurationSeconds = 900,
  Object? offlineReservedNumberBlocks = true,
  Object? reservedBlockSize = 100,
  List<Object?>? featureFlags,
  Map<String, Object?> overrides = const <String, Object?>{},
}) {
  final Map<String, Object?> payload = <String, Object?>{
    'organizationId': organizationId,
    'settingsVersion': settingsVersion,
    'updatedAt': '2026-05-01T10:00:00.000Z',
    'organizationName': organizationName,
    'currency': 'EGP',
    'minorUnitExponent': 2,
    'displayNumerals': displayNumerals,
    'pricingMode': pricingMode,
    'maxDiscountPercentage': maxDiscountPercentage,
    'maxDiscountAmountMinor': maxDiscountAmountMinor,
    'discountApprovalThresholdMinor': discountApprovalThresholdMinor,
    'discountAllowedForSalesperson': discountAllowedForSalesperson,
    'blockDiscountBelowCost': blockDiscountBelowCost,
    'invoiceOutputDefault': 'ALWAYS_ASK',
    'invoiceFooter': invoiceFooter,
    'invoiceShowLogo': invoiceShowLogo,
    'customerRequiredOnCreditSale': customerRequiredOnCreditSale,
    'roundingMode': roundingMode,
    'receivablesAgingEnabled': receivablesAgingEnabled,
    'offlineGraceDurationSeconds': offlineGraceDurationSeconds,
    'offlineReceiptIdFormat': 'ORG-DEV-SEQ',
    'offlineReservedNumberBlocks': offlineReservedNumberBlocks,
    'reservedBlockSize': reservedBlockSize,
    'featureFlags': featureFlags ?? <Object?>[],
  };
  payload.addAll(overrides);
  return payload;
}

/// The `GET authorization/me` answer shape (§11) for one effective profile.
Map<String, Object?> authorizationPayload({
  List<String> permissions = ownerPermissions,
  bool isOwner = true,
  String? roleKey = 'owner',
  String organizationId = testOrganizationId,
}) {
  return <String, Object?>{
    'organizationId': organizationId,
    'userId': testUserId,
    'permissionsVersion': 3,
    'isOwner': isOwner,
    'roleKey': roleKey,
    'permissions': permissions,
  };
}

/// The settings GET/PUT route for the test organization.
String get settingsPath =>
    '/api/v1/organizations/$testOrganizationId/settings';

/// The §11 authorization route for the test organization.
String get authorizationPath =>
    '/api/v1/organizations/$testOrganizationId/authorization/me';

/// Routes the standard pair: settings + authorization on the test
/// organization (a suite can re-route any route afterwards to override it).
void routeStandard({
  required ScriptedServer server,
  required Map<String, Object?> settings,
  List<String> permissions = ownerPermissions,
  bool isOwner = true,
}) {
  server.route('GET', settingsPath, (_, _) => jsonOk(settings));
  server.route(
    'GET',
    authorizationPath,
    (_, _) => jsonOk(
      authorizationPayload(permissions: permissions, isOwner: isOwner),
    ),
  );
}

/// The provider overrides every settings suite is built on: the wire goes
/// through the scripted server, and the §38.18 cache is a memory Drift
/// database. A suite may hand in its own [cache] instance — the widget suites
/// do, so they can seed a cached snapshot the display then falls back to.
List<Override> settingsOverrides(
  ScriptedServer server, {
  SettingsSnapshotCache? cache,
}) => <Override>[
      authKitProvider.overrideWithValue(testAuthKit(server: server)),
      settingsSnapshotCacheProvider.overrideWithValue(
        cache ?? SettingsSnapshotCache(memoryDatabase()),
      ),
    ];

/// The fixed §9.3-derived session context the settings surfaces read
/// (`present: false` removes it entirely — the signed-out context).
List<Override> sessionContextOverrides({
  String organizationId = testOrganizationId,
  String userId = testUserId,
  bool present = true,
}) =>
    present
        ? <Override>[
            settingsSessionContextProvider.overrideWithValue(
              SettingsSessionContext(
                organizationId: organizationId,
                userId: userId,
              ),
            ),
          ]
        : <Override>[];
