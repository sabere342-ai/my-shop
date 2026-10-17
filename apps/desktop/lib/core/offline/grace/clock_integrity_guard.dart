/// The client-local clock-integrity guard — Master Plan §38.16.5, F-21/F-22,
/// §40.5 (M1b-S8).
///
/// §38.16.5 splits clock tampering in two:
///
/// * **Backward** — "A monotonic counter plus a persisted high-water mark. A
///   clock that moves backwards does not re-issue receipts or re-open an
///   expired window."
/// * **Forward** — "Detected and rejected: forward jumps beyond a stated
///   tolerance require online re-validation."
///
/// This file implements both, and states the tolerance the plan asks to be
/// stated ([defaultTolerance]).
///
/// **What it can and cannot see — stated, not hidden.** §38.16.5's forward rule
/// is anchored to "a signed time anchor [the] server issues on every successful
/// sync". That anchor is issued by the identity/entitlement slices (M2), which
/// do not exist at M1b. Until they do, this guard corroborates the wall clock
/// against a **monotonic source within the running process**: the wall clock
/// and the monotonic clock should advance together, so a wall clock that moves
/// forward by more than [tolerance] relative to the monotonic clock was changed
/// under the process. A jump performed while the process is **not running** is
/// not observable by any client-local guard, so it is a documented residual
/// risk bounded by the grace window (§38.16.5, R-14's honesty about what offline
/// cannot know) — not something this code pretends to catch.
///
/// The backward half is durable: the high-water mark is persisted by the store
/// and handed back in, so a backwards jump between runs still cannot re-open an
/// expired window.
library;

/// What one observation of the clocks found.
enum ClockIntegrity {
  /// The wall clock advanced consistently with the monotonic clock.
  ok,

  /// The wall clock is behind a value already observed. Effective time does not
  /// regress, so an expired window is not re-opened (§38.16.5 backward rule).
  backwardJump,

  /// The wall clock moved forward beyond tolerance relative to the monotonic
  /// clock. Online re-validation is required (§38.16.5 forward rule, F-21).
  forwardJump,
}

/// The result of one [ClockIntegrityGuard.observe] call.
class ClockObservation {
  const ClockObservation({required this.integrity, required this.effectiveNow});

  final ClockIntegrity integrity;

  /// Time with the monotonic high-water applied: never earlier than any value
  /// already observed, so a backward jump cannot reopen the grace window.
  final DateTime effectiveNow;
}

/// Corroborates the device wall clock against a monotonic source (§38.16.5).
class ClockIntegrityGuard {
  ClockIntegrityGuard({
    required DateTime Function() wallClock,
    required Duration Function() monotonicClock,
    DateTime? persistedHighWater,
    this.tolerance = defaultTolerance,
  })  : _wallClock = wallClock,
        _monotonicClock = monotonicClock {
    _wallBaseline = wallClock();
    _monoBaseline = monotonicClock();
    _highWater = persistedHighWater;
  }

  /// The stated tolerance: a wall clock that outruns the monotonic clock by
  /// more than this in one process is treated as tampered (§38.16.5). One hour
  /// absorbs ordinary NTP correction — the plan's residual-risk note is that a
  /// device "inside the tolerance window can misdate a sale by hours" — while a
  /// deliberate multi-day jump is far past it.
  static const Duration defaultTolerance = Duration(hours: 1);

  /// The stated forward-jump tolerance. Public because §38.16.5 asks that the
  /// tolerance be stated, and a caller may surface it to the owner.
  final Duration tolerance;

  final DateTime Function() _wallClock;
  final Duration Function() _monotonicClock;

  late final DateTime _wallBaseline;
  late final Duration _monoBaseline;

  DateTime? _highWater;

  /// The greatest wall-clock instant observed so far, for the caller to
  /// persist and hand back on the next run.
  DateTime? get highWater => _highWater;

  /// Observes both clocks once and classifies their relationship.
  ClockObservation observe() {
    final DateTime now = _wallClock();
    final Duration monotonic = _monotonicClock();

    final DateTime expected = _wallBaseline.add(monotonic - _monoBaseline);
    final bool forward = now.difference(expected) > tolerance;

    final DateTime? previousHighWater = _highWater;
    final bool backward = previousHighWater != null && now.isBefore(previousHighWater);
    final DateTime highWater =
        previousHighWater == null || now.isAfter(previousHighWater) ? now : previousHighWater;
    _highWater = highWater;

    if (forward) {
      return ClockObservation(integrity: ClockIntegrity.forwardJump, effectiveNow: highWater);
    }
    if (backward) {
      return ClockObservation(integrity: ClockIntegrity.backwardJump, effectiveNow: highWater);
    }
    return ClockObservation(integrity: ClockIntegrity.ok, effectiveNow: highWater);
  }
}
