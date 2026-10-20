/// The composition of the client's settings capability (Master Plan §6.5:
/// constructor injection everywhere, no service locator; ADR-003). It follows
/// the same shape as `core/auth/auth_composition.dart`: one injectable kit,
/// one provider per dependency edge, and one feed controller per feature
/// screen group (§6.4's controller rule).
///
/// Session dependency discipline: every wire call here derives the tenant and
/// the actor from the signed-in session provider (`appSessionProvider`) —
/// never from a request body or an ambient static (§9.3). A session or
/// organization change rebuilds the feed (an organization switch must never
/// display the previous organization's settings, mission §7).
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_shop_desktop/core/api/api_failure.dart';
import 'package:my_shop_desktop/core/api/authorization_api.dart';
import 'package:my_shop_desktop/core/api/settings_api.dart';
import 'package:my_shop_desktop/core/auth/app_session_notifier.dart';
import 'package:my_shop_desktop/core/auth/auth_composition.dart'
    show appDatabaseProvider, authKitProvider;
import 'package:my_shop_desktop/core/auth/auth_session.dart';
import 'package:my_shop_desktop/core/auth/session_state.dart';
import 'package:my_shop_desktop/core/offline/settings/settings_snapshot_cache.dart';
import 'package:my_shop_desktop/features/settings/data/settings_repository.dart';
import 'package:my_shop_desktop/features/settings/models/organization_settings.dart';

/// The settings wire surface (transport-owned token, §13.6).
final settingsApiProvider = Provider<SettingsApi>((Ref ref) {
  return SettingsApi(ref.watch(authKitProvider).apiClient);
});

/// The authorization wire surface (§11 effective permissions).
final authorizationApiProvider = Provider<AuthorizationApi>((Ref ref) {
  return AuthorizationApi(ref.watch(authKitProvider).apiClient);
});

/// The §38.18 settings snapshot cache over the local database.
final settingsSnapshotCacheProvider = Provider<SettingsSnapshotCache>((Ref ref) {
  return SettingsSnapshotCache(ref.watch(appDatabaseProvider));
});

/// The settings feature's data boundary.
final settingsRepositoryProvider = Provider<SettingsRepository>((Ref ref) {
  return SettingsRepository(
    ref.watch(settingsApiProvider),
    ref.watch(settingsSnapshotCacheProvider),
  );
});

/// The tenant + actor context the feature reads the session for. `null`
/// means no usable settings context yet (signed out, or signed in without a
/// chosen organization — the router guard keeps those off the settings
/// routes, and the feed shows the honest empty frame).
final settingsSessionContextProvider = Provider<SettingsSessionContext?>((Ref ref) {
  final AppSessionState state = ref.watch(appSessionProvider);
  final AuthSession? session = state.session;
  final String? organizationId = session?.organizationId;
  if (organizationId == null) {
    return null;
  }
  return SettingsSessionContext(
    organizationId: organizationId,
    userId: session!.userId,
  );
});

/// The (organizationId, userId) pair the settings calls derive their scope
/// from.
class SettingsSessionContext {
  const SettingsSessionContext({required this.organizationId, required this.userId});

  final String organizationId;
  final String userId;

  @override
  bool operator ==(Object other) =>
      other is SettingsSessionContext &&
      other.organizationId == organizationId &&
      other.userId == userId;

  @override
  int get hashCode => Object.hash(organizationId, userId);
}

/// The display's kind, closed (mission §7: distinguish loading, denied,
/// failure, cached data, and confirmed live server data).
enum SettingsDisplayKind { loading, denied, loadFailed, cached, live }

/// The feed state the settings surfaces render (§6.4: all async state is
/// `AsyncValue`; the value itself carries the honest distinctions).
final class SettingsFeedState {
  const SettingsFeedState._({
    required this.kind,
    this.settings,
    this.authorization,
    this.cachedFetchedAt,
    this.deniedFailure,
    this.loadFailure,
    this.cacheCorruptionReason,
  });

  factory SettingsFeedState.loading() =>
      const SettingsFeedState._(kind: SettingsDisplayKind.loading);

  factory SettingsFeedState.live({
    required OrganizationSettings settings,
    EffectiveAuthorization? authorization,
  }) => SettingsFeedState._(
        kind: SettingsDisplayKind.live,
        settings: settings,
        authorization: authorization,
      );

  factory SettingsFeedState.cached({
    required OrganizationSettings settings,
    required DateTime fetchedAt,
    EffectiveAuthorization? authorization,
  }) => SettingsFeedState._(
        kind: SettingsDisplayKind.cached,
        settings: settings,
        authorization: authorization,
        cachedFetchedAt: fetchedAt,
      );

  factory SettingsFeedState.denied({
    required ApiFailure failure,
    EffectiveAuthorization? authorization,
  }) => SettingsFeedState._(
        kind: SettingsDisplayKind.denied,
        deniedFailure: failure,
        authorization: authorization,
      );

  factory SettingsFeedState.loadFailed({
    required ApiFailure failure,
    String? cacheCorruptionReason,
    EffectiveAuthorization? authorization,
  }) => SettingsFeedState._(
        kind: SettingsDisplayKind.loadFailed,
        loadFailure: failure,
        cacheCorruptionReason: cacheCorruptionReason,
        authorization: authorization,
      );

  final SettingsDisplayKind kind;

  /// The settings row on display: the server's canonical answer for [live],
  /// the structurally validated §38.18 replica for [cached], and **null** for
  /// [denied]/[loadFailed]/[loading] — a failure state never renders
  /// fabricated defaults.
  final OrganizationSettings? settings;

  /// The effective authorization profile, when the read answered.
  final EffectiveAuthorization? authorization;

  /// The §38.18 fetch metadata when [kind] is cached (mission §5: the actual
  /// cached version and a meaningful last-sync marker).
  final DateTime? cachedFetchedAt;

  /// The server's own refusal, when [kind] is [SettingsDisplayKind.denied].
  final ApiFailure? deniedFailure;

  /// The withheld-load failure, when [kind] is
  /// [SettingsDisplayKind.loadFailed].
  final ApiFailure? loadFailure;

  /// Set when a cache row existed but was refused as corrupt (mission §7).
  final String? cacheCorruptionReason;

  /// Whether mutating affordances may be offered at all: the display must be
  /// live server data with a loaded authorization profile. Offline displays
  /// never offer them (§38.18: no upward edits); an unreadable authorization
  /// profile withholds them too (§13.4: the client never *guesses* a
  /// permission it cannot verify).
  bool get mayOfferEdits =>
      kind == SettingsDisplayKind.live &&
      authorization != null;

  /// Whether a save attempt is admissible (the profile gates the *render*;
  /// the field-level gates gate the controls; the server is the authority).
  bool get canSave => mayOfferEdits;
}

/// The one feed controller the settings surfaces read.
final settingsFeedProvider =
    NotifierProvider<SettingsFeedController, AsyncValue<SettingsFeedState>>(
      SettingsFeedController.new,
    );

final class SettingsFeedController extends Notifier<AsyncValue<SettingsFeedState>> {
  /// Guards a duplicate concurrent load (mission §5: "retry without duplicate
  /// operations").
  bool _loadInFlight = false;

  /// The session context this display was built for; a change of
  /// organization restarts it (mission §7's organization-switch scenario).
  SettingsSessionContext? _context;

  @override
  AsyncValue<SettingsFeedState> build() {
    final SettingsSessionContext? context = ref.watch(settingsSessionContextProvider);
    if (context != _context) {
      _context = context;
      if (context != null) {
        // The first frame stays honest: `loading` now, the wire's answer
        // next (§6.4's AsyncValue rule; no fabricated rows in between).
        Future<void>(() async {
          await refresh();
        });
      }
    }
    try {
      return state;
    } on StateError {
      // Riverpod 3 keeps `state` unread until build has returned once; the
      // honest first frame is the loading value (never a fabricated row).
      return const AsyncValue<SettingsFeedState>.loading();
    }
  }

  /// One refresh: the §11 effective-permission read and the authoritative
  /// settings GET (which updates the §38.18 cache on the way through,
  /// §22.3 best effort), combined into one honest display state.
  Future<void> refresh() async {
    final SettingsSessionContext? context = ref.read(settingsSessionContextProvider);
    if (context == null) {
      state = AsyncValue<SettingsFeedState>.data(SettingsFeedState.loading());
      return;
    }
    if (_loadInFlight) {
      return;
    }
    _loadInFlight = true;
    try {
      final EffectiveAuthorization? authorization = await _loadAuthorization(context);
      final SettingsLoadOutcome outcome = await ref
          .read(settingsRepositoryProvider)
          .load(organizationId: context.organizationId, actorUserId: context.userId);

      final AsyncValue<SettingsFeedState> next = switch (outcome) {
        SettingsLive(settings: final OrganizationSettings live) =>
          AsyncValue<SettingsFeedState>.data(
            SettingsFeedState.live(settings: live, authorization: authorization),
          ),
        SettingsCached(snapshot: final CachedSettingsSnapshot snapshot) =>
          AsyncValue<SettingsFeedState>.data(
            SettingsFeedState.cached(
              settings: snapshot.settings,
              fetchedAt: snapshot.fetchedAt,
              authorization: authorization,
            ),
          ),
        SettingsDenied(failure: final ApiFailure failure) =>
          AsyncValue<SettingsFeedState>.data(
            SettingsFeedState.denied(failure: failure, authorization: authorization),
          ),
        SettingsLoadFailed(
          failure: final ApiFailure failure,
          cacheCorruptionReason: final String? reason,
        ) =>
          AsyncValue<SettingsFeedState>.data(
            SettingsFeedState.loadFailed(
              failure: failure,
              cacheCorruptionReason: reason,
              authorization: authorization,
            ),
          ),
      };
      state = next;
    } finally {
      _loadInFlight = false;
    }
  }

  /// The best-effort authorization read. A denial or a transport fault is
  /// carried as an explicit fact on the state — never as a guessed empty
  /// set that could silently enable or disable controls (mission §8).
  Future<EffectiveAuthorization?> _loadAuthorization(SettingsSessionContext session) async {
    try {
      return await ref
          .read(authorizationApiProvider)
          .me(organizationId: session.organizationId);
    } on ApiFailure {
      return null;
    }
  }

  /// Applies one field-authorized update. The outcome categories drive the
  /// screens' exact reactions (saved banner, conflict dialog with draft
  /// retention, refusal copy, honest offline message); a success also
  /// refreshes the §38.18 cache through the repository (§22.3).
  Future<SettingsSaveOutcome> save(Map<String, Object?> body) async {
    final SettingsSessionContext? context = ref.read(settingsSessionContextProvider);
    if (context == null) {
      return const SettingsSaveRefused(
        ApiFailure.failure(ApiErrorCode.unauthenticated),
      );
    }
    final SettingsSaveOutcome outcome = await ref.read(settingsRepositoryProvider).update(
          organizationId: context.organizationId,
          actorUserId: context.userId,
          body: body,
        );
    if (outcome case SettingsSaved(settings: final OrganizationSettings saved)) {
      final EffectiveAuthorization? currentAuthorization = state.value?.authorization;
      state = AsyncValue<SettingsFeedState>.data(
        SettingsFeedState.live(
          settings: saved,
          authorization: currentAuthorization,
        ),
      );
    }
    return outcome;
  }

  /// Reconciles a §38.18 conflict: an explicit reload of the authoritative
  /// row (the caller's draft lives in its own draft controllers and is never
  /// touched by this reload — mission §6's draft-preservation rule).
  Future<void> reload() => refresh();
}
