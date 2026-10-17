import 'package:my_shop_desktop/core/telemetry/json_sinks.dart';
import 'package:my_shop_desktop/core/telemetry/metrics.dart';
import 'package:my_shop_desktop/core/telemetry/structured_log.dart';

// Master Plan §38.28. The fixtures every telemetry suite shares.
//
// The sinks are *recording* rather than *throwing* by default, so a test can
// assert on exactly what reached a destination. [failOnWrite] flips one to a
// throwing sink, which is how the failure-isolation requirement is proved.
export 'package:my_shop_desktop/core/telemetry/structured_log.dart' show TelemetryRecord;

/// A canary that must never appear in a record or a metric.
///
/// The value is one the repository's secret scanner already allow-lists as a
/// fixture, so the canary proves the telemetry path and nothing about the
/// scanner (§37.2 stage 1).
const String secretCanary = 'do-not-log-this';

/// A second, independent canary.
const String secondCanary = 'do-not-log-that';

/// A payload canary — the shape a business event's body has.
const String payloadCanary = 'do not serialise me';

/// A connection-string-shaped canary. Its password segment is the allow-listed
/// fixture `hunter2`, so the source line itself is not a scanner finding.
const String connectionCanary = 'postgresql://app:hunter2@10.0.0.5:5432/my_shop';

/// An access-token-shaped canary.
const String tokenCanary = 'access-token-value-that-must-not-be-logged';

/// A [TelemetrySink] that keeps every record it receives.
class RecordingTelemetrySink implements TelemetrySink {
  RecordingTelemetrySink({this.failOnWrite = false});

  /// When true, [write] throws — the "broken sink" case.
  final bool failOnWrite;

  final List<TelemetryRecord> records = <TelemetryRecord>[];

  /// The events received, in order.
  List<String> get events => <String>[for (final TelemetryRecord r in records) r.event];

  @override
  void write(TelemetryRecord record) {
    if (failOnWrite) throw StateError('sink is broken');
    records.add(record);
  }

  /// One record's event, or a failure naming what was actually received.
  TelemetryRecord single(String event) {
    final List<TelemetryRecord> matches =
        <TelemetryRecord>[for (final TelemetryRecord r in records) if (r.event == event) r];
    if (matches.length != 1) {
      throw StateError('expected exactly one "$event" record, got ${matches.length} of $events');
    }
    return matches.single;
  }

  /// Every record serialised as one string, for a "cannot contain" assertion.
  String serialized() {
    final StringBuffer buffer = StringBuffer();
    for (final TelemetryRecord record in records) {
      buffer
        ..write(record.event)
        ..write(' ')
        ..write(record.fields)
        ..write(' ');
    }
    return buffer.toString();
  }
}

/// A [MetricsSink] that keeps every point it receives.
class RecordingMetricsSink implements MetricsSink {
  RecordingMetricsSink({this.failOnWrite = false});

  final bool failOnWrite;

  final List<MetricPoint> points = <MetricPoint>[];

  @override
  void write(MetricPoint point) {
    if (failOnWrite) throw StateError('sink is broken');
    points.add(point);
  }

  /// Every point with [name], in order.
  List<MetricPoint> named(String name) =>
      <MetricPoint>[for (final MetricPoint p in points) if (p.name == name) p];

  /// The single point with [name], or a failure naming what was received.
  MetricPoint single(String name) {
    final List<MetricPoint> matches = named(name);
    if (matches.length != 1) {
      throw StateError('expected exactly one "$name" point, got ${matches.length}');
    }
    return matches.single;
  }

  /// Every point serialised as one string, for a "cannot contain" assertion.
  String serialized() {
    final StringBuffer buffer = StringBuffer();
    for (final MetricPoint point in points) {
      buffer
        ..write(point.name)
        ..write(' ')
        ..write(point.labels)
        ..write(' ')
        ..write(point.value)
        ..write(' ');
    }
    return buffer.toString();
  }
}

/// A [TelemetryLogger] over a fresh recording sink.
({TelemetryLogger logger, RecordingTelemetrySink sink}) recordingLogger({
  DateTime Function()? clock,
}) {
  final RecordingTelemetrySink sink = RecordingTelemetrySink();
  return (logger: TelemetryLogger(sink: sink, clock: clock), sink: sink);
}

/// A [TelemetryMetrics] over a fresh recording sink.
({TelemetryMetrics metrics, RecordingMetricsSink sink}) recordingMetrics() {
  final RecordingMetricsSink sink = RecordingMetricsSink();
  return (metrics: TelemetryMetrics(sink: sink), sink: sink);
}

/// Writes metrics through a [JsonLineMetricsSink] into a list of lines.
({MetricsSink sink, List<String> lines}) jsonLineMetricsSink() {
  final List<String> lines = <String>[];
  return (sink: JsonLineMetricsSink(writeLine: lines.add), lines: lines);
}

/// Writes records through a [JsonLineTelemetrySink] into a list of lines.
({TelemetrySink sink, List<String> lines}) jsonLineTelemetrySink() {
  final List<String> lines = <String>[];
  return (sink: JsonLineTelemetrySink(writeLine: lines.add), lines: lines);
}
