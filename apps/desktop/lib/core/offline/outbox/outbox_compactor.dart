import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/sync_state.dart';

/// What one compaction pass did (§38.25 F-17 is a storage guard; the owner's
/// console and the tests both need the numbers).
class CompactionReport {
  const CompactionReport({
    required this.scannedSynced,
    required this.retainedForAudit,
    required this.deleted,
  });

  /// `SYNCED` rows examined.
  final int scannedSynced;

  /// Rows kept because they sit inside the audit floor, regardless of age.
  final int retainedForAudit;

  /// Rows deleted — always zero for anything that is not `SYNCED`.
  final int deleted;
}

/// §38.25 F-17: "Background compaction of `SYNCED` records only, with a hard
/// floor retained for audit — never unbounded."
///
/// The rules, exactly:
///
/// * Only `SYNCED` rows are candidates. A row in any other state — above all
///   `PENDING`, `SYNCING`, `RETRYABLE_ERROR`, `CONFLICT`,
///   `PERMANENT_REJECTED` — is untouched: deleting it would discard a
///   committed, unacknowledged sale (§38.8.2 "never delete on send", §38.30.1
///   "the outbox has no delete API").
/// * A candidate is deleted only when its age exceeds the retention window.
///   Age is measured from the `SYNCED` transition's audit-event timestamp
///   (§38.13 timestamps every transition), falling back to `local_created_at`
///   when the audit row is absent.
/// * The newest [auditFloor] `SYNCED` rows are never deleted, however old —
///   the "hard floor retained for audit" of F-17.
/// * Audit rows are never deleted. The floor is about storage; the history is
///   permanent (§32.5, §32.2A).
///
/// Pass [cutoff] explicitly (or use [compactSynced], which derives it from
/// the wall clock) — tests pin time rather than sleep.
class OutboxCompactor {
  OutboxCompactor(this._db);

  final AppDatabase _db;

  /// Retention default, mirroring the server's `change_log` window (§38.11.1,
  /// "default 90 days"). Slice decision, recorded in the M1b-S3 record.
  static const Duration defaultRetention = Duration(days: 90);

  /// Hard audit floor default: the newest 1 000 `SYNCED` rows survive any
  /// compaction regardless of age (§38.25 F-17). Slice decision, recorded in
  /// the M1b-S3 record.
  static const int defaultAuditFloor = 1000;

  /// Compacts `SYNCED` rows older than [retention], keeping [auditFloor] of
  /// them forever.
  Future<CompactionReport> compactSynced({
    Duration retention = defaultRetention,
    int auditFloor = defaultAuditFloor,
  }) {
    if (retention <= Duration.zero) {
      throw ArgumentError.value(retention, 'retention', 'must be positive');
    }
    return compactSyncedBefore(
      cutoff: DateTime.now().subtract(retention),
      auditFloor: auditFloor,
    );
  }

  /// Compacts `SYNCED` rows whose age timestamp lies strictly before [cutoff].
  Future<CompactionReport> compactSyncedBefore({
    required DateTime cutoff,
    required int auditFloor,
  }) {
    if (auditFloor < 0) {
      throw ArgumentError.value(auditFloor, 'auditFloor', 'must be >= 0');
    }
    return _db.transaction(() async {
      final List<OutboxData> synced = await (_db.select(_db.outbox)
            ..where((t) => t.syncState.equals(SyncState.synced.wireName)))
          .get();

      final Map<String, DateTime> acknowledgedAt =
          <String, DateTime>{};
      final List<LocalAuditEvent> ackEvents = await (_db
              .select(_db.localAuditEvents)
            ..where((t) => t.toState.equals(SyncState.synced.wireName)))
          .get();
      for (final event in ackEvents) {
        final DateTime? previous = acknowledgedAt[event.mutationId];
        if (previous == null || event.eventTime.isAfter(previous)) {
          acknowledgedAt[event.mutationId] = event.eventTime;
        }
      }

      DateTime ageOf(OutboxData row) =>
          acknowledgedAt[row.mutationId] ?? row.localCreatedAt;

      // Newest first; device_local_sequence breaks ties so the floor cut is
      // deterministic even inside one millisecond.
      final List<OutboxData> ordered = <OutboxData>[...synced]
        ..sort((a, b) {
          final int byAge = ageOf(b).compareTo(ageOf(a));
          if (byAge != 0) return byAge;
          return b.deviceLocalSequence.compareTo(a.deviceLocalSequence);
        });

      final Set<String> floorIds =
          ordered.take(auditFloor).map((row) => row.mutationId).toSet();
      final List<String> deletable = <String>[
        for (final row in ordered)
          if (!floorIds.contains(row.mutationId) && ageOf(row).isBefore(cutoff))
            row.mutationId,
      ];

      if (deletable.isNotEmpty) {
        await (_db.delete(_db.outbox)..where((t) => t.mutationId.isIn(deletable)))
            .go();
      }

      return CompactionReport(
        scannedSynced: synced.length,
        retainedForAudit: floorIds.length,
        deleted: deletable.length,
      );
    });
  }
}
