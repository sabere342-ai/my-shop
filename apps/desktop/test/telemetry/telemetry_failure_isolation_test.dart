import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/telemetry/json_sinks.dart';
import 'package:my_shop_desktop/core/telemetry/metrics.dart';
import 'package:my_shop_desktop/core/telemetry/structured_log.dart';

import 'telemetry_test_harness.dart';

// Master Plan §38.28 / §13.7. Telemetry is passive evidence: no stage of the
// telemetry path — the clock read, validation, record/metric construction,
// serialisation, or the sink write — may turn a committed sale or a completed
// pass into a failure. This suite drives a failure at each stage in turn and
// asserts the call returns normally (the end-to-end offline regression that a
// throwing clock does not change a pass lives in `sync_observability_test.dart`).

void main() {
  group('TelemetryLogger isolates every stage', () {
    test('a throwing clock does not escape and writes no record', () {
      final RecordingTelemetrySink sink = RecordingTelemetrySink();
      final TelemetryLogger logger = TelemetryLogger(
        sink: sink,
        clock: () => throw StateError('$secretCanary clock'),
      );

      expect(
        () => logger.log(
          SyncLogEvents.pushPass,
          fields: <String, Object?>{LoggableKeys.deviceId: 'd1'},
        ),
        returnsNormally,
      );
      expect(sink.records, isEmpty);
    });

    test('a throwing clock together with a throwing sink does not escape', () {
      final TelemetryLogger logger = TelemetryLogger(
        sink: RecordingTelemetrySink(failOnWrite: true),
        clock: () => throw StateError('clock failed'),
      );

      expect(
        () => logger.log(
          SyncLogEvents.pushPass,
          fields: <String, Object?>{LoggableKeys.deviceId: 'd1'},
        ),
        returnsNormally,
      );
    });

    test('a throwing serialiser does not escape', () {
      final TelemetryLogger logger = TelemetryLogger(
        sink: JsonLineTelemetrySink(
          writeLine: (String line) => throw StateError('serialise failed'),
        ),
      );

      expect(
        () => logger.log(
          SyncLogEvents.pushPass,
          fields: <String, Object?>{LoggableKeys.deviceId: 'd1'},
        ),
        returnsNormally,
      );
    });
  });

  group('TelemetryMetrics isolates every stage', () {
    test('a throwing sink does not escape', () {
      final TelemetryMetrics metrics = TelemetryMetrics(
        sink: RecordingMetricsSink(failOnWrite: true),
      );

      expect(() => metrics.gauge(SyncMetricNames.outboxDepth, 1), returnsNormally);
    });

    test('a throwing serialiser does not escape', () {
      final TelemetryMetrics metrics = TelemetryMetrics(
        sink: JsonLineMetricsSink(
          writeLine: (String line) => throw StateError('serialise failed'),
        ),
      );

      expect(() => metrics.observe(SyncMetricNames.ackLatencyMs, 1), returnsNormally);
    });
  });
}
