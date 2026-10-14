import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/sync/retry_after.dart';

void main() {
  final DateTime now = DateTime.utc(2026, 1, 1, 12, 0, 0);

  group('parseRetryAfter — numeric seconds', () {
    test('parses a positive integer', () {
      expect(parseRetryAfter('15', now: now), const Duration(seconds: 15));
    });

    test('trims surrounding whitespace', () {
      expect(parseRetryAfter('  30 ', now: now), const Duration(seconds: 30));
    });

    test('zero is not a directive', () {
      expect(parseRetryAfter('0', now: now), isNull);
    });

    test('a negative value is not a directive', () {
      expect(parseRetryAfter('-5', now: now), isNull);
    });

    test('a leading plus is rejected as ambiguous', () {
      expect(parseRetryAfter('+5', now: now), isNull);
    });

    test('a non-numeric value falls back', () {
      expect(parseRetryAfter('soon', now: now), isNull);
    });

    test('a blank value falls back', () {
      expect(parseRetryAfter('   ', now: now), isNull);
      expect(parseRetryAfter('', now: now), isNull);
    });

    test('null falls back', () {
      expect(parseRetryAfter(null, now: now), isNull);
    });

    test('a fractional value falls back', () {
      expect(parseRetryAfter('1.5', now: now), isNull);
    });
  });

  group('parseRetryAfter — HTTP-date', () {
    test('parses a future date into the remaining duration', () {
      final String header = HttpDate.format(now.add(const Duration(seconds: 60)));
      final Duration? parsed = parseRetryAfter(header, now: now);
      expect(parsed, isNotNull);
      // HttpDate has one-second resolution, so allow a small tolerance.
      expect(parsed!.inSeconds, closeTo(60, 1));
    });

    test('a past date falls back', () {
      final String header = HttpDate.format(now.subtract(const Duration(seconds: 30)));
      expect(parseRetryAfter(header, now: now), isNull);
    });

    test('a date equal to now falls back', () {
      final String header = HttpDate.format(now);
      expect(parseRetryAfter(header, now: now), isNull);
    });

    test('a malformed date falls back', () {
      expect(parseRetryAfter('Wed, 99 Foo 2026 12:00:00 GMT', now: now), isNull);
    });
  });

  group('parseRetryAfter — safety cap', () {
    test('a huge numeric value is capped by the default ceiling', () {
      expect(
        parseRetryAfter('999999999', now: now),
        defaultRetryAfterCap,
      );
    });

    test('a custom cap is honoured', () {
      expect(
        parseRetryAfter('999999999', now: now, cap: const Duration(minutes: 5)),
        const Duration(minutes: 5),
      );
    });

    test('a huge HTTP-date is capped too', () {
      final String header = HttpDate.format(now.add(const Duration(days: 3650)));
      expect(
        parseRetryAfter(header, now: now, cap: const Duration(hours: 1)),
        const Duration(hours: 1),
      );
    });

    test('a value below the cap is unchanged', () {
      expect(
        parseRetryAfter('120', now: now, cap: const Duration(hours: 1)),
        const Duration(seconds: 120),
      );
    });
  });
}
