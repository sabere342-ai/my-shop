import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_monitor.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_probe.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_state.dart';
import 'package:my_shop_desktop/core/offline/sync/backoff_policy.dart';

import 'connectivity_test_harness.dart';

const BackoffPolicy _deterministicProbeLadder = BackoffPolicy(
  baseDelay: Duration(seconds: 5),
  maxDelay: Duration(minutes: 5),
  jitterFraction: 0,
);

void main() {
  late TestClock clock;

  setUp(() {
    clock = TestClock(DateTime.utc(2026, 1, 1, 12));
  });

  ConnectivityMonitor buildMonitor(
    FakeConnectivityProbe probe, {
    Duration successFreshness = const Duration(minutes: 1),
  }) {
    return ConnectivityMonitor(
      probe: probe,
      probeBackoff: _deterministicProbeLadder,
      successFreshness: successFreshness,
      clock: clock.call,
    );
  }

  test('a fresh process is unknown but optimistic', () {
    final ConnectivityMonitor monitor = buildMonitor(FakeConnectivityProbe());
    expect(monitor.snapshot.connectivity, BackendConnectivity.unknown);
    expect(monitor.snapshot.mayAttemptSync, isTrue);
    expect(monitor.snapshot.lastVerifiedAt, isNull);
    monitor.dispose();
  });

  test('a reachable probe records verification and a freshness window', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(httpStatus: 200),
    );
    final ConnectivityMonitor monitor = buildMonitor(probe);
    final ConnectivitySnapshot snapshot = await monitor.checkNow();
    expect(snapshot.connectivity, BackendConnectivity.reachable);
    expect(snapshot.mayAttemptSync, isTrue);
    expect(snapshot.lastVerifiedAt, clock.now);
    expect(snapshot.nextProbeAt, clock.now.add(const Duration(minutes: 1)));
    monitor.dispose();
  });

  test('a reachable probe is not repeated inside the freshness window', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(),
    );
    final ConnectivityMonitor monitor = buildMonitor(probe);
    await monitor.checkNow();
    await monitor.checkNow();
    expect(probe.calls, 1);
    expect(monitor.timeUntilNextProbe, const Duration(minutes: 1));
    monitor.dispose();
  });

  test('force re-probes inside the freshness window', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.reachable(),
    );
    final ConnectivityMonitor monitor = buildMonitor(probe);
    await monitor.checkNow();
    await monitor.checkNow(force: true);
    expect(probe.calls, 2);
    monitor.dispose();
  });

  test('an unreachable probe schedules a backoff probe', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.unreachable(failureKind: ReachabilityFailureKind.dns),
    );
    final ConnectivityMonitor monitor = buildMonitor(probe);
    final ConnectivitySnapshot snapshot = await monitor.checkNow();
    expect(snapshot.connectivity, BackendConnectivity.unreachable);
    expect(snapshot.mayAttemptSync, isFalse);
    expect(snapshot.lastFailureKind, ReachabilityFailureKind.dns);
    expect(snapshot.consecutiveFailures, 1);
    expect(snapshot.nextProbeAt, clock.now.add(const Duration(seconds: 5)));
    monitor.dispose();
  });

  test('the probe ladder grows with consecutive failures', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.unreachable(failureKind: ReachabilityFailureKind.network),
    );
    final ConnectivityMonitor monitor = buildMonitor(probe);
    await monitor.checkNow(force: true);
    expect(monitor.snapshot.nextProbeAt, clock.now.add(const Duration(seconds: 5)));
    clock.advance(const Duration(seconds: 5));
    await monitor.checkNow(force: true);
    expect(monitor.snapshot.consecutiveFailures, 2);
    expect(monitor.snapshot.nextProbeAt, clock.now.add(const Duration(seconds: 10)));
    monitor.dispose();
  });

  test('a Retry-After larger than the ladder is honoured', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.unreachable(
        failureKind: ReachabilityFailureKind.serverError,
        retryAfter: Duration(minutes: 2),
      ),
    );
    final ConnectivityMonitor monitor = buildMonitor(probe);
    await monitor.checkNow();
    expect(monitor.snapshot.nextProbeAt, clock.now.add(const Duration(minutes: 2)));
    monitor.dispose();
  });

  test('a Retry-After shorter than the ladder is not used to shorten it', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.unreachable(
        failureKind: ReachabilityFailureKind.serverError,
        retryAfter: Duration(seconds: 1),
      ),
    );
    final ConnectivityMonitor monitor = buildMonitor(probe);
    await monitor.checkNow();
    expect(monitor.snapshot.nextProbeAt, clock.now.add(const Duration(seconds: 5)));
    monitor.dispose();
  });

  test('a 5xx probe is degraded, not unreachable', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.degraded(httpStatus: 503),
    );
    final ConnectivityMonitor monitor = buildMonitor(probe);
    final ConnectivitySnapshot snapshot = await monitor.checkNow();
    expect(snapshot.connectivity, BackendConnectivity.degraded);
    expect(snapshot.mayAttemptSync, isTrue);
    expect(snapshot.lastFailureKind, ReachabilityFailureKind.serverError);
    monitor.dispose();
  });

  test('concurrent checkNow calls coalesce into one probe', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe();
    probe.pending = Completer<ProbeResult>();
    final ConnectivityMonitor monitor = buildMonitor(probe);
    final Future<ConnectivitySnapshot> first = monitor.checkNow();
    final Future<ConnectivitySnapshot> second = monitor.checkNow();
    probe.pending!.complete(const ProbeResult.reachable());
    final List<ConnectivitySnapshot> results = await Future.wait(<Future<ConnectivitySnapshot>>[
      first,
      second,
    ]);
    expect(probe.calls, 1);
    expect(results[0].connectivity, BackendConnectivity.reachable);
    expect(results[1].connectivity, BackendConnectivity.reachable);
    monitor.dispose();
  });

  test('a probe in flight after a failure is recovering', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.unreachable(failureKind: ReachabilityFailureKind.network),
    );
    final ConnectivityMonitor monitor = buildMonitor(probe);
    await monitor.checkNow();
    expect(monitor.snapshot.connectivity, BackendConnectivity.unreachable);

    // A second probe is now in flight.
    probe.pending = Completer<ProbeResult>();
    final Future<ConnectivitySnapshot> inFlight = monitor.checkNow(force: true);
    expect(monitor.snapshot.connectivity, BackendConnectivity.recovering);
    probe.pending!.complete(const ProbeResult.reachable());
    await inFlight;
    expect(monitor.snapshot.connectivity, BackendConnectivity.reachable);
    monitor.dispose();
  });

  test('sync evidence updates the verdict without a probe', () {
    final FakeConnectivityProbe probe = FakeConnectivityProbe();
    final ConnectivityMonitor monitor = buildMonitor(probe);
    monitor.recordEvidence(ConnectivityEvidence.reachable);
    expect(monitor.snapshot.connectivity, BackendConnectivity.reachable);
    expect(probe.calls, 0);

    monitor.recordEvidence(
      ConnectivityEvidence.degraded,
      failureKind: ReachabilityFailureKind.serverError,
    );
    expect(monitor.snapshot.connectivity, BackendConnectivity.degraded);

    monitor.recordEvidence(
      ConnectivityEvidence.unreachable,
      failureKind: ReachabilityFailureKind.network,
    );
    expect(monitor.snapshot.connectivity, BackendConnectivity.unreachable);
    expect(probe.calls, 0);
    monitor.dispose();
  });

  test('a probe result clears a prior failure', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.unreachable(failureKind: ReachabilityFailureKind.network),
    );
    final ConnectivityMonitor monitor = buildMonitor(probe);
    await monitor.checkNow();
    expect(monitor.snapshot.consecutiveFailures, 1);
    probe.next = const ProbeResult.reachable();
    await monitor.checkNow(force: true);
    expect(monitor.snapshot.consecutiveFailures, 0);
    expect(monitor.snapshot.lastFailureKind, isNull);
    expect(monitor.snapshot.connectivity, BackendConnectivity.reachable);
    monitor.dispose();
  });

  test('identical consecutive snapshots are not emitted twice', () async {
    final ConnectivityMonitor monitor = buildMonitor(FakeConnectivityProbe());
    final List<ConnectivitySnapshot> emitted = <ConnectivitySnapshot>[];
    final StreamSubscription<ConnectivitySnapshot> sub = monitor.changes.listen(
      emitted.add,
    );
    // Two identical evidence applications at the same instant yield the same
    // snapshot, so only the first is emitted.
    monitor.recordEvidence(ConnectivityEvidence.reachable);
    monitor.recordEvidence(ConnectivityEvidence.reachable);
    await Future<void>.delayed(Duration.zero);
    expect(emitted.length, 1);
    expect(emitted.single.connectivity, BackendConnectivity.reachable);
    await sub.cancel();
    monitor.dispose();
  });

  test('checkNow after dispose throws', () {
    final ConnectivityMonitor monitor = buildMonitor(FakeConnectivityProbe());
    monitor.dispose();
    expect(() => monitor.checkNow(), throwsStateError);
  });

  test('timeUntilNextProbe is zero when a probe is due', () async {
    final FakeConnectivityProbe probe = FakeConnectivityProbe(
      const ProbeResult.unreachable(failureKind: ReachabilityFailureKind.network),
    );
    final ConnectivityMonitor monitor = buildMonitor(probe);
    await monitor.checkNow();
    expect(monitor.timeUntilNextProbe, const Duration(seconds: 5));
    clock.advance(const Duration(seconds: 5));
    expect(monitor.timeUntilNextProbe, Duration.zero);
    monitor.dispose();
  });
}
