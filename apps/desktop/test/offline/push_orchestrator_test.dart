import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';
import 'package:my_shop_desktop/core/offline/outbox/sync_state.dart';
import 'package:my_shop_desktop/core/offline/outbox/uuid_v7.dart';
import 'package:my_shop_desktop/core/offline/sync/backoff_policy.dart';
import 'package:my_shop_desktop/core/offline/sync/push_orchestrator.dart';
import 'package:my_shop_desktop/core/offline/sync/push_transport.dart';

import 'outbox_test_harness.dart';

class ScriptedPushTransport implements SyncPushTransport {
  ScriptedPushTransport(this._script);

  final List<Object> _script;
  int calls = 0;
  final List<PushBatchRequest> requests = <PushBatchRequest>[];

  @override
  Future<PushBatchResponse> push(PushBatchRequest request) async {
    requests.add(request);
    final int index = calls;
    calls++;
    if (index >= _script.length) {
      throw const SyncPushTransportException(kind: PushFailureKind.network);
    }
    final Object step = _script[index];
    if (step is SyncPushTransportException) {
      throw step;
    }
    if (step is PushBatchResponse) {
      return step;
    }
    throw const SyncPushTransportException(kind: PushFailureKind.network);
  }
}

PushBatchResponse okResponse(PushBatchRequest request, PushMutationStatus status,
    {String? resultRef, String? serverSequence, String? rejectionCode}) {
  return PushBatchResponse(
    syncBatchId: request.syncBatchId,
    outcomes: <PushMutationOutcome>[
      for (final PushMutationWire m in request.mutations)
        PushMutationOutcome(
          mutationId: m.mutationId,
          status: status,
          resultRef: resultRef,
          serverSequence: serverSequence,
          rejectionCode: rejectionCode,
          receivedAt: DateTime.utc(2026, 1, 1),
        ),
    ],
  );
}

String generateUuid() => generateUuidV7();

void main() {
  late AppDatabase db;
  late OutboxRepository repo;

  setUp(() {
    db = openMemoryDatabase();
    repo = OutboxRepository(db);
  });

  tearDown(() async {
    await db.close();
  });

  test('an empty outbox is a no-op', () async {
    await seedDeviceBinding(db);
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[]);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
    );
    final PushRunResult result = await orchestrator.runOnce();
    expect(result.idle, isTrue);
    expect(transport.calls, 0);
  });

  test('APPLIED acknowledges the mutation as SYNCED', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      PushBatchResponse(
        syncBatchId: 's001',
        outcomes: <PushMutationOutcome>[
          PushMutationOutcome(
            mutationId: row.mutationId,
            status: PushMutationStatus.applied,
            resultRef: 'r001',
            serverSequence: '1',
            receivedAt: DateTime.utc(2026, 1, 1),
          ),
        ],
      ),
    ]);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 's001',
    );
    final PushRunResult result = await orchestrator.runOnce();
    expect(result.applied, 1);
    expect(transport.calls, 1);
    expect(transport.requests.single.mutations.length, 1);
    expect(transport.requests.single.mutations.single.mutationId, row.mutationId);
    expect(transport.requests.single.localSchemaVersion, 2);
    expect(transport.requests.single.deviceId, testDeviceId);
    final OutboxData after = await repo.requireById(row.mutationId);
    expect(after.syncState, 'SYNCED');
  });

  test('REPLAY acknowledges the mutation as SYNCED', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      PushBatchResponse(
        syncBatchId: 's001',
        outcomes: <PushMutationOutcome>[
          PushMutationOutcome(
            mutationId: row.mutationId,
            status: PushMutationStatus.replay,
            receivedAt: DateTime.utc(2026, 1, 1),
          ),
        ],
      ),
    ]);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 's001',
    );
    final PushRunResult result = await orchestrator.runOnce();
    expect(result.replayed, 1);
    expect((await repo.requireById(row.mutationId)).syncState, 'SYNCED');
    final List<OutboxData> rows = await db.select(db.outbox).get();
    expect(rows.length, 1);
  });

  test('REJECTED becomes PERMANENT_REJECTED and is retained (T-O20)', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      PushBatchResponse(
        syncBatchId: 's001',
        outcomes: <PushMutationOutcome>[
          PushMutationOutcome(
            mutationId: row.mutationId,
            status: PushMutationStatus.rejected,
            rejectionCode: 'BAD',
            receivedAt: DateTime.utc(2026, 1, 1),
          ),
        ],
      ),
    ]);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 's001',
    );
    final PushRunResult result = await orchestrator.runOnce();
    expect(result.rejected, 1);
    final OutboxData after = await repo.requireById(row.mutationId);
    expect(after.syncState, 'PERMANENT_REJECTED');
    expect(after.lastErrorCode, 'BAD');
    // Retained and not selected by pendingForPush.
    expect(await repo.pendingForPush(limit: 50), isEmpty);
    // Still present in database.
    final List<OutboxData> rows = await db.select(db.outbox).get();
    expect(rows.length, 1);
  });

  test('CONTRADICTION moves to CONFLICT', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      PushBatchResponse(
        syncBatchId: 's001',
        outcomes: <PushMutationOutcome>[
          PushMutationOutcome(
            mutationId: row.mutationId,
            status: PushMutationStatus.contradiction,
            rejectionCode: 'MUTATION_CONTRADICTION',
            receivedAt: DateTime.utc(2026, 1, 1),
          ),
        ],
      ),
    ]);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 's001',
    );
    final PushRunResult result = await orchestrator.runOnce();
    expect(result.contradicted, 1);
    final OutboxData after = await repo.requireById(row.mutationId);
    expect(after.syncState, 'CONFLICT');
    expect(after.lastErrorCode, 'MUTATION_CONTRADICTION');
  });

  test('partial batch: each outcome is applied independently (§38.10.3)', () async {
    await seedDeviceBinding(db);
    final OutboxData a = await repo.enqueue(testCommand(aggregateId: generateUuid(), payload: <String, Object?>{'s': 'a'}));
    final OutboxData b = await repo.enqueue(testCommand(aggregateId: generateUuid(), payload: <String, Object?>{'s': 'b'}));
    final OutboxData c = await repo.enqueue(testCommand(aggregateId: generateUuid(), payload: <String, Object?>{'s': 'c'}));
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      PushBatchResponse(
        syncBatchId: 's001',
        outcomes: <PushMutationOutcome>[
          PushMutationOutcome(mutationId: a.mutationId, status: PushMutationStatus.applied, receivedAt: DateTime.utc(2026)),
          PushMutationOutcome(
            mutationId: b.mutationId,
            status: PushMutationStatus.rejected,
            rejectionCode: 'BAD',
            receivedAt: DateTime.utc(2026),
          ),
          PushMutationOutcome(
            mutationId: c.mutationId,
            status: PushMutationStatus.contradiction,
            rejectionCode: 'MUTATION_CONTRADICTION',
            receivedAt: DateTime.utc(2026),
          ),
        ],
      ),
    ]);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 's001',
    );
    final PushRunResult result = await orchestrator.runOnce();
    expect(result.attempted, 3);
    expect(result.applied, 1);
    expect(result.rejected, 1);
    expect(result.contradicted, 1);
    expect((await repo.requireById(a.mutationId)).syncState, 'SYNCED');
    expect((await repo.requireById(b.mutationId)).syncState, 'PERMANENT_REJECTED');
    expect((await repo.requireById(c.mutationId)).syncState, 'CONFLICT');
  });

  test('network failure schedules retry (transient fault)', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(kind: PushFailureKind.network),
    ]);
    final DateTime now = DateTime.utc(2026, 1, 1, 12);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 's001',
      clock: () => now,
    );
    final PushRunResult result = await orchestrator.runOnce();
    expect(result.fault, PushRunFault.transient);
    expect(result.retryable, 1);
    expect(result.retryAfter, isNotNull);
    final OutboxData after = await repo.requireById(row.mutationId);
    expect(after.syncState, 'RETRYABLE_ERROR');
    expect(after.lastErrorCode, 'NETWORK_ERROR');
  });

  test('429 with Retry-After is honoured', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    const Duration retryAfter = Duration(seconds: 15);
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(kind: PushFailureKind.rateLimited, retryAfter: retryAfter),
    ]);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 's001',
    );
    final PushRunResult result = await orchestrator.runOnce();
    expect(result.fault, PushRunFault.transient);
    expect(result.retryAfter, retryAfter);
    final OutboxData after = await repo.requireById(row.mutationId);
    expect(after.syncState, 'RETRYABLE_ERROR');
    expect(after.lastErrorCode, 'RATE_LIMITED');
  });

  test('5xx is transient', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(kind: PushFailureKind.serverError),
    ]);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 's001',
    );
    final PushRunResult result = await orchestrator.runOnce();
    expect(result.fault, PushRunFault.transient);
    expect(result.retryAfter, isNotNull);
    expect((await repo.requireById(row.mutationId)).syncState, 'RETRYABLE_ERROR');
  });

  test('426 CLIENT_TOO_OLD requeues rows to PENDING and is read-only (T-O22)', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(kind: PushFailureKind.clientTooOld),
    ]);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 0,
      batchIdFactory: () => 's001',
    );
    final PushRunResult result = await orchestrator.runOnce();
    expect(result.fault, PushRunFault.clientTooOld);
    expect(result.requeued, 1);
    final OutboxData after = await repo.requireById(row.mutationId);
    expect(after.syncState, 'PENDING');
    expect(after.lastErrorCode, null);
  });

  test('401/403 produces authenticationRequired', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(kind: PushFailureKind.unauthorized),
    ]);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 's001',
    );
    final PushRunResult result = await orchestrator.runOnce();
    expect(result.fault, PushRunFault.authenticationRequired);
    expect(result.retryable, 1);
    expect((await repo.requireById(row.mutationId)).syncState, 'RETRYABLE_ERROR');
    expect((await repo.requireById(row.mutationId)).lastErrorCode, 'AUTHENTICATION_REQUIRED');
  });

  test('404/405 serverUnsupported requeues to PENDING', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(kind: PushFailureKind.serverUnsupported),
    ]);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 's001',
    );
    final PushRunResult result = await orchestrator.runOnce();
    expect(result.fault, PushRunFault.serverUnsupported);
    expect(result.requeued, 1);
    final OutboxData after = await repo.requireById(row.mutationId);
    expect(after.syncState, 'PENDING');
  });

  test('400 bad request permanently rejects the batch', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(kind: PushFailureKind.badRequest),
    ]);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 's001',
    );
    final PushRunResult result = await orchestrator.runOnce();
    expect(result.fault, PushRunFault.permanentBatchRejection);
    expect(result.rejected, 1);
    expect((await repo.requireById(row.mutationId)).syncState, 'PERMANENT_REJECTED');
  });

  test('missing outcome moves to RETRYABLE_ERROR (defensive)', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const PushBatchResponse(syncBatchId: 's001', outcomes: <PushMutationOutcome>[]),
    ]);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 's001',
    );
    final PushRunResult result = await orchestrator.runOnce();
    expect(result.retryable, 1);
    expect((await repo.requireById(row.mutationId)).syncState, 'RETRYABLE_ERROR');
    expect((await repo.requireById(row.mutationId)).lastErrorCode, 'MISSING_OUTCOME');
  });

  test('T-O4: ambiguous failure → retry → REPLAY → SYNCED (client half)', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(kind: PushFailureKind.network),
      PushBatchResponse(
        syncBatchId: 's001',
        outcomes: <PushMutationOutcome>[
          PushMutationOutcome(
            mutationId: row.mutationId,
            status: PushMutationStatus.replay,
            receivedAt: DateTime.utc(2026, 1, 1),
          ),
        ],
      ),
    ]);
    final DateTime base = DateTime.utc(2026, 1, 1, 12);
    DateTime now = base;
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 's001',
      clock: () => now,
      backoff: const BackoffPolicy(jitterFraction: 0),
    );
    final PushRunResult first = await orchestrator.runOnce();
    expect(first.fault, PushRunFault.transient);
    expect((await repo.requireById(row.mutationId)).syncState, 'RETRYABLE_ERROR');
    final DateTime lastAttempt = (await repo.requireById(row.mutationId)).lastAttemptAt!;
    now = lastAttempt.add(first.retryAfter!).add(const Duration(milliseconds: 1));
    final PushRunResult third = await orchestrator.runOnce();
    expect(third.promoted, 1);
    expect(third.replayed, 1);
    expect(transport.calls, 2);
    expect(transport.requests.first.mutations.single.mutationId, row.mutationId);
    expect(transport.requests.last.mutations.single.mutationId, row.mutationId);
    final List<OutboxData> rows = await db.select(db.outbox).get();
    expect(rows.length, 1);
    expect(rows.single.syncState, 'SYNCED');
  });

  test('crash recovery moves SYNCING to PENDING then pushes', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    await repo.transition(mutationId: row.mutationId, to: SyncState.syncing);
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      PushBatchResponse(
        syncBatchId: 's001',
        outcomes: <PushMutationOutcome>[
          PushMutationOutcome(
            mutationId: row.mutationId,
            status: PushMutationStatus.applied,
            receivedAt: DateTime.utc(2026, 1, 1),
          ),
        ],
      ),
    ]);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 's001',
    );
    final PushRunResult result = await orchestrator.runOnce();
    expect(result.recovered, 1);
    expect(result.applied, 1);
    expect((await repo.requireById(row.mutationId)).syncState, 'SYNCED');
  });

  test('promoteDueRetries respects backoff', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    await repo.transition(mutationId: row.mutationId, to: SyncState.syncing);
    await repo.transition(mutationId: row.mutationId, to: SyncState.retryableError, errorCode: 'NETWORK_ERROR');
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[]);
    final DateTime last = (await repo.requireById(row.mutationId)).lastAttemptAt!;
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      backoff: const BackoffPolicy(jitterFraction: 0),
    );
    final int notDue = await orchestrator.promoteDueRetries(now: last.add(const Duration(milliseconds: 500)));
    expect(notDue, 0);
    final int due = await orchestrator.promoteDueRetries(now: last.add(const Duration(seconds: 1)));
    expect(due, 1);
    expect((await repo.requireById(row.mutationId)).syncState, 'PENDING');
  });

  test('batch order: oldest sequence first, one request per batch', () async {
    await seedDeviceBinding(db);
    final OutboxData first = await repo.enqueue(testCommand(aggregateId: generateUuid(), payload: <String, Object?>{'n': 1}));
    final OutboxData second = await repo.enqueue(testCommand(aggregateId: generateUuid(), payload: <String, Object?>{'n': 2}));
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      PushBatchResponse(
        syncBatchId: 's001',
        outcomes: <PushMutationOutcome>[
          PushMutationOutcome(
            mutationId: first.mutationId,
            status: PushMutationStatus.applied,
            receivedAt: DateTime.utc(2026, 1, 1),
          ),
          PushMutationOutcome(
            mutationId: second.mutationId,
            status: PushMutationStatus.applied,
            receivedAt: DateTime.utc(2026, 1, 1),
          ),
        ],
      ),
    ]);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 's001',
    );
    final PushRunResult result = await orchestrator.runOnce();
    expect(result.applied, 2);
    expect(transport.requests.single.mutations.length, 2);
    expect(transport.requests.single.mutations[0].mutationId, first.mutationId);
    expect(transport.requests.single.mutations[1].mutationId, second.mutationId);
    expect(first.deviceLocalSequence, 1);
    expect(second.deviceLocalSequence, 2);
  });

  test('reentrancy guard', () async {
    await seedDeviceBinding(db);
    await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      PushBatchResponse(
        syncBatchId: 's001',
        outcomes: <PushMutationOutcome>[
          PushMutationOutcome(
            mutationId: 'm001',
            status: PushMutationStatus.applied,
            receivedAt: DateTime.utc(2026, 1, 1),
          ),
        ],
      ),
    ]);
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 's001',
    );
    final Future<PushRunResult> first = orchestrator.runOnce();
    expect(() => orchestrator.runOnce(), throwsStateError);
    await first;
  });
}
