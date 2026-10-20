/// The versioned settings snapshot cache — Master Plan §38.18, §22.3
/// ("settings are never cached as authority"), §13.7's read-replica posture.
///
/// The rules this store implements, exactly as the plan fixes them:
///
/// - **Server-owned, read-only on the client.** Rows enter only from
///   successfully fetched authoritative GET responses; nothing in this file
///   offers the client a way to *edit* settings upward, and no calling site
///   can read one either — the store's write surface takes a server payload,
///   nothing else.
/// - **Versioned.** Every row carries the §38.18 `settings_version` it was
///   fetched at. An incoming fetch whose version is older than the stored
///   one is **refused** (the server's newer truth already on the device
///   wins); an equal version refreshes the fetch metadata (repeated-refresh
///   freshness stays honest); a newer version replaces the stored payload
///   (stale detection by supersession).
/// - **Organization-bound.** Keys are organization ids; a read for one tenant
///   cannot see another's row even before the session gating on top of it
///   (§9.3, §13.7).
/// - **Structurally validated on read.** A corrupted or structurally invalid
///   payload is reported as corruption — never silently served, never
///   silently deleted. A corrupt cache is a *missing* cache, honestly named,
///   and the next authoritative fetch may overwrite it.
/// - **No outbox relationship.** This store performs no enqueue and no
///   outbox-row surgery; a cache write never becomes an outgoing mutation
///   (§38.12.1). Its local-write placement is a declared, narrowly-scoped
///   exemption in the `gate:offline` stage-24 guard, recorded there with the
///   reason this file's headline repeats: fetched GET replicas keyed by a
///   monotonic settings_version, never change-log applies.
/// - **No positional ambiguity.** Every read re-validates the row payload
///   structurally, so a corrupted, spliced, or foreign file cannot present
///   itself as readable settings (§13.7, §38.18). 
library;

import 'dart:convert';

import 'package:drift/drift.dart'
    show
        Value,
        DoUpdate;
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/features/settings/models/organization_settings.dart';

/// One cache hit: the parsed settings, the version it was fetched at, and
/// the fetch metadata the UI reports (§38.18's last-sync honesty).
final class CachedSettingsSnapshot {
  const CachedSettingsSnapshot({
    required this.settings,
    required this.fetchedAt,
    required this.fetchedByUserId,
  });

  final OrganizationSettings settings;
  final DateTime fetchedAt;
  final String fetchedByUserId;
}

/// The outcome of reading the cache for one organization.
sealed class SettingsCacheRead {
  const SettingsCacheRead();
}

/// A valid, current, structurally consistent snapshot was held.
final class SettingsCacheHit extends SettingsCacheRead {
  const SettingsCacheHit(this.snapshot);

  final CachedSettingsSnapshot snapshot;
}

/// No row was held for the organization (the §38.18 fresh-offline-device
/// case: the honest absence, never a default).
final class SettingsCacheMiss extends SettingsCacheRead {
  const SettingsCacheMiss();
}

/// A row existed but is corrupted or structurally invalid (mission §7:
/// "reject corrupted, structurally invalid … cache data"). The store keeps
/// the row untouched; the reading surface must present a failure, and the
/// next authoritative fetch is what may replace the bytes.
final class SettingsCacheCorrupted extends SettingsCacheRead {
  const SettingsCacheCorrupted({required this.reason});

  final String reason;
}

/// The outcome of writing one fetched snapshot.
sealed class SettingsCacheWrite {
  const SettingsCacheWrite();
}

/// The payload was stored; the organization's cached fingerprint advanced
/// (or its fetch metadata refreshed at an equal version).
final class SettingsCacheStored extends SettingsCacheWrite {
  const SettingsCacheStored({required this.settingsVersion});

  /// The version now held.
  final int settingsVersion;
}

/// The payload was refused because the stored snapshot is **newer** (mission
/// §7: "reconnect with a newer server version" is the only supersession; a
/// stale response cannot undo it).
final class SettingsCacheKeptNewer extends SettingsCacheWrite {
  const SettingsCacheKeptNewer({required this.settingsVersion});

  /// The version that remains held (the newer one).
  final int settingsVersion;
}

/// The settings snapshot store.
class SettingsSnapshotCache {
  SettingsSnapshotCache(this._db);

  final AppDatabase _db;

  /// Stores one fetched authoritative response, verbatim. The payload is
  /// parsed strictly *here* so a caller cannot deposit bytes the reader would
  /// later refuse: organization and version are re-derived from the payload
  /// itself, keeping the row's metadata and its content consistent by
  /// construction.
  ///
  /// Throws [InvalidSettingsException] when the payload is not a readable
  /// settings response — a malformed deposit is a caller defect, reported
  /// immediately, never stored for later.
  Future<SettingsCacheWrite> save({
    required Map<String, Object?> payloadJson,
    required DateTime fetchedAt,
    required String fetchedByUserId,
  }) async {
    final OrganizationSettings parsed = OrganizationSettings.fromWire(payloadJson);
    final SettingsSnapshotsCompanion companion = SettingsSnapshotsCompanion(
      organizationId: Value(parsed.organizationId),
      settingsVersion: Value(parsed.settingsVersion),
      payloadJson: Value(jsonEncode(payloadJson)),
      fetchedAt: Value(fetchedAt.toUtc()),
      fetchedByUserId: Value(fetchedByUserId),
    );

    final SettingsSnapshot? existing =
        await (_db.select(_db.settingsSnapshots)
              ..where(
                ($SettingsSnapshotsTable table) =>
                    table.organizationId.equals(parsed.organizationId),
              ))
            .getSingleOrNull();

    if (existing != null && existing.settingsVersion > parsed.settingsVersion) {
      // §38.18's monotonic rule: the newer snapshot already on the device
      // stands. The stale fetch is recorded as refused, not applied.
      return SettingsCacheKeptNewer(settingsVersion: existing.settingsVersion);
    }

    await _db.into(_db.settingsSnapshots).insert(
          companion,
          onConflict: DoUpdate<$SettingsSnapshotsTable, SettingsSnapshot>(
            ($SettingsSnapshotsTable table) => SettingsSnapshotsCompanion(
              settingsVersion: Value(parsed.settingsVersion),
              payloadJson: companion.payloadJson,
              fetchedAt: companion.fetchedAt,
              fetchedByUserId: companion.fetchedByUserId,
            ),
            // The table's primary key alone decides the conflict; never widen
            // it (the drift default target is exactly the primary key here).
          ),
        );
    return SettingsCacheStored(settingsVersion: parsed.settingsVersion);
  }

  /// Reads the cache for one organization (§38.18: the display source after a
  /// network loss, and the fingerprint the UI reports).
  Future<SettingsCacheRead> load({required String organizationId}) async {
    final SettingsSnapshot? row = await (_db.select(_db.settingsSnapshots)
          ..where(
            ($SettingsSnapshotsTable table) =>
                table.organizationId.equals(organizationId),
          ))
        .getSingleOrNull();

    if (row == null) {
      return const SettingsCacheMiss();
    }

    final SettingsCacheRead validated = await _validateRow(
      organizationId: organizationId,
      row: row,
    );
    return validated;
  }

  Future<SettingsCacheRead> _validateRow({
    required String organizationId,
    required SettingsSnapshot row,
  }) async {
    final Object? decoded;
    try {
      decoded = jsonDecode(row.payloadJson);
    } on FormatException catch (error) {
      return SettingsCacheCorrupted(reason: error.message);
    }
    if (decoded is! Map) {
      return const SettingsCacheCorrupted(
        reason: 'the cached settings payload is not a JSON object',
      );
    }
    final Map<String, Object?> map = (decoded).cast<String, Object?>();

    final OrganizationSettings parsed;
    try {
      parsed = OrganizationSettings.fromWire(map);
    } on InvalidSettingsException catch (error) {
      return SettingsCacheCorrupted(reason: error.toString());
    }

    // Structural consistency: the payload must describe the organization and
    // the version its row's own columns claim, or the row is corrupt
    // (cross-tenant or cross-version splicing is refused, mission §7).
    if (parsed.organizationId != organizationId ||
        parsed.organizationId != row.organizationId) {
      return const SettingsCacheCorrupted(
        reason: 'the cached payload describes a different organization than its row',
      );
    }
    if (parsed.settingsVersion != row.settingsVersion) {
      return const SettingsCacheCorrupted(
        reason: 'the cached payload’s version disagrees with its row',
      );
    }

    return SettingsCacheHit(
      CachedSettingsSnapshot(
        settings: parsed,
        fetchedAt: row.fetchedAt,
        fetchedByUserId: row.fetchedByUserId,
      ),
    );
  }

  /// Removes one organization's snapshot. Deliberately narrow: a cache
  /// row is server-owned replica bytes, never business data — this API
  /// exists for governed repair paths only, and it cannot touch the outbox,

  /// the audit log, or any business table (the guard's stage 23 would make
  /// any outbox shape here a build failure anyway).
  Future<void> purge({required String organizationId}) async {
    await (_db.delete(_db.settingsSnapshots)
          ..where(
            ($SettingsSnapshotsTable table) =>
                table.organizationId.equals(organizationId),
          ))
        .go();
  }

  /// Removes every snapshot. Same governed-repair-only scope as [purge].
  Future<void> purgeAll() async {
    await _db.delete(_db.settingsSnapshots).go();
  }
}
