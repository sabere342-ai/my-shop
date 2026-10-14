import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/telemetry/structured_log.dart';

import 'telemetry_test_harness.dart';

void main() {
  group('loggableScalar', () {
    test('accepts bounded strings, numbers, and booleans', () {
      expect(loggableScalar('ok'), 'ok');
      expect(loggableScalar(7), 7);
      expect(loggableScalar(1.5), 1.5);
      expect(loggableScalar(true), true);
    });

    test('drops a map, a list, a DateTime, a function, and null', () {
      // "Payload logged by reference" is structural: the shape a payload has
      // never survives, so a call site cannot leak one by accident.
      expect(loggableScalar(<String, Object?>{'k': 'v'}), isNull);
      expect(loggableScalar(<Object?>['v']), isNull);
      expect(loggableScalar(DateTime.utc(2026)), isNull);
      expect(loggableScalar(() => 0), isNull);
      expect(loggableScalar(null), isNull);
    });

    test('drops an over-long string', () {
      expect(loggableScalar('a' * maxLogStringLength), isNotNull);
      expect(loggableScalar('a' * (maxLogStringLength + 1)), isNull);
    });

    test('drops a string carrying a control character or a newline', () {
      expect(loggableScalar('line\nbreak'), isNull);
      expect(loggableScalar('bell\u0007'), isNull);
      expect(loggableScalar('del\u007f'), isNull);
    });

    test('drops a non-finite double', () {
      expect(loggableScalar(double.nan), isNull);
      expect(loggableScalar(double.infinity), isNull);
    });
  });

  group('allowlistLogFields', () {
    test('copies only allow-listed keys', () {
      final Map<String, Object?> fields = allowlistLogFields(<String, Object?>{
        LoggableKeys.deviceId: 'd1',
        LoggableKeys.errorClass: 'StateError',
        'payload': <String, Object?>{'saleNo': 'S-1'},
        'password': secretCanary,
        'unknown': 'x',
      });
      expect(fields, <String, Object?>{
        LoggableKeys.deviceId: 'd1',
        LoggableKeys.errorClass: 'StateError',
      });
    });

    test('drops a non-scalar value under an allow-listed key', () {
      final Map<String, Object?> fields = allowlistLogFields(<String, Object?>{
        LoggableKeys.deviceId: <String, Object?>{'nested': 'object'},
        LoggableKeys.traceId: 't1',
      });
      expect(fields, <String, Object?>{LoggableKeys.traceId: 't1'});
    });

    test('drops a null value rather than emitting it', () {
      final Map<String, Object?> fields = allowlistLogFields(<String, Object?>{
        LoggableKeys.deviceId: null,
      });
      expect(fields, isEmpty);
    });

    test('emits fields in the declared order, independent of input order', () {
      final Map<String, Object?> fields = allowlistLogFields(<String, Object?>{
        LoggableKeys.errorClass: 'StateError',
        LoggableKeys.deviceId: 'd1',
        LoggableKeys.traceId: 't1',
      });
      expect(fields.keys.toList(), <String>[
        LoggableKeys.traceId,
        LoggableKeys.deviceId,
        LoggableKeys.errorClass,
      ]);
    });
  });

  group('TelemetryLogger', () {
    test('writes an allow-listed record with the injected clock', () {
      final DateTime now = DateTime.utc(2026, 2, 2, 2, 2);
      final ({TelemetryLogger logger, RecordingTelemetrySink sink}) harness =
          recordingLogger(clock: () => now);

      harness.logger.log(
        SyncLogEvents.pushPass,
        fields: <String, Object?>{
          LoggableKeys.deviceId: 'd1',
          'payload': <String, Object?>{'no': 'way'},
        },
      );

      final TelemetryRecord record = harness.sink.single(SyncLogEvents.pushPass);
      expect(record.timestamp, now);
      expect(record.fields, <String, Object?>{LoggableKeys.deviceId: 'd1'});
    });

    test('isolates a throwing sink', () {
      final TelemetryLogger logger = TelemetryLogger(
        sink: RecordingTelemetrySink(failOnWrite: true),
      );
      expect(() => logger.log(SyncLogEvents.pushPass), returnsNormally);
    });

    test('ignores an empty event name', () {
      final ({TelemetryLogger logger, RecordingTelemetrySink sink}) harness = recordingLogger();
      harness.logger.log('');
      expect(harness.sink.records, isEmpty);
    });
  });

  group('SyncLogEvents', () {
    test('names are stable, dotted tokens', () {
      expect(SyncLogEvents.pushPass, 'sync.push.pass');
      expect(SyncLogEvents.clockTamper, 'sync.security.clock_tamper');
      final List<String> all = <String>[
        SyncLogEvents.pushPass,
        SyncLogEvents.pushBatchFailure,
        SyncLogEvents.pushMutationRejected,
        SyncLogEvents.pushMutationContradiction,
        SyncLogEvents.pushTransportUnexpected,
        SyncLogEvents.schedulerError,
        SyncLogEvents.connectivityProbeUnexpected,
        SyncLogEvents.healthProbeError,
        SyncLogEvents.clockTamper,
      ];
      expect(all.toSet().length, all.length);
      for (final String event in all) {
        expect(event, matches(r'^[a-z][a-z0-9]*(\.[a-z0-9_]+)+$'));
      }
    });
  });
}
