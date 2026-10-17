import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/outbox/uuid_v7.dart';
import 'package:my_shop_desktop/core/telemetry/correlation.dart';

void main() {
  group('isSafeCorrelationId', () {
    test('accepts a UUIDv7, a header token, and the safe punctuation set', () {
      expect(isSafeCorrelationId('018f2a4b-7c3d-7e5f-8a9b-0c1d2e3f4a5b'), isTrue);
      expect(isSafeCorrelationId('trace-from-device.v1:batch_7'), isTrue);
      expect(isSafeCorrelationId('a'), isTrue);
    });

    test('rejects a non-string', () {
      expect(isSafeCorrelationId(null), isFalse);
      expect(isSafeCorrelationId(7), isFalse);
      expect(isSafeCorrelationId(<String>['a']), isFalse);
    });

    test('rejects an empty or over-long value', () {
      expect(isSafeCorrelationId(''), isFalse);
      expect(isSafeCorrelationId('a' * (maxCorrelationIdLength + 1)), isFalse);
      expect(isSafeCorrelationId('a' * maxCorrelationIdLength), isTrue);
    });

    test('rejects whitespace, quotes, control characters, and newlines', () {
      // A header echoed into a log line must not be able to forge a boundary.
      expect(isSafeCorrelationId('has space'), isFalse);
      expect(isSafeCorrelationId('has"quote'), isFalse);
      expect(isSafeCorrelationId('has\nnewline'), isFalse);
      expect(isSafeCorrelationId('has\u0000null'), isFalse);
      expect(isSafeCorrelationId('has/tab\t'), isFalse);
    });
  });

  group('generateTraceId', () {
    test('is a UUIDv7', () {
      expect(isUuidV7(generateTraceId()), isTrue);
    });

    test('is deterministic for an injected time and entropy', () {
      final DateTime time = DateTime.utc(2026, 6, 1, 9, 30);
      final String first = generateTraceId(time: time, random: Random(42));
      final String second = generateTraceId(time: time, random: Random(42));
      expect(first, second);
      expect(isUuidV7(first), isTrue);
    });
  });

  group('resolveTraceId', () {
    test('echoes an acceptable inbound trace id unchanged', () {
      expect(resolveTraceId('trace-from-device'), 'trace-from-device');
    });

    test('replaces an unacceptable inbound value with a fresh UUIDv7', () {
      final String resolved = resolveTraceId('bad value with spaces and "quotes"');
      expect(resolved, isNot(contains('bad value')));
      expect(isUuidV7(resolved), isTrue);
    });

    test('replaces a non-string inbound value', () {
      expect(isUuidV7(resolveTraceId(null)), isTrue);
      expect(isUuidV7(resolveTraceId(42)), isTrue);
    });

    test('replacement is deterministic under injected time and entropy', () {
      final DateTime time = DateTime.utc(2026, 6, 1, 9, 30);
      expect(
        resolveTraceId(null, time: time, random: Random(7)),
        generateTraceId(time: time, random: Random(7)),
      );
    });
  });

  group('SyncCorrelation', () {
    test('carries every present and safe id', () {
      const SyncCorrelation correlation = SyncCorrelation(
        mutationId: 'm1',
        deviceId: 'd1',
        syncBatchId: 'b1',
        traceId: 't1',
      );
      expect(correlation.toLogFields(), <String, Object?>{
        'mutationId': 'm1',
        'deviceId': 'd1',
        'syncBatchId': 'b1',
        'traceId': 't1',
      });
    });

    test('omits an absent id', () {
      const SyncCorrelation correlation = SyncCorrelation(deviceId: 'd1', traceId: 't1');
      expect(correlation.toLogFields(), <String, Object?>{'deviceId': 'd1', 'traceId': 't1'});
    });

    test('omits an unsafe id rather than logging it', () {
      const SyncCorrelation correlation = SyncCorrelation(
        deviceId: 'has space',
        traceId: 't1',
      );
      expect(correlation.toLogFields(), <String, Object?>{'traceId': 't1'});
    });

    test('withMutation narrows to one mutation without losing the rest', () {
      const SyncCorrelation correlation = SyncCorrelation(
        deviceId: 'd1',
        syncBatchId: 'b1',
        traceId: 't1',
      );
      final SyncCorrelation narrowed = correlation.withMutation('m1');
      expect(narrowed.toLogFields(), <String, Object?>{
        'mutationId': 'm1',
        'deviceId': 'd1',
        'syncBatchId': 'b1',
        'traceId': 't1',
      });
    });

    test('isEmpty is true only when every id is absent', () {
      expect(const SyncCorrelation().isEmpty, isTrue);
      expect(const SyncCorrelation(traceId: 't').isEmpty, isFalse);
    });
  });
}
