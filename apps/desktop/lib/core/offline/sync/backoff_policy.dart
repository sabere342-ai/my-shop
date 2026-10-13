/// The §38.10.4 retry ladder: exponential backoff with jitter, honouring
/// `Retry-After`.
///
/// The policy is pure and deterministic given a [Random], so the tests pin the
/// ladder instead of sleeping, and the orchestrator is the only caller. The
/// rules are §38.10.4's table:
///
/// * **Network error, DNS failure, timeout, `5xx`** — exponential backoff with
///   jitter. The record is not lost; the retry is safe (§38.8.2).
/// * **`429`** — honour `Retry-After`.
/// * A server-supplied `Retry-After` always wins over the computed ladder,
///   because the server knows when it will accept traffic again.
///
/// Jitter is *additive* (the delay is never shortened below the exponential
/// value): a fleet of tills that all failed at once must not retry in lockstep,
/// and a shorter delay would only add load to a struggling server.
library;

import 'dart:math';

/// Exponential backoff with additive jitter and `Retry-After` precedence.
class BackoffPolicy {
  const BackoffPolicy({
    this.baseDelay = const Duration(seconds: 1),
    this.maxDelay = const Duration(minutes: 5),
    this.jitterFraction = 0.5,
  });

  /// The delay after the first failure; each further attempt doubles it.
  final Duration baseDelay;

  /// The ceiling of the computed ladder. `Retry-After` is honoured even above
  /// it: the server's instruction is authoritative (§38.10.4).
  final Duration maxDelay;

  /// The fraction of the base delay added as random jitter, in `[0, 1]`.
  /// `0` disables jitter and makes the ladder exactly exponential.
  final double jitterFraction;

  /// The deterministic, un-jittered exponential delay for [attempt].
  ///
  /// [attempt] is 1-based: `1` is the first retry after the first failure.
  /// Saturates at [maxDelay] without overflow.
  Duration baseDelayFor(int attempt) {
    if (attempt < 1) {
      throw ArgumentError.value(attempt, 'attempt', 'must be >= 1 (§38.10.4)');
    }
    final int base = baseDelay.inMilliseconds;
    final int cap = maxDelay.inMilliseconds;
    if (base >= cap) return maxDelay;
    int delay = base;
    for (int step = 1; step < attempt && delay < cap; step++) {
      delay *= 2;
    }
    return Duration(milliseconds: delay < cap ? delay : cap);
  }

  /// The delay to wait before the next attempt.
  ///
  /// A non-zero [retryAfter] wins outright over the computed ladder (§38.10.4).
  /// Otherwise the exponential delay is jittered by up to
  /// `baseDelay * jitterFraction`. [random] is injectable so tests are
  /// deterministic.
  Duration delayFor(int attempt, {Duration? retryAfter, Random? random}) {
    final Duration? server = retryAfter;
    if (server != null && server.inMilliseconds > 0) return server;

    final Duration ladder = baseDelayFor(attempt);
    if (jitterFraction <= 0) return ladder;

    final int jitterMillis = (ladder.inMilliseconds * jitterFraction).floor();
    if (jitterMillis <= 0) return ladder;

    final Random entropy = random ?? Random();
    return Duration(milliseconds: ladder.inMilliseconds + entropy.nextInt(jitterMillis + 1));
  }

  /// True when a mutation whose last attempt started at [lastAttemptAt] may be
  /// retried at [now].
  ///
  /// This is the durable-eligibility test: both [attempt] and [lastAttemptAt]
  /// are persisted on the outbox row, so a scheduled retry survives a restart
  /// (F-17's "never unbounded" is about *rate*, not about losing the record).
  bool isDue({
    required int attempt,
    required DateTime lastAttemptAt,
    required DateTime now,
    Duration? retryAfter,
  }) {
    final Duration delay = delayFor(attempt, retryAfter: retryAfter);
    return !now.isBefore(lastAttemptAt.add(delay));
  }
}
