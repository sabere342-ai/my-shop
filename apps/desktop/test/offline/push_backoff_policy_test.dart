import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/sync/backoff_policy.dart';

void main() {
  const BackoffPolicy defaultPolicy = BackoffPolicy();

  test('attempt 1 uses base delay', () {
    expect(defaultPolicy.baseDelayFor(1), defaultPolicy.baseDelay);
  });

  test('attempt 2 doubles base delay', () {
    expect(defaultPolicy.baseDelayFor(2), defaultPolicy.baseDelay * 2);
  });

  test('attempt 3 quadruples base delay', () {
    expect(defaultPolicy.baseDelayFor(3), defaultPolicy.baseDelay * 4);
  });

  test('delay is capped at max', () {
    final BackoffPolicy capped = BackoffPolicy(
      baseDelay: const Duration(seconds: 10),
      maxDelay: const Duration(seconds: 30),
    );
    expect(capped.baseDelayFor(3), const Duration(seconds: 30));
    expect(capped.baseDelayFor(10), const Duration(seconds: 30));
  });

  test('if base >= max, return max', () {
    final BackoffPolicy policy = BackoffPolicy(
      baseDelay: const Duration(seconds: 60),
      maxDelay: const Duration(seconds: 30),
    );
    expect(policy.baseDelayFor(1), const Duration(seconds: 30));
  });

  test('attempt < 1 throws', () {
    expect(() => defaultPolicy.baseDelayFor(0), throwsArgumentError);
  });

  test('Retry-After takes precedence over computed delay', () {
    const Duration retryAfter = Duration(seconds: 120);
    final Duration delay = defaultPolicy.delayFor(1, retryAfter: retryAfter);
    expect(delay, retryAfter);
  });

  test('Retry-After must be positive; negative is ignored', () {
    final BackoffPolicy policy = BackoffPolicy(jitterFraction: 0);
    final Duration delay = policy.delayFor(1, retryAfter: const Duration(seconds: -5));
    expect(delay, policy.baseDelayFor(1));
  });

  test('jitterFraction 0 yields deterministic exponential delay', () {
    final BackoffPolicy noJitter = BackoffPolicy(jitterFraction: 0);
    expect(noJitter.delayFor(1), const Duration(seconds: 1));
    expect(noJitter.delayFor(2), const Duration(seconds: 2));
    expect(noJitter.delayFor(3), const Duration(seconds: 4));
  });

  test('jitter is additive and bounded', () {
    final BackoffPolicy policy = BackoffPolicy(
      baseDelay: const Duration(seconds: 4),
      jitterFraction: 0.5,
    );
    // baseFor(1)=4s, jitter up to 2s → [4s, 6s].
    final Duration d = policy.delayFor(1, random: Random(42));
    expect(d.inMilliseconds, greaterThanOrEqualTo(4000));
    expect(d.inMilliseconds, lessThanOrEqualTo(6000));
  });

  test('isDue returns false before the window and true at or after', () {
    final DateTime last = DateTime.utc(2026, 1, 1, 12, 0, 0);
    final BackoffPolicy policy = BackoffPolicy(jitterFraction: 0);
    expect(policy.isDue(attempt: 1, lastAttemptAt: last, now: last), isFalse);
    expect(
      policy.isDue(attempt: 1, lastAttemptAt: last, now: last.add(const Duration(seconds: 1))),
      isTrue,
    );
    expect(
      policy.isDue(attempt: 2, lastAttemptAt: last, now: last.add(const Duration(seconds: 1))),
      isFalse,
    );
    expect(
      policy.isDue(attempt: 2, lastAttemptAt: last, now: last.add(const Duration(seconds: 2))),
      isTrue,
    );
    expect(
      policy.isDue(attempt: 3, lastAttemptAt: last, now: last.add(const Duration(seconds: 3))),
      isFalse,
    );
    expect(
      policy.isDue(attempt: 3, lastAttemptAt: last, now: last.add(const Duration(seconds: 4))),
      isTrue,
    );
  });

  test('isDue honours Retry-After', () {
    final DateTime now = DateTime.utc(2026, 1, 1, 12, 0, 0);
    final DateTime last = DateTime.utc(2026, 1, 1, 12, 0, 0);
    final BackoffPolicy policy = BackoffPolicy(jitterFraction: 0);
    final Duration retryAfter = const Duration(seconds: 10);
    expect(
      policy.isDue(attempt: 1, lastAttemptAt: last, now: last.add(const Duration(seconds: 9)), retryAfter: retryAfter),
      isFalse,
    );
    expect(
      policy.isDue(attempt: 1, lastAttemptAt: last, now: last.add(const Duration(seconds: 10)), retryAfter: retryAfter),
      isTrue,
    );
  });
}
