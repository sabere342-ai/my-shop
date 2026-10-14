import 'dart:async';

import 'package:my_shop_desktop/core/offline/connectivity/connectivity_probe.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_state.dart';
import 'package:my_shop_desktop/core/offline/sync/scheduler_timer.dart';

/// A probe whose result is scripted.
class FakeConnectivityProbe implements ConnectivityProbe {
  FakeConnectivityProbe([ProbeResult? initial])
    : _next =
          initial ??
          const ProbeResult.unreachable(
            failureKind: ReachabilityFailureKind.unknown,
          );

  ProbeResult _next;
  int calls = 0;
  Completer<ProbeResult>? pending;

  set next(ProbeResult result) => _next = result;

  @override
  Future<ProbeResult> probe() async {
    calls++;
    final Completer<ProbeResult>? p = pending;
    if (p != null) {
      return p.future;
    }
    return Future.value(_next);
  }
}

/// Mutable clock for deterministic tests.
class TestClock {
  TestClock(this.now);

  DateTime now;

  DateTime call() => now;

  void advance(Duration duration) => now = now.add(duration);
}

/// Fake timer factory.
class FakeTimer implements RetryTimer {
  FakeTimer(this.delay, this.callback);

  final Duration delay;
  final void Function() callback;
  bool cancelled = false;
  bool fired = false;

  @override
  void cancel() => cancelled = true;

  @override
  bool get isActive => !cancelled && !fired;

  void fire() {
    if (cancelled || fired) return;
    fired = true;
    callback();
  }
}

class FakeTimerFactory implements RetryTimerFactory {
  final List<FakeTimer> _timers = [];

  List<FakeTimer> get timers => _timers;

  FakeTimer get pending {
    for (int i = _timers.length - 1; i >= 0; i--) {
      final FakeTimer t = _timers[i];
      if (!t.cancelled && !t.fired) return t;
    }
    throw StateError('no pending timer');
  }

  bool get hasPending => _timers.any((t) => t.isActive);

  void fireNext() {
    for (final FakeTimer t in List<FakeTimer>.from(_timers)) {
      if (!t.cancelled && !t.fired) {
        t.fire();
        return;
      }
    }
    throw StateError('no timer to fire');
  }

  void fireAll() {
    while (hasPending) {
      fireNext();
    }
  }

  void advance(Duration duration) {
    for (final FakeTimer t in List<FakeTimer>.from(_timers)) {
      if (!t.cancelled && !t.fired) {
        t.fire();
      }
    }
  }

  void clear() => _timers.clear();

  @override
  RetryTimer schedule(Duration delay, void Function() callback) {
    final FakeTimer t = FakeTimer(delay, callback);
    _timers.add(t);
    return t;
  }
}
