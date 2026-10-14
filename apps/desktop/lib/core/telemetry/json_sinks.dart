/// Line-oriented JSON sinks for the client telemetry ports — §38.28.3.
///
/// §38.28.3 requires the client's logs to be **structured JSON**, like the
/// server's. A sink is where "structured" becomes literal: one record becomes
/// one JSON object on one line, so an aggregator can parse it without a
/// bespoke format and a human can still read it.
///
/// The sink is the **hard boundary** as well as the serialiser. Redaction first
/// happened when the record was built ([allowlistLogFields] /
/// [validateMetricLabels]), but a [TelemetryRecord] and a [MetricPoint] have
/// public constructors, so a record can also be built by a path that skipped the
/// builder. The sink therefore re-applies the value policy to a record's fields
/// and labels, and refuses an event or metric name that is not in the closed
/// vocabulary — so a hand-built record cannot reach a JSON line with an unsafe
/// value even though the redaction step was bypassed. Re-filtering an
/// already-safe record is idempotent, so the guarantee is not weakened by
/// applying it twice. Its writer is injected ([writeLine]) so a test captures
/// lines without a file and a production composition root chooses the stream.
library;

import 'dart:convert';

import 'package:my_shop_desktop/core/telemetry/metrics.dart';
import 'package:my_shop_desktop/core/telemetry/structured_log.dart';

/// Writes each [TelemetryRecord] as one JSON line, re-validated at the boundary.
class JsonLineTelemetrySink implements TelemetrySink {
  JsonLineTelemetrySink({required this.writeLine});

  /// Receives one complete line (including no trailing newline; the writer
  /// appends whatever its stream needs).
  final void Function(String line) writeLine;

  @override
  void write(TelemetryRecord record) {
    // Defence in depth: a record built outside [TelemetryLogger] is re-filtered
    // (idempotent for one already filtered), and an unknown event is refused.
    if (!isKnownLogEvent(record.event)) return;
    writeLine(
      jsonEncode(<String, Object?>{
        'event': record.event,
        'time': record.timestamp.toUtc().toIso8601String(),
        'fields': allowlistLogFields(record.fields),
      }),
    );
  }
}

/// Writes each [MetricPoint] as one JSON line, re-validated at the boundary.
class JsonLineMetricsSink implements MetricsSink {
  JsonLineMetricsSink({required this.writeLine});

  final void Function(String line) writeLine;

  @override
  void write(MetricPoint point) {
    // Defence in depth, mirroring the log sink: a hand-built point is
    // re-filtered and an unknown metric name is refused.
    if (!isKnownMetricName(point.name)) return;
    if (point.value is double && ((point.value as double).isNaN || (point.value as double).isInfinite)) {
      return;
    }
    writeLine(
      jsonEncode(<String, Object?>{
        'metric': point.name,
        'kind': point.kind.name,
        'value': point.value,
        'labels': validateMetricLabels(point.labels),
      }),
    );
  }
}
