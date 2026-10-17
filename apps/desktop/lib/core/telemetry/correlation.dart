/// Offline observability correlation — Master Plan §38.28.1, §38.28.3.
///
/// Every sync-relevant record carries the identifiers §38.28.1 names, so a
/// mutation, its device, its batch, and its trace can be followed from the
/// counter PC to the server log without ever logging the payload itself:
///
/// * `mutation_id`   — one business mutation.
/// * `device_id`     — the producing installation.
/// * `sync_batch_id` — one push request.
/// * `trace_id`      — one request, end to end, client and server.
///
/// An id is validated *before* it is logged. A trace id may arrive from a
/// header (the same `x-trace-id` the server honours), so an inbound value is
/// length- and character-filtered exactly as the server filters it: an
/// unvalidated header echoed into a log line is a log-injection and
/// reflected-input vector, and a correlation id must never become a channel for
/// a credential or a payload fragment.
library;

import 'dart:math';

import 'package:my_shop_desktop/core/offline/outbox/uuid_v7.dart';

/// Maximum accepted length of a correlation id (mirrors the server's
/// `MAX_INBOUND_LENGTH`; §38.28.3).
const int maxCorrelationIdLength = 64;

/// Characters a safe correlation id may contain: no whitespace, no control
/// characters, no quotes — safe in a JSON line and in a header echo.
final RegExp _safeCorrelationId = RegExp(r'^[A-Za-z0-9._:-]{1,64}$');

/// True when [value] is a correlation id safe to log or echo.
///
/// A non-string, an over-long value, or a value containing anything outside the
/// safe set is refused so the caller can drop it or replace it.
bool isSafeCorrelationId(Object? value) {
  return value is String &&
      value.length <= maxCorrelationIdLength &&
      _safeCorrelationId.hasMatch(value);
}

/// Generates a fresh §38.28.1 `trace_id`.
///
/// A UUIDv7, so it is time-ordered and collision-resistant like a mutation id;
/// [time] and [random] are injectable for deterministic tests. The same
/// generator produces `mutation_id` (§38.8.1), so an unvalidated id is never
/// invented by a second, weaker source.
String generateTraceId({DateTime? time, Random? random}) {
  return generateUuidV7(time: time, random: random);
}

/// Returns [inbound] when it is a safe trace id, otherwise a fresh one.
///
/// A malformed inbound value is *replaced*, never rejected: a logging header is
/// not a way to fail a request, and a value that cannot be logged safely must
/// not be logged at all.
String resolveTraceId(Object? inbound, {DateTime? time, Random? random}) {
  if (isSafeCorrelationId(inbound)) return inbound as String;
  return generateTraceId(time: time, random: random);
}

/// The §38.28.1 correlation identifiers of one sync unit, as one value.
///
/// Immutable and optional-fielded: a push pass carries `deviceId`,
/// `syncBatchId`, and `traceId`, while a per-mutation diagnostic adds
/// `mutationId`. [toLogFields] returns only the ids that are present *and*
/// safe, so an unacceptable value is omitted rather than logged.
class SyncCorrelation {
  const SyncCorrelation({
    this.mutationId,
    this.deviceId,
    this.syncBatchId,
    this.traceId,
  });

  /// §38.28.1 `mutation_id`, when the unit is one mutation.
  final String? mutationId;

  /// §38.28.1 `device_id`.
  final String? deviceId;

  /// §38.28.1 `sync_batch_id`.
  final String? syncBatchId;

  /// §38.28.1 `trace_id`.
  final String? traceId;

  /// A copy with [mutationId] set — a pass-level correlation narrowed to one
  /// mutation without losing the rest.
  SyncCorrelation withMutation(String mutationId) {
    return SyncCorrelation(
      mutationId: mutationId,
      deviceId: deviceId,
      syncBatchId: syncBatchId,
      traceId: traceId,
    );
  }

  /// The correlation ids that are present and safe to log, keyed by §38.28.3's
  /// field names. Unsafe or absent ids are omitted.
  Map<String, Object?> toLogFields() {
    return <String, Object?>{
      if (isSafeCorrelationId(mutationId)) 'mutationId': mutationId,
      if (isSafeCorrelationId(deviceId)) 'deviceId': deviceId,
      if (isSafeCorrelationId(syncBatchId)) 'syncBatchId': syncBatchId,
      if (isSafeCorrelationId(traceId)) 'traceId': traceId,
    };
  }

  /// True when no id is present.
  bool get isEmpty =>
      mutationId == null &&
      deviceId == null &&
      syncBatchId == null &&
      traceId == null;

  @override
  String toString() =>
      'SyncCorrelation(mutation: $mutationId, device: $deviceId, '
      'batch: $syncBatchId, trace: $traceId)';
}
