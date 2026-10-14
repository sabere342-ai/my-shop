/// Client sync metrics — Master Plan §38.28.2.
///
/// §38.28.2 names nine metrics. This module emits the ones for which the client
/// is the **authoritative** source — the outbox it owns, the push it performs,
/// and the acknowledgement it observes — and names the rest as typed, unused
/// seams rather than inventing a source of truth:
///
/// * **Emitted here:** pending outbox depth by state (gauge), sync push latency
///   (histogram), mean local-commit-to-acknowledgement latency (histogram, "the
///   single most important operational metric" — cashier-exposure duration),
///   retry attempts by error class (counter), permanent rejections (counter),
///   conflicts (counter), and push success ratio (gauge).
/// * **Deferred, named:** pull latency (the pull protocol is §38.11, not this
///   slice), divergence events per device and cost-basis divergences (§38.27
///   classes the business slices will raise). Their names live in
///   [SyncMetricNames] with no emitter, so the seam is visible rather than
///   silently missing.
///
/// Two properties are structural, mirroring the structured log:
///
/// 1. **Low cardinality only.** [validateMetricLabels] admits only the label
///    keys in [allowedMetricLabelKeys]. A `mutation_id`, `device_id`,
///    `trace_id`, `sync_batch_id`, or customer id is not a label: putting an
///    unbounded identifier in a label is how a metrics backend's cardinality,
///    and its cost, explodes.
/// 2. **Failure isolation.** A throwing sink is swallowed, so a metric can
///    never fail the pass that produced it (telemetry is passive, §38.28).
library;

/// What a [MetricPoint] measures.
enum MetricKind {
  /// A point-in-time value (§38.28.2 "depth", "success rate").
  gauge,

  /// A monotonic count (§38.28.2 "retry attempts", "rejections").
  counter,

  /// One observation in a distribution (§38.28.2 "latency").
  histogram,
}

/// The longest metric label value [validateMetricLabels] will emit.
const int maxMetricLabelLength = 64;

/// A low-cardinality label value: no whitespace, no control characters, no
/// quotes, bounded length.
final RegExp _safeMetricLabel = RegExp(r'^[A-Za-z0-9._:-]{1,64}$');

/// Label names a metric may carry.
///
/// Every key here is a bounded *class*, never an identity. Emitting the state,
/// the error class, or the conflict class is what §38.28.2 asks for; emitting
/// the mutation that failed is what makes a metrics backend unusable.
abstract final class MetricLabels {
  /// A §38.13 sync state name.
  static const String state = 'state';

  /// A bounded error class (never a message).
  static const String errorClass = 'errorClass';

  /// A §34.3 refusal code.
  static const String errorCode = 'errorCode';

  /// A §38.27 conflict class.
  static const String conflictClass = 'conflictClass';

  /// A §38.9.2 outcome name (`APPLIED`, `REPLAY`, `REJECTED`, `CONTRADICTION`).
  static const String outcome = 'outcome';

  /// An operation name (`PUSH`, `PULL`, `PROBE`).
  static const String operation = 'operation';

  /// A reachability failure class.
  static const String failureKind = 'failureKind';
}

/// Every label key [validateMetricLabels] will copy, in a stable order.
const List<String> allowedMetricLabelKeys = <String>[
  MetricLabels.state,
  MetricLabels.errorClass,
  MetricLabels.errorCode,
  MetricLabels.conflictClass,
  MetricLabels.outcome,
  MetricLabels.operation,
  MetricLabels.failureKind,
];

/// The metric names this slice emits, plus the deferred named seams.
abstract final class SyncMetricNames {
  // --- Emitted (§38.28.2) --------------------------------------------------

  /// Pending outbox depth by state (gauge), labelled by `state`.
  static const String outboxDepth = 'sync.outbox.depth';

  /// One push request's wall time (histogram, milliseconds).
  static const String pushDurationMs = 'sync.push.duration_ms';

  /// Local commit → server acknowledgement latency (histogram, milliseconds).
  ///
  /// §38.28.2 calls this the single most important operational metric: it is
  /// the cashier-exposure duration, observed on `APPLIED` only.
  static const String ackLatencyMs = 'sync.ack.latency_ms';

  /// Retry attempts by error class (counter), labelled by `errorClass`.
  static const String pushAttempts = 'sync.push.attempts';

  /// Permanent rejections (counter, §38.10.4).
  static const String permanentRejections = 'sync.push.permanent_rejections';

  /// Conflicts by conflict class (counter), labelled by `conflictClass`.
  static const String conflicts = 'sync.push.conflicts';

  /// Push success ratio for one pass (gauge): acknowledged / attempted.
  static const String pushSuccessRatio = 'sync.push.success_ratio';

  // --- Deferred named seams (§38.28.2, no authoritative client source yet) --

  /// Pull latency (histogram) — owned by the pull protocol (§38.11).
  static const String pullDurationMs = 'sync.pull.duration_ms';

  /// Divergence events per device (counter) — raised by reconciliation (§38.14).
  static const String divergenceEvents = 'sync.divergence_events';

  /// Cost basis divergences (counter) — a §38.27 business class (M10-S6).
  static const String costBasisDivergences = 'sync.cost_basis_divergences';
}

/// Returns only allow-listed, low-cardinality labels from [candidate].
Map<String, Object?> validateMetricLabels(Map<String, Object?> candidate) {
  final Map<String, Object?> safe = <String, Object?>{};
  for (final String key in allowedMetricLabelKeys) {
    if (!candidate.containsKey(key)) continue;
    final Object? value = candidate[key];
    if (value is String && _safeMetricLabel.hasMatch(value)) safe[key] = value;
  }
  return safe;
}

/// One metric observation.
class MetricPoint {
  const MetricPoint({
    required this.name,
    required this.kind,
    required this.value,
    this.labels = const <String, Object?>{},
  });

  /// The metric name (from [SyncMetricNames]).
  final String name;

  final MetricKind kind;

  /// The observed value.
  final num value;

  /// Already-validated low-cardinality labels.
  final Map<String, Object?> labels;

  @override
  String toString() => 'MetricPoint($name, ${kind.name}, $value, $labels)';
}

/// Where a [MetricPoint] goes.
abstract interface class MetricsSink {
  /// Writes one point. A sink may throw; the caller isolates the failure.
  void write(MetricPoint point);
}

/// The client's metrics emitter: validates, then writes, then isolates.
class TelemetryMetrics {
  TelemetryMetrics({required this.sink});

  /// The destination. A production composition root wires a real exporter.
  final MetricsSink sink;

  /// Records a gauge [value].
  void gauge(String name, num value, {Map<String, Object?> labels = const <String, Object?>{}}) {
    _emit(name, MetricKind.gauge, value, labels);
  }

  /// Records a counter increment [value].
  void counter(String name, num value, {Map<String, Object?> labels = const <String, Object?>{}}) {
    _emit(name, MetricKind.counter, value, labels);
  }

  /// Records one histogram observation [value].
  void observe(String name, num value, {Map<String, Object?> labels = const <String, Object?>{}}) {
    _emit(name, MetricKind.histogram, value, labels);
  }

  void _emit(String name, MetricKind kind, num value, Map<String, Object?> labels) {
    if (name.isEmpty) return;
    if (value is double && (value.isNaN || value.isInfinite)) return;
    try {
      sink.write(
        MetricPoint(
          name: name,
          kind: kind,
          value: value,
          labels: validateMetricLabels(labels),
        ),
      );
    } on Object {
      return;
    }
  }
}
