import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_monitor.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_probe.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';
import 'package:my_shop_desktop/core/offline/outbox/retry_deadline_store.dart';
import 'package:my_shop_desktop/core/offline/outbox/sync_state.dart';
import 'package:my_shop_desktop/core/offline/sync/push_orchestrator.dart';
import 'package:my_shop_desktop/core/offline/sync/push_transport.dart';
import 'package:my_shop_desktop/core/offline/sync/sync_scheduler.dart';
import 'package:my_shop_desktop/core/telemetry/metrics.dart';
import 'package:my_shop_desktop/core/telemetry/structured_log.dart';

import '../telemetry/telemetry_test_harness.dart';
import 'connectivity_test_harness.dart';
import 'outbox_test_harness.dart';
import 'push_test_harness.dart';

// Master Plan §38.28. The offline side of observability: the push/correlation
// seam of §38.28.1, the structured redacted records of §38.28.3, and the
// metrics of §38.28.2, driven end to end through the real orchestrator and
// scheduler. Two properties are asserted throughout: correlation is shared, and
// observability is *passive* — a broken sink changes nothing about the sync.

/// A transport that throws an unclassified error, whose message is adversarial.
class _ThrowingTransport implements SyncPushTransport {
  _ThrowingTransport(this.error);

  final Object error;

  @override
  Future<PushBatchResponse> push(PushBatchRequest request) async => throw error;
}

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

  ({
    PushOrchestrator orchestrator,
    RecordingTelemetrySink logs,
    RecordingMetricsSink metrics,
  }) orchestratorFor(
    SyncPushTransport transport, {
    bool failSinks = false,
  }) {
    final RecordingTelemetrySink logs = RecordingTelemetrySink(failOnWrite: failSinks);
    final RecordingMetricsSink metrics = RecordingMetricsSink(failOnWrite: failSinks);
    return (
      orchestrator: PushOrchestrator(
        outbox: repo,
        transport: transport,
        localSchemaVersion: 2,
        batchIdFactory: () => 'batch-1',
        traceIdFactory: () => 'trace-1',
        logger: TelemetryLogger(sink: logs),
        metrics: TelemetryMetrics(sink: metrics),
      ),
      logs: logs,
      metrics: metrics,
    );
  }

  test('one pass shares device, batch and trace ids across the wire and the log', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      appliedFor(row.mutationId),
    ]);
    final harness = orchestratorFor(transport);

    final PushRunResult result = await harness.orchestrator.runOnce();

    expect(result.applied, 1);
    // The same ids the request carried are the ids the record carries.
    expect(transport.requests.single.syncBatchId, 'batch-1');
    expect(transport.requests.single.traceId, 'trace-1');

    final TelemetryRecord pass = harness.logs.single(SyncLogEvents.pushPass);
    expect(pass.fields[LoggableKeys.deviceId], testDeviceId);
    expect(pass.fields[LoggableKeys.syncBatchId], 'batch-1');
    expect(pass.fields[LoggableKeys.traceId], 'trace-1');
    expect(pass.fields[LoggableKeys.applied], 1);
    // A pass-level record is not narrowed to one mutation.
    expect(pass.fields.containsKey(LoggableKeys.mutationId), isFalse);
  });

  test('an applied pass observes duration, acknowledgement latency, and success ratio', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      appliedFor(row.mutationId),
    ]);
    final harness = orchestratorFor(transport);

    await harness.orchestrator.runOnce();

    final MetricPoint duration = harness.metrics.single(SyncMetricNames.pushDurationMs);
    expect(duration.kind, MetricKind.histogram);
    expect(duration.labels, <String, Object?>{MetricLabels.operation: 'PUSH'});

    final MetricPoint ack = harness.metrics.single(SyncMetricNames.ackLatencyMs);
    expect(ack.kind, MetricKind.histogram);
    expect(ack.labels, <String, Object?>{MetricLabels.outcome: 'APPLIED'});
    expect(ack.value, greaterThanOrEqualTo(0));

    final MetricPoint ratio = harness.metrics.single(SyncMetricNames.pushSuccessRatio);
    expect(ratio.kind, MetricKind.gauge);
    expect(ratio.value, 1);
  });

  test('a rejection is logged by mutation reference, never by payload', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(
      testCommand(
        payload: <String, Object?>{'saleNo': payloadCanary},
        actorRoleSnapshot: <String, Object?>{'token': tokenCanary},
      ),
    );
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      PushBatchResponse(
        syncBatchId: 'batch-1',
        outcomes: <PushMutationOutcome>[
          PushMutationOutcome(
            mutationId: row.mutationId,
            status: PushMutationStatus.rejected,
            rejectionCode: 'BAD',
            receivedAt: DateTime.utc(2026),
          ),
        ],
      ),
    ]);
    final harness = orchestratorFor(transport);

    await harness.orchestrator.runOnce();

    final TelemetryRecord rejected = harness.logs.single(SyncLogEvents.pushMutationRejected);
    expect(rejected.fields[LoggableKeys.mutationId], row.mutationId);
    expect(rejected.fields[LoggableKeys.deviceId], testDeviceId);
    expect(rejected.fields[LoggableKeys.syncBatchId], 'batch-1');
    expect(rejected.fields[LoggableKeys.traceId], 'trace-1');
    expect(rejected.fields[LoggableKeys.errorCode], 'BAD');

    // The payload and the role snapshot never reach a record or a metric.
    expect(harness.logs.serialized(), isNot(contains(payloadCanary)));
    expect(harness.logs.serialized(), isNot(contains(tokenCanary)));
    expect(harness.metrics.serialized(), isNot(contains(payloadCanary)));
  });

  test('a contradiction is the idempotency alarm, logged by reference', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      PushBatchResponse(
        syncBatchId: 'batch-1',
        outcomes: <PushMutationOutcome>[
          PushMutationOutcome(
            mutationId: row.mutationId,
            status: PushMutationStatus.contradiction,
            rejectionCode: 'MUTATION_CONTRADICTION',
            receivedAt: DateTime.utc(2026),
          ),
        ],
      ),
    ]);
    final harness = orchestratorFor(transport);

    await harness.orchestrator.runOnce();

    final TelemetryRecord alarm =
        harness.logs.single(SyncLogEvents.pushMutationContradiction);
    expect(alarm.fields[LoggableKeys.mutationId], row.mutationId);
    expect(alarm.fields[LoggableKeys.errorCode], 'MUTATION_CONTRADICTION');
    expect(
      harness.metrics.single(SyncMetricNames.conflicts).labels,
      <String, Object?>{MetricLabels.conflictClass: 'IDEMPOTENCY_CONTRADICTION'},
    );
  });

  test('a transient batch failure is classified, and its diagnostic is never logged', () async {
    await seedDeviceBinding(db);
    await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(
        kind: PushFailureKind.rateLimited,
        statusCode: 429,
        retryAfter: Duration(seconds: 15),
        // An adversarial diagnostic: `toString()` would emit it, the record must not.
        diagnostic: connectionCanary,
      ),
    ]);
    final harness = orchestratorFor(transport);

    final PushRunResult result = await harness.orchestrator.runOnce();
    expect(result.fault, PushRunFault.transient);

    final TelemetryRecord failure = harness.logs.single(SyncLogEvents.pushBatchFailure);
    expect(failure.fields[LoggableKeys.fault], 'transient');
    expect(failure.fields[LoggableKeys.errorClass], 'SyncPushTransportException');
    expect(failure.fields[LoggableKeys.statusCode], 429);

    expect(
      harness.metrics.single(SyncMetricNames.pushAttempts).labels,
      <String, Object?>{MetricLabels.errorClass: 'TRANSIENT'},
    );
    expect(harness.logs.serialized(), isNot(contains(connectionCanary)));
  });

  test('an unexpected transport throw is logged by class, never by message', () async {
    await seedDeviceBinding(db);
    await repo.enqueue(testCommand());
    final _ThrowingTransport transport = _ThrowingTransport(StateError('boom $tokenCanary'));
    final harness = orchestratorFor(transport);

    final PushRunResult result = await harness.orchestrator.runOnce();

    expect(result.fault, PushRunFault.transient);
    final TelemetryRecord unexpected =
        harness.logs.single(SyncLogEvents.pushTransportUnexpected);
    expect(unexpected.fields[LoggableKeys.errorClass], 'StateError');
    expect(harness.logs.serialized(), isNot(contains(tokenCanary)));
  });

  test('a broken telemetry sink never changes a pass (passive evidence)', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      appliedFor(row.mutationId),
    ]);
    final harness = orchestratorFor(transport, failSinks: true);

    final PushRunResult result = await harness.orchestrator.runOnce();

    expect(result.applied, 1);
    expect((await repo.requireById(row.mutationId)).syncState, SyncState.synced.wireName);
  });

  test('a throwing telemetry clock never changes a pass (passive evidence)', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      appliedFor(row.mutationId),
    ]);
    final RecordingTelemetrySink logs = RecordingTelemetrySink();
    final RecordingMetricsSink metrics = RecordingMetricsSink();
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 'batch-1',
      traceIdFactory: () => 'trace-1',
      // The logger's clock is a failing stage; the pass must not observe it.
      logger: TelemetryLogger(sink: logs, clock: () => throw StateError('clock failed')),
      metrics: TelemetryMetrics(sink: metrics),
    );

    final PushRunResult result = await orchestrator.runOnce();

    expect(result.applied, 1);
    expect((await repo.requireById(row.mutationId)).syncState, SyncState.synced.wireName);
    // The record is lost rather than the pass: no log escaped the broken clock.
    expect(logs.records, isEmpty);
  });

  test('the scheduler emits outbox depth by state, never by identity', () async {
    await seedDeviceBinding(db);
    await repo.enqueue(testCommand(aggregateId: '44444444-4444-4444-8444-444444444441'));
    await repo.enqueue(testCommand(aggregateId: '44444444-4444-4444-8444-444444444442'));

    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(httpStatus: 200),
    );
    final ConnectivityMonitor monitor = ConnectivityMonitor(probe: probe);
    final RecordingMetricsSink sink = RecordingMetricsSink();
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: ScriptedPushTransport(<Object>[]),
      localSchemaVersion: 2,
      batchIdFactory: () => 'batch-1',
      traceIdFactory: () => 'trace-1',
    );
    final SyncScheduler scheduler = SyncScheduler(
      orchestrator: orchestrator,
      connectivity: monitor,
      deadlineStore: RetryDeadlineStore(db),
      metrics: TelemetryMetrics(sink: sink),
    );

    await scheduler.start();

    final List<MetricPoint> depth = sink.named(SyncMetricNames.outboxDepth);
    expect(depth.length, SyncState.values.length);
    final MetricPoint pending = depth.singleWhere(
      (MetricPoint p) => p.labels[MetricLabels.state] == SyncState.pending.wireName,
    );
    expect(pending.kind, MetricKind.gauge);
    expect(pending.value, 2);
    // A label is the state name; no identity-shaped label is ever present.
    for (final MetricPoint point in depth) {
      expect(point.labels.keys, <String>[MetricLabels.state]);
    }

    await scheduler.dispose();
    monitor.dispose();
  });
}
