/// The push boundary (Master Plan §40.5, M1b-S5; §38.10).
///
/// This file is the client half of `POST /api/v1/sync/push` and nothing more:
/// the §38.10.1 wire vocabulary (the batch request, the per-mutation outcome,
/// and the four-state acknowledgement) plus the transport *port* through which
/// a concrete authenticated socket is injected later. There is deliberately no
/// `dart:io` here — the concrete transport needs the §38.16 access token and the
/// connectivity state that the identity and connectivity slices own, so S5
/// publishes the shape and the seam those slices plug into, and the
/// orchestration that decides *what* to send and *what the answer means*.
///
/// The status vocabulary is the §38.9.2 acknowledgement set projected onto one
/// field (§38.10.1), mirroring `push.contract.ts` exactly so the generated
/// client types and this port cannot drift apart in meaning:
///
/// * `APPLIED`       — first sight: applied once, server sequence assigned.
/// * `REPLAY`        — the identical mutation was already stored: no second
///                     effect, the original response is returned (F-13).
/// * `REJECTED`      — a permanent business refusal, recorded with its code and
///                     never silently dropped (§38.13, §38.10.4).
/// * `CONTRADICTION` — the same `mutation_id` under a different payload: the
///                     idempotency-bypass alarm (§38.9.2, F-14).
library;

/// One queued mutation as the push body carries it — §38.8.1's thirteen wire
/// fields.
///
/// The four local bookkeeping columns (`sync_state`, `attempt_count`,
/// `last_error_code`, `last_attempt_at`) are absent: they describe the device's
/// queue, not the business event, and §38.10.1's "complete immutable payloads"
/// is a statement about the event. `actorRoleSnapshot` and `payload` are decoded
/// JSON objects, not the encoded strings the outbox stores.
class PushMutationWire {
  const PushMutationWire({
    required this.mutationId,
    required this.organizationId,
    required this.deviceId,
    required this.actorUserId,
    required this.actorRoleSnapshot,
    required this.aggregateType,
    required this.aggregateId,
    required this.operationType,
    required this.payload,
    required this.payloadVersion,
    required this.deviceLocalSequence,
    required this.localCreatedAt,
    required this.deviceIdempotencyKey,
  });

  /// §38.8.1 `mutation_id` — the client-generated UUIDv7 identity.
  final String mutationId;

  /// §38.8.1 `organization_id` — device-bound tenant scope, never user input.
  final String organizationId;

  /// §38.8.1 `device_id` — the producing installation.
  final String deviceId;

  /// §38.8.1 `actor_user_id` — attribution (§23).
  final String actorUserId;

  /// §38.8.1 `actor_role_snapshot` — effective permissions at the time (§38.17).
  final Map<String, Object?> actorRoleSnapshot;

  /// §38.8.1 `aggregate_type` — open vocabulary.
  final String aggregateType;

  /// §38.8.1 `aggregate_id`.
  final String aggregateId;

  /// §38.8.1 `operation_type` — the wire name (`CREATE` …).
  final String operationType;

  /// §38.8.1 `payload` — the complete immutable business event (§38.24).
  final Map<String, Object?> payload;

  /// §38.8.1 `payload_version`.
  final int payloadVersion;

  /// §38.8.1 `device_local_sequence` — the per-device total order (§38.10.2).
  final int deviceLocalSequence;

  /// §38.8.1 `local_created_at`, ISO-8601, as the server's `@IsISO8601` wants.
  final String localCreatedAt;

  /// §38.8.1 `device_idempotency_key` — `mutation_id` duplicated for offline
  /// derivation of the server idempotency key.
  final String deviceIdempotencyKey;

  /// The exact camelCase JSON body the endpoint expects.
  Map<String, Object?> toJson() => <String, Object?>{
        'mutationId': mutationId,
        'organizationId': organizationId,
        'deviceId': deviceId,
        'actorUserId': actorUserId,
        'actorRoleSnapshot': actorRoleSnapshot,
        'aggregateType': aggregateType,
        'aggregateId': aggregateId,
        'operationType': operationType,
        'payload': payload,
        'payloadVersion': payloadVersion,
        'deviceLocalSequence': deviceLocalSequence,
        'localCreatedAt': localCreatedAt,
        'deviceIdempotencyKey': deviceIdempotencyKey,
      };
}

/// The push request body (§38.10.1): one device's batch of 1–50 mutations,
/// oldest `device_local_sequence` first.
class PushBatchRequest {
  const PushBatchRequest({
    required this.deviceId,
    required this.syncBatchId,
    required this.traceId,
    required this.localSchemaVersion,
    required this.mutations,
  });

  /// The header name the §38.28.1 `trace_id` travels under.
  ///
  /// The same `x-trace-id` the server's request logger and exception filter
  /// honour, so a client pass and the server line that answered it share one
  /// value. It is a header and **not** a body field, so the §38.10.1 wire
  /// contract and its generated OpenAPI document do not change.
  static const String traceHeaderName = 'x-trace-id';

  /// The producing installation, asserted — the server verifies it against the
  /// authenticated device binding and refuses a mismatch (§38.16).
  final String deviceId;

  /// Client-generated batch identity for correlation (§38.28.1).
  final String syncBatchId;

  /// §38.28.1 `trace_id` — one request, end to end, client and server.
  ///
  /// Deliberately absent from [toJson]: correlation metadata is not business
  /// payload, and adding it to the body would be a contract change this slice
  /// must not make. A concrete transport sends it as [traceHeaderName].
  final String traceId;

  /// §38.7.2: the local schema version this client speaks, published on every
  /// push.
  final int localSchemaVersion;

  /// 1–50 mutations, strictly ascending by `deviceLocalSequence` (§38.10.2).
  final List<PushMutationWire> mutations;

  Map<String, Object?> toJson() => <String, Object?>{
        'deviceId': deviceId,
        'syncBatchId': syncBatchId,
        'localSchemaVersion': localSchemaVersion,
        'mutations': <Object?>[for (final mutation in mutations) mutation.toJson()],
      };
}

/// The §38.9.2 per-mutation acknowledgement, as one closed value.
enum PushMutationStatus {
  applied('APPLIED'),
  replay('REPLAY'),
  rejected('REJECTED'),
  contradiction('CONTRADICTION');

  const PushMutationStatus(this.wireName);

  /// The exact contract value on the wire.
  final String wireName;

  /// Parses a wire value, rejecting anything outside `push.contract.ts`'s set.
  static PushMutationStatus fromWire(String value) {
    for (final status in PushMutationStatus.values) {
      if (status.wireName == value) return status;
    }
    throw FormatException('unknown push mutation status: $value');
  }
}

/// One outcome of the batch, in request order (§38.10.1).
///
/// Optional fields are present exactly when the status carries them: `resultRef`
/// / `resultHash` / `serverSequence` for `APPLIED` and `REPLAY`, `rejectionCode`
/// for `REJECTED` and `CONTRADICTION`.
class PushMutationOutcome {
  const PushMutationOutcome({
    required this.mutationId,
    required this.status,
    required this.receivedAt,
    this.resultRef,
    this.resultHash,
    this.serverSequence,
    this.rejectionCode,
  });

  /// The mutation this outcome answers.
  final String mutationId;

  final PushMutationStatus status;

  /// The business object produced (§38.9.1 `result_ref`), when any.
  final String? resultRef;

  /// Hash of the resulting state (§38.9.1 `result_hash`), when any.
  final String? resultHash;

  /// The per-organization acceptance order (§38.11.1), kept as a decimal
  /// string so a 64-bit value survives JSON without floating-point loss.
  final String? serverSequence;

  /// The stable §34.3 refusal code, when the mutation was not applied.
  final String? rejectionCode;

  /// The server receipt clock (§38.9.1 `received_at`).
  final DateTime receivedAt;

  /// Decodes one outcome, refusing a body that is missing a required field.
  factory PushMutationOutcome.fromJson(Map<String, Object?> json) {
    final Object? mutationId = json['mutationId'];
    final Object? status = json['status'];
    final Object? receivedAt = json['receivedAt'];
    if (mutationId is! String || status is! String || receivedAt is! String) {
      throw FormatException('malformed push outcome: $json');
    }
    return PushMutationOutcome(
      mutationId: mutationId,
      status: PushMutationStatus.fromWire(status),
      resultRef: _optionalString(json['resultRef']),
      resultHash: _optionalString(json['resultHash']),
      serverSequence: _optionalString(json['serverSequence']),
      rejectionCode: _optionalString(json['rejectionCode']),
      receivedAt: DateTime.parse(receivedAt),
    );
  }
}

/// The push response body (§38.10.1): one outcome per request mutation, same
/// order, length always equal to the number of mutations sent.
class PushBatchResponse {
  const PushBatchResponse({required this.syncBatchId, required this.outcomes});

  /// Echoes the request `syncBatchId` so a client can reconcile a batch.
  final String syncBatchId;

  final List<PushMutationOutcome> outcomes;

  /// Decodes a response body, refusing a shape the contract does not allow.
  factory PushBatchResponse.fromJson(Map<String, Object?> json) {
    final Object? syncBatchId = json['syncBatchId'];
    final Object? outcomes = json['outcomes'];
    if (syncBatchId is! String || outcomes is! List<Object?>) {
      throw FormatException('malformed push response: $json');
    }
    return PushBatchResponse(
      syncBatchId: syncBatchId,
      outcomes: <PushMutationOutcome>[
        for (final outcome in outcomes)
          if (outcome is Map<Object?, Object?>)
            PushMutationOutcome.fromJson(outcome.cast<String, Object?>())
          else
            throw FormatException('malformed push outcome entry: $outcome'),
      ],
    );
  }
}

/// How a whole-request transport failure should be treated (§38.10.4).
///
/// The classification is the boundary's contract: a concrete transport reads
/// the HTTP status and maps it here, and the orchestrator decides the state
/// transition and the retry schedule from the kind alone.
enum PushFailureKind {
  /// Network error, DNS failure, or timeout — ambiguous. The request may have
  /// applied; idempotency makes the retry safe (§38.10.4).
  network,

  /// `429 Too Many Requests` — honour `Retry-After` (§38.10.4).
  rateLimited,

  /// `5xx` — back off and retry; the mutation may or may not have applied.
  serverError,

  /// `426 CLIENT_TOO_OLD` — below the server's minimum `local_schema_version`:
  /// the device goes read-only with an upgrade prompt (F-15, §38.7.2).
  clientTooOld,

  /// `401`/`403` — authorization failure; the device is flagged and must
  /// re-authenticate (§38.10.4).
  unauthorized,

  /// `404`/`405` — the endpoint is not there: an older server or a wrong base
  /// URL. The client stays functional offline and does not discard the sale
  /// (F-16).
  serverUnsupported,

  /// `400`/`413`/`415`/`422` — the batch itself is refused.
  badRequest,

  /// Any other `4xx` — a permanent whole-request refusal (§38.10.4).
  permanent,
}

/// A whole-request push failure that is *not* a per-mutation outcome.
///
/// A per-mutation business refusal arrives as `200` with a `REJECTED` or
/// `CONTRADICTION` outcome; this type is only for a failure that decides the
/// fate of the whole batch, and it is what lets the orchestrator apply the
/// §38.10.4 retry table without knowing HTTP.
class SyncPushTransportException implements Exception {
  const SyncPushTransportException({
    required this.kind,
    this.statusCode,
    this.retryAfter,
    this.code,
    this.diagnostic = '',
  });

  final PushFailureKind kind;

  /// The HTTP status, when the failure came from a response.
  final int? statusCode;

  /// The parsed `Retry-After` header, when the server supplied one.
  final Duration? retryAfter;

  /// The domain error code from the RFC 7807 body, when present.
  final String? code;

  /// A short non-secret diagnostic. Never carries payload content, a token, or
  /// a credential (§13.7).
  final String diagnostic;

  @override
  String toString() {
    final StringBuffer buffer = StringBuffer('SyncPushTransportException(')
      ..write(kind.name);
    if (statusCode != null) buffer.write(', status $statusCode');
    if (retryAfter != null) buffer.write(', retryAfter=${retryAfter!.inSeconds}s');
    if (code != null) buffer.write(', code $code');
    buffer.write(')');
    if (diagnostic.isNotEmpty) buffer.write(': $diagnostic');
    return buffer.toString();
  }
}

/// The transport port: one batch in, one per-mutation outcome list out, or a
/// [SyncPushTransportException] that the orchestrator maps to the §38.10.4
/// retry table.
///
/// Implementations must resolve, never hang: a timeout is a
/// [PushFailureKind.network] failure, because an ambiguous attempt must be
/// retried and idempotency makes that retry safe (§38.8.2).
abstract interface class SyncPushTransport {
  /// Sends one batch and returns its per-mutation outcomes.
  ///
  /// Throws [SyncPushTransportException] for a whole-request failure.
  Future<PushBatchResponse> push(PushBatchRequest request);
}

String? _optionalString(Object? value) {
  if (value == null) return null;
  if (value is String) return value;
  throw FormatException('expected a string, got: $value');
}
