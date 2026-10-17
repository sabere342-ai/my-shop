/// Timer abstraction for deterministic scheduling — Master Plan §40.5 C3/C8.
///
/// A single timer drives the scheduler to avoid timer storms and to keep
/// wakeups testable (no real sleeps). Production uses `Timer` from
/// `dart:async`; tests inject a fake factory. The abstraction is narrow and
/// follows the existing principle of dependency injection.
library;

import 'dart:async';

/// A cancellable timer returned by a [RetryTimerFactory].
abstract interface class RetryTimer {
  /// Cancels the timer; [callback] will not run.
  void cancel();

  /// True if the timer has not been cancelled and has not fired.
  bool get isActive;
}

/// Produces a [RetryTimer] that calls [callback] after [delay].
abstract interface class RetryTimerFactory {
  RetryTimer schedule(Duration delay, void Function() callback);
}

/// Production [RetryTimerFactory] wrapping `Timer`.
class SystemRetryTimerFactory implements RetryTimerFactory {
  const SystemRetryTimerFactory();

  @override
  RetryTimer schedule(Duration delay, void Function() callback) =>
      _SystemRetryTimer(Timer(delay, callback));
}

class _SystemRetryTimer implements RetryTimer {
  _SystemRetryTimer(this._timer);

  final Timer _timer;

  @override
  void cancel() => _timer.cancel();

  @override
  bool get isActive => _timer.isActive;
}
