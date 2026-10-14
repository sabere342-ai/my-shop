/// Line-oriented JSON sinks for the client telemetry ports — §38.28.3.
///
/// §38.28.3 requires the client's logs to be **structured JSON**, like the
/// server's. A sink is where "structured" becomes literal: one record becomes
/// one JSON object on one line, so an aggregator can parse it without a
/// bespoke format and a human can still read it.
///
/// The sink owns *no* redaction. Redaction happened when the record was built
/// ([allowlistLogFields] / [validateMetricLabels]); a sink that re-filtered
/// would be a second, weaker guarantee. It owns only serialisation, and its
/// writer is injected ([writeLine]) so a test captures lines without a file and
/// a production composition root chooses the stream.
library;

import 'dart:convert';

import 'package:my_shop_desktop/core/telemetry/metrics.dart';
import 'package:my_shop_desktop/core/telemetry/structured_log.dart';

/// Writes each [TelemetryRecord] as one JSON line.
class JsonLineTelemetrySink implements TelemetrySink {
  JsonLineTelemetrySink({required this.writeLine});

  /// Receives one complete line (including no trailing newline; the writer
  /// appends whatever its stream needs).
  final void Function(String line) writeLine;

  @override
  void write(TelemetryRecord record) {
    writeLine(
      jsonEncode(<String, Object?>{
        'event': record.event,
        'time': record.timestamp.toUtc().toIso8601String(),
        'fields': record.fields,
      }),
    );
  }
}

/// Writes each [MetricPoint] as one JSON line.
class JsonLineMetricsSink implements MetricsSink {
  JsonLineMetricsSink({required this.writeLine});

  final void Function(String line) writeLine;

  @override
  void write(MetricPoint point) {
    writeLine(
      jsonEncode(<String, Object?>{
        'metric': point.name,
        'kind': point.kind.name,
        'value': point.value,
        'labels': point.labels,
      }),
    );
  }
}
