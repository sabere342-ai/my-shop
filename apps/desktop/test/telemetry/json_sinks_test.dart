import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/telemetry/metrics.dart';
import 'package:my_shop_desktop/core/telemetry/structured_log.dart';

import 'telemetry_test_harness.dart';

// Master Plan §38.28.3. The client's logs are structured JSON, like the
// server's — one record, one object, one line. The sink owns serialisation only:
// redaction already happened when the record was built.

void main() {
  group('JsonLineTelemetrySink', () {
    test('writes one redacted record as one JSON line on the injected clock', () {
      final ({TelemetrySink sink, List<String> lines}) harness = jsonLineTelemetrySink();
      final TelemetryLogger logger = TelemetryLogger(
        sink: harness.sink,
        clock: () => DateTime.utc(2026, 5, 1, 10),
      );

      logger.log(
        SyncLogEvents.pushPass,
        fields: <String, Object?>{
          LoggableKeys.deviceId: 'd1',
          LoggableKeys.traceId: 't1',
          'payload': <String, Object?>{'saleNo': payloadCanary},
          'password': secretCanary,
        },
      );

      expect(harness.lines.length, 1);
      final Map<String, Object?> decoded =
          jsonDecode(harness.lines.single) as Map<String, Object?>;
      expect(decoded['event'], SyncLogEvents.pushPass);
      expect(decoded['time'], '2026-05-01T10:00:00.000Z');
      expect(decoded['fields'], <String, Object?>{
        LoggableKeys.deviceId: 'd1',
        LoggableKeys.traceId: 't1',
      });
      expect(harness.lines.single, isNot(contains(payloadCanary)));
      expect(harness.lines.single, isNot(contains(secretCanary)));
    });
  });

  group('JsonLineMetricsSink', () {
    test('writes one point as one JSON line with validated labels', () {
      final ({MetricsSink sink, List<String> lines}) harness = jsonLineMetricsSink();
      final TelemetryMetrics metrics = TelemetryMetrics(sink: harness.sink);

      metrics.observe(
        SyncMetricNames.ackLatencyMs,
        12.5,
        labels: <String, Object?>{
          MetricLabels.outcome: 'APPLIED',
          'mutationId': 'm-1',
        },
      );

      expect(harness.lines.length, 1);
      final Map<String, Object?> decoded =
          jsonDecode(harness.lines.single) as Map<String, Object?>;
      expect(decoded['metric'], SyncMetricNames.ackLatencyMs);
      expect(decoded['kind'], 'histogram');
      expect(decoded['value'], 12.5);
      expect(decoded['labels'], <String, Object?>{MetricLabels.outcome: 'APPLIED'});
    });
  });
}
