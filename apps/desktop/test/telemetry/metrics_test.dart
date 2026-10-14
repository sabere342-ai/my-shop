import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/telemetry/metrics.dart';

import 'telemetry_test_harness.dart';

void main() {
  group('validateMetricLabels', () {
    test('copies only allow-listed label keys', () {
      final Map<String, Object?> labels = validateMetricLabels(<String, Object?>{
        MetricLabels.state: 'RETRYABLE_ERROR',
        MetricLabels.errorClass: 'StateError',
        MetricLabels.outcome: 'APPLIED',
      });
      expect(labels, <String, Object?>{
        MetricLabels.errorClass: 'StateError',
        MetricLabels.outcome: 'APPLIED',
        MetricLabels.state: 'RETRYABLE_ERROR',
      });
    });

    test('rejects every identity-shaped key, even when passed', () {
      // §38.28.2: a label is a bounded class. An identity in a label is how a
      // metrics backend's cardinality — and its cost — explodes.
      final Map<String, Object?> labels = validateMetricLabels(<String, Object?>{
        'mutationId': '018f2a4b-7c3d-7e5f-8a9b-0c1d2e3f4a5b',
        'deviceId': 'device-1',
        'traceId': 'trace-1',
        'syncBatchId': 'batch-1',
        'customerId': 'customer-1',
        MetricLabels.state: 'PENDING',
      });
      expect(labels, <String, Object?>{MetricLabels.state: 'PENDING'});
    });

    test('rejects an unsafe or empty label value', () {
      expect(validateMetricLabels(<String, Object?>{MetricLabels.state: 'has space'}), isEmpty);
      expect(validateMetricLabels(<String, Object?>{MetricLabels.state: ''}), isEmpty);
      expect(validateMetricLabels(<String, Object?>{MetricLabels.state: 'a\nb'}), isEmpty);
      expect(
        validateMetricLabels(<String, Object?>{
          MetricLabels.state: 'a' * (maxMetricLabelLength + 1),
        }),
        isEmpty,
      );
      expect(validateMetricLabels(<String, Object?>{MetricLabels.state: 7}), isEmpty);
    });
  });

  group('TelemetryMetrics', () {
    test('records a gauge, a counter, and a histogram observation', () {
      final ({TelemetryMetrics metrics, RecordingMetricsSink sink}) harness = recordingMetrics();
      harness.metrics.gauge(SyncMetricNames.outboxDepth, 3, labels: <String, Object?>{
        MetricLabels.state: 'PENDING',
      });
      harness.metrics.counter(SyncMetricNames.permanentRejections, 1);
      harness.metrics.observe(SyncMetricNames.ackLatencyMs, 12.5);

      expect(harness.sink.single(SyncMetricNames.outboxDepth).kind, MetricKind.gauge);
      expect(harness.sink.single(SyncMetricNames.permanentRejections).kind, MetricKind.counter);
      expect(harness.sink.single(SyncMetricNames.ackLatencyMs).kind, MetricKind.histogram);
      expect(harness.sink.single(SyncMetricNames.outboxDepth).labels, <String, Object?>{
        MetricLabels.state: 'PENDING',
      });
    });

    test('drops an empty name, a NaN, and an infinity', () {
      final ({TelemetryMetrics metrics, RecordingMetricsSink sink}) harness = recordingMetrics();
      harness.metrics.gauge('', 1);
      harness.metrics.observe(SyncMetricNames.pushDurationMs, double.nan);
      harness.metrics.observe(SyncMetricNames.pushDurationMs, double.infinity);
      expect(harness.sink.points, isEmpty);
    });

    test('isolates a throwing sink', () {
      final TelemetryMetrics metrics = TelemetryMetrics(
        sink: RecordingMetricsSink(failOnWrite: true),
      );
      expect(() => metrics.gauge(SyncMetricNames.outboxDepth, 1), returnsNormally);
      expect(() => metrics.counter(SyncMetricNames.permanentRejections, 1), returnsNormally);
      expect(() => metrics.observe(SyncMetricNames.ackLatencyMs, 1), returnsNormally);
    });
  });

  group('SyncMetricNames', () {
    test('the emitted and deferred names are distinct', () {
      final List<String> all = <String>[
        SyncMetricNames.outboxDepth,
        SyncMetricNames.pushDurationMs,
        SyncMetricNames.ackLatencyMs,
        SyncMetricNames.pushAttempts,
        SyncMetricNames.permanentRejections,
        SyncMetricNames.conflicts,
        SyncMetricNames.pushSuccessRatio,
        SyncMetricNames.pullDurationMs,
        SyncMetricNames.divergenceEvents,
        SyncMetricNames.costBasisDivergences,
      ];
      expect(all.toSet().length, all.length);
      for (final String name in all) {
        expect(name, matches(r'^sync\.[a-z0-9_]+(\.[a-z0-9_]+)*$'));
      }
    });
  });
}
