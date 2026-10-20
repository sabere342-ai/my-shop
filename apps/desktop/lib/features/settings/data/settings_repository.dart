/// The settings repository — the one boundary between the settings feature
/// and everything below it (transport, cache, session) (Master Plan §6.3
/// feature-first layering, §22.3, §38.18).
///
/// The load and save outcomes are closed values rather than exceptions,
/// because the honest categories the UI must distinguish are exactly these:
///
/// - **live** — the server answered; the values shown are the authoritative
///   ones (§40.7's "settings drive real behaviour online").
/// - **cached** — the network withheld the attempt (§38.11), and the versioned
///   §38.18 cache answered instead; what is shown is labelled stale with the
///   version it was fetched at, and every mutation affordance is disabled.
/// - **denied** — the server itself refused (a 401/403 problem document);
///   this is **never** softened into an offline state (mission §7: no generic
///   fallback may convert a real rejection into an offline success), and it
///   is never interpreted client-side: the server's code travels as it came.
/// - **withheld-load / withheld-save** — no HTTP answer at all; the save
///   variant exists to prove no false success, and the caller keeps its
///   draft.
/// - **conflict** — the §38.18 `409 SETTINGS_VERSION_CONFLICT`: the row
///   changed under the caller; the caller's draft is *not* discarded — the
///   repository's job is only to say it happened and hand back the failure.
/// - **refused** — a validation or other server-side refusal of the offered
///   body; same rule: reported, never softened.
library;

import 'package:my_shop_desktop/core/api/api_failure.dart';
import 'package:my_shop_desktop/core/api/settings_api.dart';
import 'package:my_shop_desktop/core/offline/settings/settings_snapshot_cache.dart';
import 'package:my_shop_desktop/features/settings/models/organization_settings.dart';

/// When the load answered and who can act on it.
final class SettingsLoadClock {
  const SettingsLoadClock({required this.nowFetchedAt, required this.actorUserId});

  final DateTime nowFetchedAt;
  final String actorUserId;
}

/// The outcome of one load attempt (mission §7's lifecycle).
sealed class SettingsLoadOutcome {
  const SettingsLoadOutcome();
}

/// The server's own answer; the authoritative row.
final class SettingsLive extends SettingsLoadOutcome {
  const SettingsLive(this.settings);

  final OrganizationSettings settings;
}

/// The §38.18 cache answered after a withheld attempt; versioned, stale-
/// labelled, mutation-free.
final class SettingsCached extends SettingsLoadOutcome {
  const SettingsCached(this.snapshot);

  final CachedSettingsSnapshot snapshot;
}

/// The server refused; no cache fallback is ever taken for a server decision
/// (mission §7) — the authorization problem travels as it came.
final class SettingsDenied extends SettingsLoadOutcome {
  const SettingsDenied(this.failure);

  final ApiFailure failure;
}

/// No authoritative answer and nothing usable cached. The [reason] tells the
/// two literal apart: a corrupted payload names itself; otherwise this is
/// the §38.18 "missing entirely" empty state.
final class SettingsLoadFailed extends SettingsLoadOutcome {
  const SettingsLoadFailed({required this.failure, this.cacheCorruptionReason});

  final ApiFailure failure;

  /// Set only when a cache row existed and was refused as corrupt.
  final String? cacheCorruptionReason;
}

/// The outcome of one update attempt.
sealed class SettingsSaveOutcome {
  const SettingsSaveOutcome();
}

final class SettingsSaved extends SettingsSaveOutcome {
  const SettingsSaved(this.settings);

  final OrganizationSettings settings;
}

final class SettingsSaveConflict extends SettingsSaveOutcome {
  const SettingsSaveConflict(this.failure);

  final ApiFailure failure;
}

final class SettingsSaveRefused extends SettingsSaveOutcome {
  const SettingsSaveRefused(this.failure);

  final ApiFailure failure;
}

/// The attempt never reached HTTP (§38.11): nothing is known about the
/// server's decision. Never presented as success; the draft survives.
final class SettingsSaveWithheld extends SettingsSaveOutcome {
  const SettingsSaveWithheld(this.failure);

  final ApiFailure failure;
}

/// The settings repository.
class SettingsRepository {
  SettingsRepository(this._api, this._cache, {this._now = DateTime.now});
  final SettingsApi _api;
  final SettingsSnapshotCache _cache;
  final DateTime Function() _now;

  /// Loads the settings for one organization:
  ///
  /// 1. try the authoritative GET (§40.7 online behaviour);
  /// 2. a 2xx updates the versioned cache (best effort — a cache-write
  ///    failure is never allowed to fail a live display of the same data);
  /// 3. a transport-class failure (no HTTP answer, or a 5xx the client
  ///    cannot treat as a decision) falls back to the §38.18 cache,
  ///    reporting its version and fetch time;
  /// 4. an authorization/HTTP-decision failure is returned as `denied` —
  ///    never as offline data (mission §7's anti-fallback rule);
  /// 5. a corrupt cache would have failed step 3 with its named reason.
  Future<SettingsLoadOutcome> load({
    required String organizationId,
    required String actorUserId,
  }) async {
    final DateTime fetchedAt = _now();
    try {
      final FetchedSettings fetched = await _api.get(
        organizationId: organizationId,
      );
      // The cache records exactly what the server said, at the version it
      // said it. A mismatch between session and payload organization is
      // impossible by the request's own §9.3 derivation, and the store
      // re-validates it on the next read anyway.
      try {
        await _cache.save(
          payloadJson: fetched.payload,
          fetchedAt: fetchedAt,
          fetchedByUserId: actorUserId,
        );
      } on InvalidSettingsException {
        // The live answer that produced this payload was strictly validated
        // before this point, so a deposit refusal here can only mean the
        // store's own guard broke; the display stays live either way.
      } on Exception {
        // The cache is best-effort garnish on a live read (§22.3: the cache
        // is for display, never for authority). Never fail the live answer.
      }
      return SettingsLive(fetched.settings);
    } on ApiFailure catch (failure) {
      return _loadAfterFailure(organizationId: organizationId, failure: failure);
    }
  }

  Future<SettingsLoadOutcome> _loadAfterFailure({
    required String organizationId,
    required ApiFailure failure,
  }) async {
    // The categories the client must never blur (mission §7):
    // - a transport fault (no HTTP answer) and a 5xx are both "the server did
    //   not hand us data" — the cached display is the §38.18 answer;
    // - anything carrying the server's own decision code (401/403/409/400)
    //   is a decision, and decisions are never converted into offline
    //   successes.
    final bool serverDecided = failure.httpStatus != null &&
        failure.code != ApiErrorCode.serviceUnavailable;
    if (serverDecided) {
      return SettingsDenied(failure);
    }

    final SettingsCacheRead cache = await _cache.load(organizationId: organizationId);
    switch (cache) {
      case SettingsCacheHit(snapshot: final CachedSettingsSnapshot snapshot):
        return SettingsCached(snapshot);
      case SettingsCacheCorrupted(reason: final String reason):
        return SettingsLoadFailed(
          failure: failure,
          cacheCorruptionReason: reason,
        );
      case SettingsCacheMiss():
        return SettingsLoadFailed(failure: failure);
    }
  }

  /// Applies one field-authorized draft update (§34.1 PUT semantics). The
  /// canonical post-write answer updates the cache and becomes the new live
  /// truth; the conflict, refusal, and withheld categories keep the caller's
  /// draft responsibility exactly as the mission defines it (§6).
  Future<SettingsSaveOutcome> update({
    required String organizationId,
    required String actorUserId,
    required Map<String, Object?> body,
  }) async {
    try {
      final FetchedSettings saved = await _api.update(
        organizationId: organizationId,
        body: body,
      );
      if (saved.settings.organizationId != organizationId) {
        // The tenant isolation invariant of §9.2 holds at the request
        // derivation; a mismatch answer would be a server fault, carried
        // honestly rather than displayed as this tenant's row.
        return SettingsSaveRefused(_orgMismatchFailure());
      }
      try {
        await _cache.save(
          payloadJson: saved.payload,
          fetchedAt: _now(),
          fetchedByUserId: actorUserId,
        );
      } on InvalidSettingsException {
        // Unreachable for a validated live write (see load); the canonical
        // display does not depend on the cache (§22.3).
      } on Exception {
        // Same best-effort rule as the load path.
      }
      return SettingsSaved(saved.settings);
    } on ApiFailure catch (failure) {
      switch (failure.code) {
        case ApiErrorCode.settingsVersionConflict:
          // §38.18: the row changed under the caller. The draft stays with
          // the caller — the reconciliation path belongs to the screen.
          return SettingsSaveConflict(failure);
        case ApiErrorCode.serviceUnavailable:
          return SettingsSaveWithheld(failure);
        default:
          return SettingsSaveRefused(failure);
      }
    }
  }

  ApiFailure _orgMismatchFailure() =>
      const ApiFailure.failure(ApiErrorCode.internalError, httpStatus: 200);
}
