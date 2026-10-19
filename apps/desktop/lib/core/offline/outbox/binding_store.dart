/// The device-binding store — the one writer of the §38.8.1 binding keys.
///
/// §38.8.1: an outbox mutation's `organization_id` and `device_id` come "from
/// device binding (§38.16), never from user input" — read from `local_meta`
/// at enqueue time, validated as UUIDs, and thrown for when absent (there is
/// no parameter through which a caller could supply or spoof them, T-8/T-9).
///
/// Those two `local_meta` keys existed before this file: the outbox module
/// has **read** them since M1b. What was missing was the writer — the
/// enrollment path (M2-S7) that records the server-issued device id, exactly
/// once per binding, after the server has verified the installation and bound
/// the session. The writer lives **inside the sanctioned outbox module**
/// (stage 24 of the offline gate: the module is the sanctioned write path for
/// this local device state), so no new exemption is created: it writes only
/// device-local identity derived from a server response, never remote-origin
/// data, and never enqueues a mutation.
///
/// The values it writes are exactly two: the server-issued
/// `organization_id` and `device_id`. No credential, no handle, no token
/// byte is stored here — those live in the platform keystore (§13.6).
library;

import 'package:drift/drift.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';
import 'package:my_shop_desktop/core/offline/outbox/uuid_v7.dart';

/// Reads and writes the §38.8.1 binding pair.
class DeviceBindingStore {
  DeviceBindingStore(this._db);

  final AppDatabase _db;

  /// Installs (or replaces) the binding with **server-issued** values.
  ///
  /// The parameters come from the server's own responses, never a client
  /// assertion: the id re-validated here must be a UUID, mirroring the
  /// validation the enqueue path applies on read, so a malformed server
  /// response cannot persist an unusable binding.
  Future<void> install({
    required String organizationId,
    required String deviceId,
  }) {
    if (!isUuid(organizationId)) {
      throw ArgumentError('the server-issued organization id is not a UUID');
    }
    if (!isUuid(deviceId)) {
      throw ArgumentError('the server-issued device id is not a UUID');
    }
    return _db.transaction(() async {
      await _writeMeta(OutboxRepository.organizationIdKey, organizationId);
      await _writeMeta(OutboxRepository.deviceIdKey, deviceId);
    });
  }

  /// Removes the binding (organizational logout). The outbox reads the keys
  /// via [OutboxRepository.archive]s private reader; an absent pair fails an
  /// enqueue with the established exception, never a default.
  Future<void> clear() {
    return _deleteBestEffort(OutboxRepository.organizationIdKey)
        .then((_) => _deleteBestEffort(OutboxRepository.deviceIdKey));
  }

  /// Reads the binding pair the enqueue path trusts, or nulls when absent.
  /// Same keys, one reader, so the writer and the enqueue path cannot drift
  /// into two spellings of the same fact (§38.8.1).
  Future<({String? organizationId, String? deviceId})> readBinding() async {
    final List<LocalMetaData> rows =
        await (_db.select(_db.localMeta)..where(
              (t) => t.key.isIn(<String>[
                OutboxRepository.organizationIdKey,
                OutboxRepository.deviceIdKey,
              ]),
            ))
            .get();
    String? organizationId;
    String? deviceId;
    for (final LocalMetaData row in rows) {
      if (row.key == OutboxRepository.organizationIdKey) {
        organizationId = row.value;
      } else if (row.key == OutboxRepository.deviceIdKey) {
        deviceId = row.value;
      }
    }
    return (organizationId: organizationId, deviceId: deviceId);
  }

  /// The two keys' presence, for tests and honest UI state.
  Future<({bool hasOrganization, bool hasDevice})> presence() async {
    final List<LocalMetaData> rows =
        await (_db.select(_db.localMeta)..where(
              (t) => t.key.isIn(<String>[
                OutboxRepository.organizationIdKey,
                OutboxRepository.deviceIdKey,
              ]),
            ))
            .get();
    final Set<String> keys = rows.map((LocalMetaData row) => row.key).toSet();
    return (
      hasOrganization: keys.contains(OutboxRepository.organizationIdKey),
      hasDevice: keys.contains(OutboxRepository.deviceIdKey),
    );
  }

  Future<void> _writeMeta(String key, String value) async {
    await (_db.into(_db.localMeta)).insert(
      LocalMetaCompanion.insert(key: key, value: value),
      mode: InsertMode.insertOrReplace,
    );
  }

  Future<void> _deleteBestEffort(String key) async {
    await (_db.delete(_db.localMeta)..where((t) => t.key.equals(key))).go();
  }
}
