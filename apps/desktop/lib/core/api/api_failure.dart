/// The client's failure taxonomy for HTTP calls (Master Plan section 34.3,
/// section 7.3, ADR-028).
///
/// The server's error contract is an RFC 7807 problem document whose
/// load-bearing field is the stable machine-readable `code`. The client
/// therefore has exactly one mapping surface: [ApiFailure], carrying the
/// closed server code the caller is entitled to branch on, and
/// [ApiProblemDecoder] turning whatever bytes come back into that value or
/// into [ApiFailure.transport]/[ApiFailure.unparseable] when no problem shape
/// is present.
///
/// Two rules this file enforces:
///
/// - **A refused call is never swallowed.** Every non-2xx answer produces a
///   failure with the server's code - or, when the answer is not a problem
///   document, the honest `unknownResponse` code with its HTTP status. A
///   client that hides a 500 behind a generic success message is a defect
///   (section 7.3: the server is the only authority).
/// - **Nothing internal leaks.** The failure carries the server's own
///   `traceId` - the one internal detail section 13.1 permits - and never a
///   stack, SQL, or raw body excerpt.
library;

import 'dart:convert';

/// The server's stable, machine-readable problem codes (section 34.3).
///
/// Values are API surface, mirrored from the backend's `problem.ts` vocabulary:
/// the client branches on them, so this list must change only when the server
/// contract changes.
enum ApiErrorCode {
  validationFailed,
  malformedJson,
  unsupportedMediaType,
  unauthenticated,
  tokenExpired,
  tokenStale,
  permissionDenied,
  notFound,
  organizationForbidden,
  insufficientStock,
  priceOverrideForbidden,
  discountForbidden,
  discountLimitExceeded,
  discountApprovalRequired,
  replay,
  mutationContradiction,
  inventoryConflict,
  offlineGraceExpired,
  deviceRevoked,
  clientTooOld,
  unsupportedMutation,
  rateLimited,
  internalError,
  serviceUnavailable,

  /// Responses this client could not classify as a server decision: either a
  /// problem document was absent (an unparseable body) or, in the one
  /// [ApiFailure.unmapped] case, its `code` was outside the mapped vocabulary.
  unknownResponse,
}

/// Parses a server code string into [ApiErrorCode]; `null` for an unknown
/// code, which the decoder maps to [ApiErrorCode.internalError] so an
/// unmapped future code still reads as a server fault, not a success.
ApiErrorCode? apiErrorCodeFromWire(String? code) => switch (code) {
  'VALIDATION_FAILED' => ApiErrorCode.validationFailed,
  'MALFORMED_JSON' => ApiErrorCode.malformedJson,
  'UNSUPPORTED_MEDIA_TYPE' => ApiErrorCode.unsupportedMediaType,
  'UNAUTHENTICATED' => ApiErrorCode.unauthenticated,
  'TOKEN_EXPIRED' => ApiErrorCode.tokenExpired,
  'TOKEN_STALE' => ApiErrorCode.tokenStale,
  'PERMISSION_DENIED' => ApiErrorCode.permissionDenied,
  'NOT_FOUND' => ApiErrorCode.notFound,
  'ORGANIZATION_FORBIDDEN' => ApiErrorCode.organizationForbidden,
  'INSUFFICIENT_STOCK' => ApiErrorCode.insufficientStock,
  'PRICE_OVERRIDE_FORBIDDEN' => ApiErrorCode.priceOverrideForbidden,
  'DISCOUNT_FORBIDDEN' => ApiErrorCode.discountForbidden,
  'DISCOUNT_LIMIT_EXCEEDED' => ApiErrorCode.discountLimitExceeded,
  'DISCOUNT_APPROVAL_REQUIRED' => ApiErrorCode.discountApprovalRequired,
  'REPLAY' => ApiErrorCode.replay,
  'MUTATION_CONTRADICTION' => ApiErrorCode.mutationContradiction,
  'INVENTORY_CONFLICT' => ApiErrorCode.inventoryConflict,
  'OFFLINE_GRACE_EXPIRED' => ApiErrorCode.offlineGraceExpired,
  'DEVICE_REVOKED' => ApiErrorCode.deviceRevoked,
  'CLIENT_TOO_OLD' => ApiErrorCode.clientTooOld,
  'UNSUPPORTED_MUTATION' => ApiErrorCode.unsupportedMutation,
  'RATE_LIMITED' => ApiErrorCode.rateLimited,
  'INTERNAL_ERROR' => ApiErrorCode.internalError,
  'SERVICE_UNAVAILABLE' => ApiErrorCode.serviceUnavailable,
  _ => null,
};

/// What went wrong, as one closed value (Master Plan section 5.4: no untyped
/// exception ever leaves a client-internal boundary as a business fact).
class ApiFailure implements Exception {
  const ApiFailure.failure(
    this.code, {
    this.httpStatus,
    this.traceId,
    this.detail,
  });

  /// The network did not answer as HTTP at all (timeout, DNS, refused
  /// connection). Nothing is known about the server's decision: a caller must
  /// treat this as "attempt withheld", never as "server refused" and never as
  /// "server succeeded" (section 38.11 honesty for the push path).
  const ApiFailure.transport(this.detail)
    : code = ApiErrorCode.serviceUnavailable,
      httpStatus = null,
      traceId = null;

  /// A response arrived but carries no problem document the decoder trusts.
  /// The HTTP status is known; the server's decision code is not.
  const ApiFailure.unknownResponse({
    required this.httpStatus,
    required this.traceId,
  }) : code = ApiErrorCode.unknownResponse,
       detail = null;

  /// A problem document arrived whose `code` is outside this client's mapped
  /// vocabulary: the server decided, but the client refuses to invent a
  /// meaning for a code it does not know.
  const ApiFailure.unmapped({required this.httpStatus, required this.traceId})
    : code = ApiErrorCode.unknownResponse,
      detail = null;

  final ApiErrorCode code;

  /// The HTTP status, when one was seen.
  final int? httpStatus;

  /// The server's correlation id (section 13.1: the only internal detail a
  /// production error carries).
  final String? traceId;

  /// Transport-level context (timeout/refused connection reason). Never
  /// populated from a problem document: the server's `detail` is the server's
  /// message, and the client's business copy comes from its own catalogs.
  final String? detail;

  @override
  String toString() =>
      'ApiFailure(code: ${code.name}, httpStatus: $httpStatus, traceId: $traceId)';
}

/// Decodes an HTTP response body into an [ApiFailure] (section 34.3).
///
/// Kept deliberately small and synchronous: the server's problem shape is
/// fixed by the contract, and a decoder that guessed more shapes than the
/// contract defines would drift from it.
class ApiProblemDecoder {
  /// Builds the failure for a non-2xx response with the given body bytes.
  ApiFailure decodeNonSuccess(int httpStatus, Object? body) {
    final Object? document = body is Map ? body : _decodeJsonMap(body);
    if (document is! Map) {
      return ApiFailure.unknownResponse(httpStatus: httpStatus, traceId: null);
    }
    final Object? code = document['code'];
    final ApiErrorCode? mapped = apiErrorCodeFromWire(
      code is String ? code : null,
    );
    final Object? traceId = document['traceId'];
    if (mapped != null) {
      return ApiFailure.failure(
        mapped,
        httpStatus: httpStatus,
        traceId: traceId is String ? traceId : null,
      );
    }
    return ApiFailure.unmapped(
      httpStatus: httpStatus,
      traceId: traceId is String ? traceId : null,
    );
  }

  Map<String, Object?>? _decodeJsonMap(Object? body) {
    if (body is! String) return null;
    try {
      final Object? parsed = jsonDecode(body);
      if (parsed is Map) return Map<String, Object?>.from(parsed);
      return null;
    } on FormatException {
      return null;
    }
  }
}
