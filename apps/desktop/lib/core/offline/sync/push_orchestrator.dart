/// The push orchestrator (Master Plan §40.5, M1b-S5; §38.10.3, §38.10.4).
///
/// One pass is: recover anything a previous process left in flight, promote any
/// retry that is due, take the oldest `PENDING` mutations, and send them as one
/// batch. The server answers **per mutation**, so the pass applies each outcome
/// independently — a permanently rejected row never blocks the sales behind it
/// (§38.10.3) — and a whole-request failure moves every row in the batch
/// according to §38.10.4's retry table.
///
/// Two invariants shape the code:
///
/// * **Nothing is ever deleted here.** The orchestrator only calls
///   [OutboxRepository.transition]; acknowledgement is the only way a row
///   leaves the push path, and compaction of acknowledged rows is the
///   compactor's job (§38.8.2, F-17). A row left in `SYNCING` by a crash is
///   moved back to `PENDING`, never dropped — "never delete on timeout".
/// * **The retry ladder is durable.** `attempt_count` and `last_attempt_at` are
///   columns, so [promoteDueRetries] schedules from persisted state and a
///   restart does not lose the backoff (§38.10.5 "resumes from its local
///   cursor, never from memory").
library;

import 'dart:convert';
import 'dart:math';

import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';
import 'package:my_shop_desktop/core/offline/outbox/sync_state.dart';
import 'package:my_shop_desktop/core/offline/outbox/uuid_v7.dart';
import 'package:my_shop_desktop/core/offline/sync/backoff_policy.dart';
import 'package:my_shop_desktop/core/offline/sync/push_transport.dart';

/// Why a whole batch failed, when it did (§38.10.4). `null` on a pass that sent
/// a batch and mapped every outcome, including a partial one.
enum PushRunFault {
  /// A transient whole-request failure: the batch was scheduled for retry.
  transient,

  /// `CLIENT_TOO_OLD`: the device is read-only until it upgrades (F-15).
  clientTooOld,

  /// `401`/`403`: the device must re-authenticate (§38.10.4).
  authenticationRequired,

  /// The endpoint is absent — an older server or a wrong base URL (F-16). The
  /// mutations stay `PENDING`; the client remains functional offline.
  serverUnsupported,

  /// A permanent whole-batch `4xx`: every mutation in the batch is
  /// `PERMANENT_REJECTED`, retained and owner-visible, never silently dropped
  /// (§38.10.4, F-12, T-O20).
  permanentBatchRejection,
}

/// What one [PushOrchestrator.runOnce] pass did. Every field is a count so a
/// caller can log or alert without re-reading the database.
class PushRunResult {
  const PushRunResult({
    this.recovered = 0,
    this.promoted = 0,
    this.attempted = 0,
    this.applied = 0,
    this.replayed = 0,
    this.rejected = 0,
    this.contradicted = 0,
    this.retryable = 0,
    this.requeued = 0,
    this.fault,
    this.retryAfter,
  });

  /// `SYNCING` rows moved back to `PENDING` after an interrupted attempt.
  final int recovered;

  /// `RETRYABLE_ERROR` rows whose backoff had elapsed, moved to `PENDING`.
  final int promoted;

  /// Mutations sent in this batch (`PENDING → SYNCING`).
  final int attempted;

  /// Outcomes acknowledged as first-time applications.
  final int applied;

  /// Outcomes acknowledged as idempotent replays (F-13).
  final int replayed;

  /// Outcomes the server refused permanently.
  final int rejected;

  /// Outcomes flagged as the idempotency-bypass alarm (F-14).
  final int contradicted;

  /// Mutations moved to `RETRYABLE_ERROR` and scheduled for another attempt.
  final int retryable;

  /// Mutations returned to `PENDING` without being rejected (too-old client,
  /// absent endpoint, or a missing outcome).
  final int requeued;

  /// The whole-batch failure classification, if any.
  final PushRunFault? fault;

  /// How long the caller should wait before the next [PushOrchestrator.runOnce],
  /// when a transient failure scheduled one. `Retry-After` wins when the server
  /// sent it (§38.10.4).
  final Duration? retryAfter;

  /// True when the pass had nothing to recover, promote, or send.
  bool get idle =>
      recovered == 0 && promoted == 0 && attempted == 0 && fault == null;

  @override
  String toString() => 'PushRunResult(recovered: $recovered, promoted: $promoted, '
      'attempted: $attempted, applied: $applied, replayed: $replayed, '
      'rejected: $rejected, contradicted: $contradicted, retryable: $retryable, '
      'requeued: $requeued, fault: ${fault?.name}, retryAfter: ${retryAfter?.inSeconds}s)';
}

/// Drives the durable outbox through one push pass at a time (§38.10).
///
/// The orchestrator owns no socket and no clock of its own: the transport is
/// injected ([SyncPushTransport]) and the clock and entropy are injectable so
/// the ladder can be tested without sleeping. It writes to the database only
/// through [OutboxRepository].
class PushOrchestrator {
  PushOrchestrator({
    required this.outbox,
    required this.transport,
    required this.localSchemaVersion,
    this.backoff = const BackoffPolicy(),
    this.batchSize = OutboxRepository.maxPushBatchSize,
    this.batchIdFactory = generateUuidV7,
    this.clock = DateTime.now,
    this.random,
  });

  final OutboxRepository outbox;
  final SyncPushTransport transport;

  /// §38.7.2: the local schema version this client publishes on every push.
  final int localSchemaVersion;

  final BackoffPolicy backoff;
  final int batchSize;

  /// Source of the §38.28.1 batch correlation id.
  final String Function() batchIdFactory;

  /// The clock used for retry eligibility; injectable for deterministic tests.
  final DateTime Function() clock;

  /// Entropy for the §38.10.4 jitter; `null` uses the default RNG.
  final Random? random;

  bool _running = false;

  /// Runs one push pass and returns what it did.
  ///
  /// Not re-entrant: a second concurrent pass would race the first over the
  /// same `SYNCING` rows, so it throws rather than corrupt them. A pass is a
  /// single-flight unit; a scheduler calls it again after [PushRunResult.retryAfter].
  Future<PushRunResult> runOnce() async {
    if (_running) {
      throw StateError('PushOrchestrator.runOnce is not re-entrant');
    }
    _running = true;
    try {
      final int recovered = await recoverInterrupted();
      final int promoted = await promoteDueRetries(now: clock());

      final List<OutboxData> pending = await outbox.pendingForPush(limit: batchSize);
      if (pending.isEmpty) {
        return PushRunResult(recovered: recovered, promoted: promoted);
      }

      final List<OutboxData> syncing = <OutboxData>[];
      for (final OutboxData row in pending) {
        syncing.add(await outbox.transition(mutationId: row.mutationId, to: SyncState.syncing));
      }

      final PushBatchRequest request = PushBatchRequest(
        deviceId: syncing.first.deviceId,
        syncBatchId: batchIdFactory(),
        localSchemaVersion: localSchemaVersion,
        mutations: <PushMutationWire>[for (final OutboxData row in syncing) _toWire(row)],
      );

      final PushBatchResponse response;
      try {
        response = await transport.push(request);
      } on SyncPushTransportException catch (error) {
        return await _onBatchFailure(syncing, error, recovered, promoted);
      } on Object catch (error) {
        // §38.10.4: an unexpected transport fault is ambiguous, so treat it as
        // a network failure and retry. Leaving the rows in SYNCING would strand
        // them; the retry is safe because every mutation is idempotent.
        return await _onBatchFailure(
          syncing,
          SyncPushTransportException(kind: PushFailureKind.network, diagnostic: '$error'),
          recovered,
          promoted,
        );
      }

      return await _onOutcomes(syncing, response, recovered, promoted);
    } finally {
      _running = false;
    }
  }

  /// Moves rows left in `SYNCING` by an interrupted pass back to `PENDING`.
  ///
  /// A crash or power loss between `PENDING → SYNCING` and the response leaves
  /// a row that [OutboxRepository.pendingForPush] would never pick up again.
  /// Because a send is not an acknowledgement (§38.8.2), the correct recovery
  /// is to make it retryable — sending again is safe (§38.9.3).
  Future<int> recoverInterrupted() async {
    int recovered = 0;
    while (true) {
      final List<OutboxData> interrupted =
          await outbox.rowsInState(SyncState.syncing, limit: batchSize);
      if (interrupted.isEmpty) break;
      for (final OutboxData row in interrupted) {
        await outbox.transition(mutationId: row.mutationId, to: SyncState.pending);
        recovered++;
      }
    }
    return recovered;
  }

  /// Promotes every `RETRYABLE_ERROR` row whose backoff has elapsed to
  /// `PENDING` (§38.10.4).
  ///
  /// Eligibility is computed from the persisted `last_attempt_at` and
  /// `attempt_count`, so a scheduled retry survives a restart.
  Future<int> promoteDueRetries({DateTime? now}) async {
    final DateTime at = now ?? clock();
    final List<OutboxData> candidates =
        await outbox.rowsInState(SyncState.retryableError, limit: batchSize);
    int promoted = 0;
    for (final OutboxData row in candidates) {
      final DateTime lastAttemptAt = row.lastAttemptAt ?? row.localCreatedAt;
      final bool due =
          backoff.isDue(attempt: row.attemptCount, lastAttemptAt: lastAttemptAt, now: at);
      if (due) {
        await outbox.transition(mutationId: row.mutationId, to: SyncState.pending);
        promoted++;
      }
    }
    return promoted;
  }

  /// Applies a per-mutation outcome list, independently (§38.10.3).
  Future<PushRunResult> _onOutcomes(
    List<OutboxData> syncing,
    PushBatchResponse response,
    int recovered,
    int promoted,
  ) async {
    final Map<String, PushMutationOutcome> byId = <String, PushMutationOutcome>{
      for (final PushMutationOutcome outcome in response.outcomes) outcome.mutationId: outcome,
    };

    int applied = 0;
    int replayed = 0;
    int rejected = 0;
    int contradicted = 0;
    int retryable = 0;

    for (final OutboxData row in syncing) {
      final PushMutationOutcome? outcome = byId[row.mutationId];
      if (outcome == null) {
        // A missing outcome is as ambiguous as a lost response, so retry rather
        // than guess (§38.10.4 network row; idempotency makes it safe).
        await outbox.transition(
          mutationId: row.mutationId,
          to: SyncState.retryableError,
          errorCode: 'MISSING_OUTCOME',
        );
        retryable++;
        continue;
      }
      switch (outcome.status) {
        case PushMutationStatus.applied:
          await outbox.transition(mutationId: row.mutationId, to: SyncState.synced);
          applied++;
        case PushMutationStatus.replay:
          await outbox.transition(mutationId: row.mutationId, to: SyncState.synced);
          replayed++;
        case PushMutationStatus.rejected:
          await outbox.transition(
            mutationId: row.mutationId,
            to: SyncState.permanentRejected,
            errorCode: outcome.rejectionCode ?? 'REJECTED',
          );
          rejected++;
        case PushMutationStatus.contradiction:
          await outbox.transition(
            mutationId: row.mutationId,
            to: SyncState.conflict,
            errorCode: outcome.rejectionCode ?? 'MUTATION_CONTRADICTION',
          );
          contradicted++;
      }
    }

    return PushRunResult(
      recovered: recovered,
      promoted: promoted,
      attempted: syncing.length,
      applied: applied,
      replayed: replayed,
      rejected: rejected,
      contradicted: contradicted,
      retryable: retryable,
    );
  }

  /// Applies §38.10.4's whole-request retry table to every row in the batch.
  Future<PushRunResult> _onBatchFailure(
    List<OutboxData> syncing,
    SyncPushTransportException error,
    int recovered,
    int promoted,
  ) async {
    switch (error.kind) {
      case PushFailureKind.network:
      case PushFailureKind.rateLimited:
      case PushFailureKind.serverError:
        await _moveAll(syncing, SyncState.retryableError, _failureCode(error.kind));
        return PushRunResult(
          recovered: recovered,
          promoted: promoted,
          attempted: syncing.length,
          retryable: syncing.length,
          fault: PushRunFault.transient,
          retryAfter: backoff.delayFor(
            _attemptOf(syncing),
            retryAfter: error.retryAfter,
            random: random,
          ),
        );

      case PushFailureKind.unauthorized:
        // §38.10.4: authorization failure. The record is not refused; the
        // device is flagged and the grace window is re-evaluated (S8).
        await _moveAll(syncing, SyncState.retryableError, _failureCode(error.kind));
        return PushRunResult(
          recovered: recovered,
          promoted: promoted,
          attempted: syncing.length,
          retryable: syncing.length,
          fault: PushRunFault.authenticationRequired,
          retryAfter: backoff.delayFor(_attemptOf(syncing), random: random),
        );

      case PushFailureKind.clientTooOld:
        // F-15: read-only until upgrade. The sales are not rejected — they wait.
        await _moveAll(syncing, SyncState.pending, null);
        return PushRunResult(
          recovered: recovered,
          promoted: promoted,
          attempted: syncing.length,
          requeued: syncing.length,
          fault: PushRunFault.clientTooOld,
        );

      case PushFailureKind.serverUnsupported:
        // F-16: cannot sync against this server; the client stays usable
        // offline and the mutations remain queued rather than discarded.
        await _moveAll(syncing, SyncState.pending, null);
        return PushRunResult(
          recovered: recovered,
          promoted: promoted,
          attempted: syncing.length,
          requeued: syncing.length,
          fault: PushRunFault.serverUnsupported,
        );

      case PushFailureKind.badRequest:
      case PushFailureKind.permanent:
        // §38.10.4: a permanent `4xx` is recorded and never retried. It is
        // retained and owner-visible, never silently dropped (F-12, T-O20).
        await _moveAll(syncing, SyncState.permanentRejected, error.code ?? _failureCode(error.kind));
        return PushRunResult(
          recovered: recovered,
          promoted: promoted,
          attempted: syncing.length,
          rejected: syncing.length,
          fault: PushRunFault.permanentBatchRejection,
        );
    }
  }

  Future<void> _moveAll(List<OutboxData> rows, SyncState to, String? errorCode) async {
    for (final OutboxData row in rows) {
      await outbox.transition(mutationId: row.mutationId, to: to, errorCode: errorCode);
    }
  }

  /// The largest attempt count in the batch, so the backoff is the safe one.
  int _attemptOf(List<OutboxData> rows) {
    int attempt = 1;
    for (final OutboxData row in rows) {
      if (row.attemptCount > attempt) attempt = row.attemptCount;
    }
    return attempt;
  }

  /// Maps one §38.8.1 outbox row to its wire representation (§38.10.1).
  PushMutationWire _toWire(OutboxData row) => PushMutationWire(
        mutationId: row.mutationId,
        organizationId: row.organizationId,
        deviceId: row.deviceId,
        actorUserId: row.actorUserId,
        actorRoleSnapshot: _decodeJsonObject(row.actorRoleSnapshot),
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        operationType: row.operationType,
        payload: _decodeJsonObject(row.payload),
        payloadVersion: row.payloadVersion,
        deviceLocalSequence: row.deviceLocalSequence,
        localCreatedAt: row.localCreatedAt.toUtc().toIso8601String(),
        deviceIdempotencyKey: row.deviceIdempotencyKey,
      );
}

String _failureCode(PushFailureKind kind) => switch (kind) {
      PushFailureKind.network => 'NETWORK_ERROR',
      PushFailureKind.rateLimited => 'RATE_LIMITED',
      PushFailureKind.serverError => 'SERVER_ERROR',
      PushFailureKind.clientTooOld => 'CLIENT_TOO_OLD',
      PushFailureKind.unauthorized => 'AUTHENTICATION_REQUIRED',
      PushFailureKind.serverUnsupported => 'SERVER_UNSUPPORTED',
      PushFailureKind.badRequest => 'BAD_REQUEST',
      PushFailureKind.permanent => 'PERMANENT_BATCH_REJECTED',
    };

Map<String, Object?> _decodeJsonObject(String json) {
  final Object? decoded = jsonDecode(json);
  if (decoded is Map<Object?, Object?>) {
    return decoded.cast<String, Object?>();
  }
  throw FormatException('outbox JSON column is not an object: $json');
}
