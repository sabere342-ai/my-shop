/// The durable offline-grace store — Master Plan §38.16.2, §38.16.5, §39.6's
/// `local_meta` row ("`local_schema_version`, time anchor, device identity"),
/// §40.5 (M1b-S8).
///
/// Everything the offline session must remember across a restart lives here,
/// and nowhere else:
///
/// * the signed grace record (§38.16.3),
/// * the device wall-clock instant it was established at (the window's start
///   on the device timeline, §10.3.1's "grace start … not on app start"),
/// * the monotonic clock high-water (§38.16.5 backward rule),
/// * the forward-tamper flag and its durable count (§38.16.5 forward rule).
///
/// It uses the existing `local_meta` key/value table rather than a new table:
/// §38.6.2 wants a local schema change only when one is genuinely required, and
/// §39.6 already names `local_meta` as the home of the device identity and time
/// anchor. Storing session state here means **no schema change and no
/// migration** for M1b-S8. The record and its establishment instant share one
/// JSON value so they are written and read atomically.
///
/// **Why this file is the one declared stage-24 exemption for the grace
/// module.** CI stage 23/24 (`tool/ci/offline-guards.mjs`) keeps local database
/// writes out of `lib/core/offline/` except through the single remote-apply
/// door, because §38.12.1's loop threat is a write made *in response to a
/// remote change*. The grace store never writes remote-origin data and never
/// enqueues a mutation; it writes device-local security state, and it is the
/// only writer of it. The exemption is a named file, not a directory, and every
/// local-write pattern is still enforced everywhere else.
library;

import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_record.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';

/// A stored grace session: the signed record and the device instant it started
/// at.
class StoredOfflineGrace {
  const StoredOfflineGrace({
    required this.record,
    required this.deviceWallEstablishedAt,
  });

  final OfflineGraceRecord record;

  /// Device wall-clock time when the session was established — the start of
  /// the grace window on the device's own timeline (§10.3.1).
  final DateTime deviceWallEstablishedAt;
}

/// Persists and reads the offline-grace session state (§38.16).
class OfflineGraceStore {
  OfflineGraceStore(this._db);

  final AppDatabase _db;

  /// `local_meta` keys this module owns. Prefixed so they cannot collide with
  /// the outbox's binding/sequence keys.
  static const String sessionKey = 'offline_grace_session';
  static const String clockHighWaterKey = 'offline_grace_clock_high_water_ms';
  static const String requiresRevalidationKey = 'offline_grace_requires_revalidation';
  static const String clockTamperCountKey = 'offline_grace_clock_tamper_count';

  /// Writes the session (record + establishment instant) as one atomic value.
  Future<void> saveSession({
    required OfflineGraceRecord record,
    required DateTime deviceWallEstablishedAt,
  }) async {
    await _writeMeta(
      sessionKey,
      jsonEncode(<String, Object?>{
        'record': record.toJson(),
        'deviceWallEstablishedAtMs': deviceWallEstablishedAt.millisecondsSinceEpoch,
      }),
    );
  }

  /// Reads the persisted session, or `null` when the device has none.
  Future<StoredOfflineGrace?> readSession() async {
    final String? raw = await _readMeta(sessionKey);
    if (raw == null) return null;
    final Object? decoded = jsonDecode(raw);
    if (decoded is! Map<String, Object?>) {
      throw FormatException('stored grace session is not an object: $raw');
    }
    final Object? recordJson = decoded['record'];
    final Object? establishedMs = decoded['deviceWallEstablishedAtMs'];
    if (recordJson is! Map<String, Object?> || establishedMs is! int) {
      throw FormatException('stored grace session is malformed: $raw');
    }
    return StoredOfflineGrace(
      record: OfflineGraceRecord.fromJson(recordJson),
      deviceWallEstablishedAt:
          DateTime.fromMillisecondsSinceEpoch(establishedMs, isUtc: false),
    );
  }

  /// Removes the session and its forward-tamper flag. Used when the window
  /// closes, on logout, and on a local password change (§38.16.4).
  Future<void> clearSession() async {
    await _deleteMeta(sessionKey);
    await _writeMeta(requiresRevalidationKey, '0');
  }

  /// The persisted monotonic clock high-water, if any (§38.16.5).
  Future<DateTime?> readClockHighWater() async {
    final int? millis = await _readInt(clockHighWaterKey);
    return millis == null ? null : DateTime.fromMillisecondsSinceEpoch(millis);
  }

  /// Advances the persisted high-water to [value] when it is later than the
  /// stored one; never moves it backwards.
  Future<void> raiseClockHighWater(DateTime value) async {
    final DateTime? current = await readClockHighWater();
    if (current != null && !value.isAfter(current)) return;
    await _writeMeta(clockHighWaterKey, '${value.millisecondsSinceEpoch}');
  }

  /// True when a forward-tamper detection requires online re-validation
  /// (§38.16.5, F-21).
  Future<bool> readRequiresRevalidation() async {
    return (await _readMeta(requiresRevalidationKey)) == '1';
  }

  /// Sets the forward-tamper re-validation flag.
  Future<void> setRequiresRevalidation({required bool required}) async {
    await _writeMeta(requiresRevalidationKey, required ? '1' : '0');
  }

  /// A durable count of forward-tamper detections — the local record of the
  /// §38.16.5 "security event". Mirroring it to the server as a formal
  /// `security_event` is the observability slice's job (§38.28, M1b-S10); this
  /// keeps the detection from being forgotten in the meantime.
  Future<int> readClockTamperCount() async => (await _readInt(clockTamperCountKey)) ?? 0;

  /// Increments and returns the durable tamper count.
  Future<int> recordClockTamper() async {
    final int next = (await readClockTamperCount()) + 1;
    await _writeMeta(clockTamperCountKey, '$next');
    return next;
  }

  // ---------------------------------------------------------------------------
  // local_meta access. The device binding keys are the outbox's, so the binding
  // has one definition (§38.8.1).
  // ---------------------------------------------------------------------------

  /// Reads the device binding the session must match (§38.16.2). Returns the
  /// raw values; the service validates their shape.
  Future<({String? organizationId, String? deviceId})> readDeviceBinding() async {
    return (
      organizationId: await _readMeta(OutboxRepository.organizationIdKey),
      deviceId: await _readMeta(OutboxRepository.deviceIdKey),
    );
  }

  Future<String?> _readMeta(String key) async {
    final LocalMetaData? row = await (_db.select(_db.localMeta)
          ..where((t) => t.key.equals(key)))
        .getSingleOrNull();
    return row?.value;
  }

  Future<void> _writeMeta(String key, String value) {
    return _db.into(_db.localMeta).insert(
          LocalMetaCompanion.insert(key: key, value: value),
          mode: InsertMode.insertOrReplace,
        );
  }

  Future<void> _deleteMeta(String key) {
    return (_db.delete(_db.localMeta)..where((t) => t.key.equals(key))).go();
  }

  Future<int?> _readInt(String key) async {
    final String? raw = await _readMeta(key);
    return raw == null ? null : int.tryParse(raw);
  }
}
