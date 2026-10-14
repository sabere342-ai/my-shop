import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_monitor.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_probe.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_state.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';
import 'package:my_shop_desktop/core/offline/outbox/retry_deadline_store.dart';
import 'package:my_shop_desktop/core/offline/sync/backoff_policy.dart';
import 'package:my_shop_desktop/core/offline/sync/push_orchestrator.dart';
import 'package:my_shop_desktop/core/offline/sync/push_transport.dart';
import 'package:my_shop_desktop/core/offline/sync/sync_scheduler.dart';

import 'connectivity_test_harness.dart';
import 'outbox_test_harness.dart';
import 'push_test_harness.dart';

/// The scheduler's §40.5 C3/C6/C8 guarantees, driven deterministically with a
/// fake clock, fake probe, and fake timers.
void main() {
  const BackoffPolicy deterministic = BackoffPolicy(
    baseDelay: Duration(seconds: 5),
    maxDelay: Duration(minutes: 5),
    jitterFraction: 0,
  );

  late AppDatabase db;
  late OutboxRepository repo;
  late RetryDeadlineStore deadlineStore;
  late TestClock clock;

  setUp(() async {
    db = openMemoryDatabase();
    repo = OutboxRepository(db);
    deadlineStore = RetryDeadlineStore(db);
    // The outbox stamps `last_attempt_at`/`local_created_at` from the real wall
    // clock (`_allocateLocalNow`), while the scheduler/probe/backoff read the
    // injected clock. Anchor the fake clock at "now" (truncated to whole
    // milliseconds, matching the persistence precision) so promotion
    // comparisons and stored-deadline round-trips stay exact.
    clock = TestClock(
      DateTime.fromMillisecondsSinceEpoch(DateTime.now().millisecondsSinceEpoch),
    );
    await seedDeviceBinding(db);
  });

  tearDown(() async {
    await db.close();
  });

  ConnectivityMonitor monitorFor(FakeConnectivityProbe probe) {
    return ConnectivityMonitor(
      probe: probe,
      probeBackoff: deterministic,
      successFreshness: const Duration(minutes: 1),
      clock: clock.call,
    );
  }

  SyncScheduler schedulerFor({
    required ScriptedPushTransport transport,
    required ConnectivityMonitor monitor,
    required FakeTimerFactory timers,
    int batchSize = OutboxRepository.maxPushBatchSize,
    Duration blockedRecheckInterval = const Duration(minutes: 15),
    Duration minRunSpacing = const Duration(milliseconds: 250),
  }) {
    final PushOrchestrator orchestrator = PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchSize: batchSize,
      backoff: deterministic,
      clock: clock.call,
      batchIdFactory: () => 'batch',
    );
    return SyncScheduler(
      orchestrator: orchestrator,
      connectivity: monitor,
      deadlineStore: deadlineStore,
      blockedRecheckInterval: blockedRecheckInterval,
      minRunSpacing: minRunSpacing,
      backoff: deterministic,
      timerFactory: timers,
      clock: clock.call,
    );
  }

  Future<void> settle() async {
    for (int i = 0; i < 30; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  test('an idle outbox schedules no wakeup and never probes for work', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(httpStatus: 200),
    );
    final ConnectivityMonitor monitor = monitorFor(probe);
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[]);
    final FakeTimerFactory timers = FakeTimerFactory();
    final SyncScheduler scheduler = schedulerFor(
      transport: transport,
      monitor: monitor,
      timers: timers,
    );

    await scheduler.start();

    expect(probe.calls, 1); // a verdict was established at boot
    expect(transport.calls, 0);
    expect(scheduler.status.nextRunAt, isNull);
    expect(timers.hasPending, isFalse);

    await scheduler.dispose();
    monitor.dispose();
  });

  test('an unreachable backend waits and recovers on the next probe', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.unreachable(failureKind: ReachabilityFailureKind.dns),
    );
    final ConnectivityMonitor monitor = monitorFor(probe);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      appliedFor(row.mutationId),
    ]);
    final FakeTimerFactory timers = FakeTimerFactory();
    final SyncScheduler scheduler = schedulerFor(
      transport: transport,
      monitor: monitor,
      timers: timers,
    );

    await scheduler.start();

    expect(transport.calls, 0);
    expect(scheduler.status.blocked, isNull);
    expect(
      scheduler.status.nextRunAt,
      clock.now.add(const Duration(seconds: 5)),
    );
    expect(timers.pending.delay, const Duration(seconds: 5));

    // Connectivity returns; the scheduled probe/recheck runs the pass.
    probe.next = const ProbeResult.reachable(httpStatus: 200);
    clock.advance(const Duration(seconds: 5));
    timers.fireNext();
    await settle();

    expect(transport.calls, 1);
    expect((await repo.requireById(row.mutationId)).syncState, 'SYNCED');
    expect(scheduler.status.nextRunAt, isNull);

    await scheduler.dispose();
    monitor.dispose();
  });

  test('a persisted server deadline gates a fresh scheduler (restart)', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(httpStatus: 200),
    );
    final ConnectivityMonitor monitor = monitorFor(probe);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      appliedFor(row.mutationId),
    ]);
    final DateTime deadline = clock.now.add(const Duration(minutes: 10));
    await deadlineStore.write(deadline);

    final FakeTimerFactory timers = FakeTimerFactory();
    final SyncScheduler scheduler = schedulerFor(
      transport: transport,
      monitor: monitor,
      timers: timers,
    );
    await scheduler.start();

    expect(transport.calls, 0);
    expect(scheduler.status.nextRunAt, deadline);
    // Restart: a second scheduler reads the same durable deadline.
    final FakeTimerFactory restartTimers = FakeTimerFactory();
    final SyncScheduler restarted = schedulerFor(
      transport: transport,
      monitor: monitor,
      timers: restartTimers,
    );
    await restarted.start();
    expect(transport.calls, 0);
    expect(restarted.status.nextRunAt, deadline);

    // Once the deadline elapses the pass is allowed.
    clock.now = deadline;
    restartTimers.fireNext();
    await settle();
    expect(transport.calls, 1);
    expect((await repo.requireById(row.mutationId)).syncState, 'SYNCED');

    await scheduler.dispose();
    await restarted.dispose();
    monitor.dispose();
  });

  test('the spacing floor prevents a busy loop between passes', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(httpStatus: 200),
    );
    final ConnectivityMonitor monitor = monitorFor(probe);
    final OutboxData first = await repo.enqueue(testCommand());
    final OutboxData second = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      appliedFor(first.mutationId),
      appliedFor(second.mutationId),
    ]);
    final FakeTimerFactory timers = FakeTimerFactory();
    final SyncScheduler scheduler = schedulerFor(
      transport: transport,
      monitor: monitor,
      timers: timers,
      batchSize: 1,
      minRunSpacing: const Duration(seconds: 1),
    );

    await scheduler.start();
    expect(transport.calls, 1);
    final DateTime firstRun = clock.now;
    expect(scheduler.status.nextRunAt, firstRun.add(const Duration(seconds: 1)));

    // A trigger inside the spacing window must not run a second pass now.
    clock.advance(const Duration(milliseconds: 400));
    await scheduler.trigger();
    expect(transport.calls, 1);
    expect(
      scheduler.status.nextRunAt,
      firstRun.add(const Duration(seconds: 1)),
    );

    // At the spacing boundary the next pass is allowed.
    clock.now = firstRun.add(const Duration(seconds: 1));
    timers.fireNext();
    await settle();
    expect(transport.calls, 2);
    expect((await repo.requireById(second.mutationId)).syncState, 'SYNCED');

    await scheduler.dispose();
    monitor.dispose();
  });

  test('a transient Retry-After is persisted as an absolute deadline', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(httpStatus: 200),
    );
    final ConnectivityMonitor monitor = monitorFor(probe);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(
        kind: PushFailureKind.rateLimited,
        statusCode: 429,
        retryAfter: Duration(seconds: 15),
      ),
      appliedFor(row.mutationId),
    ]);
    final FakeTimerFactory timers = FakeTimerFactory();
    final SyncScheduler scheduler = schedulerFor(
      transport: transport,
      monitor: monitor,
      timers: timers,
    );

    await scheduler.start();

    final DateTime expected = clock.now.add(const Duration(seconds: 15));
    expect(transport.calls, 1);
    expect(scheduler.status.lastFault, PushRunFault.transient);
    expect(scheduler.status.nextRunAt, expected);
    expect((await deadlineStore.read())!.millisecondsSinceEpoch,
        expected.millisecondsSinceEpoch);
    // 429 with a status is reachable transport — the server answered.
    expect(monitor.snapshot.connectivity, BackendConnectivity.reachable);

    // A restart must not retry before the durable deadline.
    final FakeTimerFactory restartTimers = FakeTimerFactory();
    final SyncScheduler restarted = schedulerFor(
      transport: transport,
      monitor: monitor,
      timers: restartTimers,
    );
    await restarted.start();
    expect(transport.calls, 1);
    expect(restarted.status.nextRunAt, expected);

    // At the deadline the retry is promoted and the pass succeeds.
    clock.now = expected;
    restartTimers.fireNext();
    await settle();
    expect(transport.calls, 2);
    expect((await repo.requireById(row.mutationId)).syncState, 'SYNCED');
    expect(await deadlineStore.read(), isNull);

    await scheduler.dispose();
    await restarted.dispose();
    monitor.dispose();
  });

  test('a 5xx failure is degraded evidence with a laddered wait', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(httpStatus: 200),
    );
    final ConnectivityMonitor monitor = monitorFor(probe);
    await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(
        kind: PushFailureKind.serverError,
        statusCode: 503,
      ),
    ]);
    final FakeTimerFactory timers = FakeTimerFactory();
    final SyncScheduler scheduler = schedulerFor(
      transport: transport,
      monitor: monitor,
      timers: timers,
    );

    await scheduler.start();

    expect(monitor.snapshot.connectivity, BackendConnectivity.degraded);
    expect(scheduler.status.lastFault, PushRunFault.transient);
    // No server directive → the local ladder (attempt 1 → base 5s).
    expect(scheduler.status.nextRunAt, clock.now.add(const Duration(seconds: 5)));
    expect(await deadlineStore.read(), isNull);

    await scheduler.dispose();
    monitor.dispose();
  });

  test('a network failure is unreachable evidence', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(httpStatus: 200),
    );
    final ConnectivityMonitor monitor = monitorFor(probe);
    await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(kind: PushFailureKind.network),
    ]);
    final FakeTimerFactory timers = FakeTimerFactory();
    final SyncScheduler scheduler = schedulerFor(
      transport: transport,
      monitor: monitor,
      timers: timers,
    );

    await scheduler.start();

    expect(monitor.snapshot.connectivity, BackendConnectivity.unreachable);
    expect(monitor.snapshot.lastFailureKind, ReachabilityFailureKind.network);

    await scheduler.dispose();
    monitor.dispose();
  });

  test('client-too-old blocks and rechecks slowly, not in a storm', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(httpStatus: 200),
    );
    final ConnectivityMonitor monitor = monitorFor(probe);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(
        kind: PushFailureKind.clientTooOld,
        statusCode: 426,
      ),
    ]);
    final FakeTimerFactory timers = FakeTimerFactory();
    final SyncScheduler scheduler = schedulerFor(
      transport: transport,
      monitor: monitor,
      timers: timers,
      blockedRecheckInterval: const Duration(minutes: 15),
    );

    await scheduler.start();

    expect(scheduler.status.blocked, SyncBlockedReason.clientTooOld);
    expect(scheduler.status.lastFault, PushRunFault.clientTooOld);
    // The record is preserved, not rejected.
    expect((await repo.requireById(row.mutationId)).syncState, 'PENDING');
    // The recheck uses the slow interval, not the 5s transient ladder.
    expect(scheduler.status.nextRunAt, clock.now.add(const Duration(minutes: 15)));
    expect(timers.pending.delay, const Duration(minutes: 15));

    await scheduler.dispose();
    monitor.dispose();
  });

  test('server-unsupported blocks and preserves the queue', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(httpStatus: 200),
    );
    final ConnectivityMonitor monitor = monitorFor(probe);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(
        kind: PushFailureKind.serverUnsupported,
        statusCode: 404,
      ),
    ]);
    final FakeTimerFactory timers = FakeTimerFactory();
    final SyncScheduler scheduler = schedulerFor(
      transport: transport,
      monitor: monitor,
      timers: timers,
    );

    await scheduler.start();

    expect(scheduler.status.blocked, SyncBlockedReason.serverUnsupported);
    expect((await repo.requireById(row.mutationId)).syncState, 'PENDING');
    expect(scheduler.status.nextRunAt, clock.now.add(const Duration(minutes: 15)));

    await scheduler.dispose();
    monitor.dispose();
  });

  test('authentication requires attention and is not a block', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(httpStatus: 200),
    );
    final ConnectivityMonitor monitor = monitorFor(probe);
    await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(
        kind: PushFailureKind.unauthorized,
        statusCode: 401,
      ),
    ]);
    final FakeTimerFactory timers = FakeTimerFactory();
    final SyncScheduler scheduler = schedulerFor(
      transport: transport,
      monitor: monitor,
      timers: timers,
    );

    await scheduler.start();

    expect(scheduler.status.authAttention, isTrue);
    expect(scheduler.status.blocked, isNull);
    expect(scheduler.status.lastFault, PushRunFault.authenticationRequired);

    await scheduler.dispose();
    monitor.dispose();
  });

  test('a successful pass clears a stale deadline', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(httpStatus: 200),
    );
    final ConnectivityMonitor monitor = monitorFor(probe);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      appliedFor(row.mutationId),
    ]);
    await deadlineStore.write(clock.now.subtract(const Duration(minutes: 1)));
    final FakeTimerFactory timers = FakeTimerFactory();
    final SyncScheduler scheduler = schedulerFor(
      transport: transport,
      monitor: monitor,
      timers: timers,
    );

    await scheduler.start();

    expect(transport.calls, 1);
    expect((await repo.requireById(row.mutationId)).syncState, 'SYNCED');
    expect(await deadlineStore.read(), isNull);

    await scheduler.dispose();
    monitor.dispose();
  });

  test('concurrent triggers coalesce into a single pass', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(httpStatus: 200),
    );
    final ConnectivityMonitor monitor = monitorFor(probe);
    final OutboxData first = await repo.enqueue(testCommand());
    final OutboxData second = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      appliedFor(first.mutationId),
      appliedFor(second.mutationId),
    ]);
    final FakeTimerFactory timers = FakeTimerFactory();
    final SyncScheduler scheduler = schedulerFor(
      transport: transport,
      monitor: monitor,
      timers: timers,
      batchSize: 1,
      minRunSpacing: Duration.zero,
    );

    await scheduler.start();
    expect(transport.calls, 1);

    final Future<void> one = scheduler.trigger();
    final Future<void> two = scheduler.trigger();
    await Future.wait(<Future<void>>[one, two]);
    await settle();

    // The second trigger coalesced rather than racing a second pass.
    expect(transport.calls, 2);
    expect(scheduler.status.passInFlight, isFalse);

    await scheduler.dispose();
    monitor.dispose();
  });

  test('pause cancels work; resume re-evaluates', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(httpStatus: 200),
    );
    final ConnectivityMonitor monitor = monitorFor(probe);
    final OutboxData first = await repo.enqueue(testCommand());
    final OutboxData second = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      appliedFor(first.mutationId),
      appliedFor(second.mutationId),
    ]);
    final FakeTimerFactory timers = FakeTimerFactory();
    final SyncScheduler scheduler = schedulerFor(
      transport: transport,
      monitor: monitor,
      timers: timers,
      batchSize: 1,
      minRunSpacing: Duration.zero,
    );

    await scheduler.start();
    expect(transport.calls, 1);

    await scheduler.pause();
    expect(scheduler.status.paused, isTrue);
    expect(scheduler.status.nextRunAt, isNull);
    await scheduler.trigger();
    expect(transport.calls, 1);

    await scheduler.resume();
    expect(transport.calls, 2);
    expect((await repo.requireById(second.mutationId)).syncState, 'SYNCED');

    await scheduler.dispose();
    monitor.dispose();
  });

  test('dispose is idempotent and rejects further commands', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(httpStatus: 200),
    );
    final ConnectivityMonitor monitor = monitorFor(probe);
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[]);
    final FakeTimerFactory timers = FakeTimerFactory();
    final SyncScheduler scheduler = schedulerFor(
      transport: transport,
      monitor: monitor,
      timers: timers,
    );

    await scheduler.dispose();
    await scheduler.dispose();
    expect(() => scheduler.start(), throwsStateError);
    expect(() => scheduler.trigger(), throwsStateError);

    monitor.dispose();
  });
}
