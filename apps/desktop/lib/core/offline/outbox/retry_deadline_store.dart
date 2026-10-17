/// Persists the server-directed retry deadline — Master Plan §40.5 C4.
///
/// When the push transport reports a `Retry-After` (429 or 503), the deadline
/// must survive application restart so the scheduler does not retry early on
/// the next launch. §38.10.4 is clear: the server's instruction wins. This
/// module keeps a single absolute deadline in the existing `local_meta` table
/// (no schema change, no migration). The outbox module already owns `local_meta`
/// bookkeeping, and the CI stage 23–24 exemption explicitly allows the outbox
/// module to write to `local_meta` — so this file belongs under `outbox/` and
/// reuses the established durability rule.
///
/// Semantics:
/// * A stored deadline is an absolute UTC-like instant in epoch milliseconds,
///   written and read using the same local epoch convention as
///   [OutboxRepository] (`local_created_at`). Comparisons against [DateTime.now]
///   are performed by the caller using `DateTime.isBefore`.
/// * Corrupt or sentinel (<= 0) values are treated as "no deadline" and return
///   `null` — this is the "invalid headers fall back to safe local policy"
///   guarantee in the other direction (persisted bad data is discarded).
/// * `clear()` removes the row; it does not delete outbox rows (stage 23),
///   and it uses the outbox module's access to `local_meta`.
library;

import 'package:drift/drift.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';

/// Stores the absolute [DateTime] the client must not retry before, as directed
/// by a server `Retry-After` header.
class RetryDeadlineStore {
  RetryDeadlineStore(this._db);

  final AppDatabase _db;

  /// The `local_meta.key` that holds the server-directed retry deadline.
  static const String serverRetryDeadlineKey = 'push_server_retry_deadline_ms';

  /// Reads the stored deadline, or `null` when absent, corrupt, or expired/past
  /// (<= 0). The returned value is a local-time [DateTime] derived from epoch
  /// milliseconds — tests should compare using `millisecondsSinceEpoch`.
  Future<DateTime?> read() async {
    final query = _db.select(_db.localMeta)
      ..where((t) => t.key.equals(serverRetryDeadlineKey));
    final row = await query.getSingleOrNull();
    final String? raw = row?.value;
    if (raw == null || raw.isEmpty) return null;
    final int? ms = int.tryParse(raw);
    if (ms == null) return null;
    if (ms <= 0) return null;
    // Mirror OutboxRepository: DateTime from epoch ms in local time.
    return DateTime.fromMillisecondsSinceEpoch(ms);
  }

  /// Writes an absolute deadline. The caller must pass an instant `>= now` for
  /// the schedule to be honoured.
  Future<void> write(DateTime deadline) => _upsert(
    _db,
    serverRetryDeadlineKey,
    deadline.millisecondsSinceEpoch.toString(),
  );

  /// Clears any stored deadline.
  Future<void> clear() {
    return (_db.delete(
      _db.localMeta,
    )..where((t) => t.key.equals(serverRetryDeadlineKey))).go();
  }

  Future<void> _upsert(AppDatabase db, String key, String value) {
    return db
        .into(db.localMeta)
        .insert(
          LocalMetaCompanion.insert(key: key, value: value),
          mode: InsertMode.insertOrReplace,
        );
  }
}
