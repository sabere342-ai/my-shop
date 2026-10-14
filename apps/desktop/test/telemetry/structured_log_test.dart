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

  group('the per-key value policy', () {
    test('drops an arbitrary string under a closed-vocabulary key', () {
      // The key is not credential-shaped, but the *value* must not become a
      // channel: a secret under `component`/`reason`/`state` is refused.
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.component: secretCanary}), isEmpty);
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.reason: secretCanary}), isEmpty);
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.state: secretCanary}), isEmpty);
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.outcome: secretCanary}), isEmpty);
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.fault: secretCanary}), isEmpty);
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.operation: secretCanary}), isEmpty);
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.failureKind: secretCanary}), isEmpty);
    });

    test('keeps a member of a closed vocabulary', () {
      expect(
        allowlistLogFields(<String, Object?>{LoggableKeys.component: 'sync_scheduler'}),
        <String, Object?>{LoggableKeys.component: 'sync_scheduler'},
      );
      expect(
        allowlistLogFields(<String, Object?>{LoggableKeys.reason: 'forward_jump'}),
        <String, Object?>{LoggableKeys.reason: 'forward_jump'},
      );
      expect(
        allowlistLogFields(<String, Object?>{LoggableKeys.state: 'PENDING'}),
        <String, Object?>{LoggableKeys.state: 'PENDING'},
      );
      expect(
        allowlistLogFields(<String, Object?>{LoggableKeys.outcome: 'APPLIED'}),
        <String, Object?>{LoggableKeys.outcome: 'APPLIED'},
      );
      expect(
        allowlistLogFields(<String, Object?>{LoggableKeys.fault: 'transient'}),
        <String, Object?>{LoggableKeys.fault: 'transient'},
      );
      expect(
        allowlistLogFields(<String, Object?>{LoggableKeys.operation: 'PUSH'}),
        <String, Object?>{LoggableKeys.operation: 'PUSH'},
      );
    });

    test('bounds the two open classification fields', () {
      expect(
        allowlistLogFields(<String, Object?>{LoggableKeys.errorClass: 'StateError'}),
        <String, Object?>{LoggableKeys.errorClass: 'StateError'},
      );
      // A class field is a bounded identifier, never a message or a path.
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.errorClass: 'has space'}), isEmpty);
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.errorClass: 'a' * 65}), isEmpty);
      expect(
        allowlistLogFields(<String, Object?>{LoggableKeys.errorCode: 'MISSING_OUTCOME'}),
        <String, Object?>{LoggableKeys.errorCode: 'MISSING_OUTCOME'},
      );
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.errorCode: 'bad-code'}), isEmpty);
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.errorCode: 'lowercase'}), isEmpty);
    });

    test('requires the right Dart type for a count, a status, and a duration', () {
      expect(
        allowlistLogFields(<String, Object?>{LoggableKeys.statusCode: 200}),
        <String, Object?>{LoggableKeys.statusCode: 200},
      );
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.statusCode: '200'}), isEmpty);
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.statusCode: -1}), isEmpty);
      expect(
        allowlistLogFields(<String, Object?>{LoggableKeys.durationMs: 12.5}),
        <String, Object?>{LoggableKeys.durationMs: 12.5},
      );
      expect(
        allowlistLogFields(<String, Object?>{LoggableKeys.recovered: 3}),
        <String, Object?>{LoggableKeys.recovered: 3},
      );
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.recovered: -1}), isEmpty);
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.recovered: '3'}), isEmpty);
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.recovered: true}), isEmpty);
    });

    test('drops an identifier that is not a safe correlation id', () {
      expect(allowlistLogFields(<String, Object?>{LoggableKeys.deviceId: 'has space'}), isEmpty);
      expect(
        allowlistLogFields(<String, Object?>{LoggableKeys.traceId: 'safe-trace'}),
        <String, Object?>{LoggableKeys.traceId: 'safe-trace'},
      );
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

    test('refuses an event name outside the closed vocabulary', () {
      final ({TelemetryLogger logger, RecordingTelemetrySink sink}) harness = recordingLogger();
      harness.logger.log('sync.evil.event', fields: <String, Object?>{LoggableKeys.deviceId: 'd1'});
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

    test('the closed set is exactly the emitted vocabulary', () {
      expect(SyncLogEvents.all, <String>{
        SyncLogEvents.pushPass,
        SyncLogEvents.pushBatchFailure,
        SyncLogEvents.pushMutationRejected,
        SyncLogEvents.pushMutationContradiction,
        SyncLogEvents.pushTransportUnexpected,
        SyncLogEvents.schedulerError,
        SyncLogEvents.connectivityProbeUnexpected,
        SyncLogEvents.healthProbeError,
        SyncLogEvents.clockTamper,
      });
      for (final String event in SyncLogEvents.all) {
        expect(isKnownLogEvent(event), isTrue);
      }
      expect(isKnownLogEvent('sync.evil.event'), isFalse);
      expect(isKnownLogEvent(''), isFalse);
    });
  });
}
