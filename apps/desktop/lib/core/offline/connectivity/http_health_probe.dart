/// HTTP reachability probe hitting `/healthz` — Master Plan §40.5 C1, §37.4.
///
/// Probes the *configured backend* by its liveness contract, not a generic
/// internet endpoint. This matches §37.4: `/healthz` is unauthenticated, outside
/// `/api/v1`, and returns `{ "status": "ok" }` to prove the process is alive.
///
/// Design:
/// * Bounded: [timeout] bounds connect, the HTTP call, and body read.
/// * Resource-safe: a per-probe `HttpClient` is created and closed (force-close
///   on timeout to abort in-flight I/O).
/// * Captive-portal detection: a `2xx` with a non-matching body is classified
///   as `unexpectedResponse` → `unreachable`. Requiring the exact contract guards
///   against a captive portal that returns HTML or a generic 200.
/// * Classification: DNS/timeout/refused/network/TLS map to [ReachabilityFailureKind];
///   `5xx` → `degraded`; `4xx` (including `429`) → `reachable` (server responded);
///   `2xx` wrong shape → `unreachable` (unexpectedResponse); redirects unexpected.
/// * `Retry-After` on `4xx/5xx` is parsed and returned; the monitor honours the
///   larger delay rather than shortening it.
/// * No secrets: the probe does not send tokens and its [ProbeResult] contains
///   no URL, headers, or body (§38.28.3).
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:my_shop_desktop/core/offline/connectivity/connectivity_probe.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_state.dart';
import 'package:my_shop_desktop/core/offline/sync/retry_after.dart';
import 'package:my_shop_desktop/core/telemetry/error_class.dart';
import 'package:my_shop_desktop/core/telemetry/structured_log.dart';

const Duration _defaultTimeout = Duration(seconds: 5);
const Duration _defaultProbeCap = Duration(minutes: 5);
const int _maxBodyBytes = 4096;

/// Pure classification of the liveness response body.
bool isLivenessOkBody(String body) {
  try {
    final Object? decoded = jsonDecode(body);
    if (decoded is! Map<Object?, Object?>) return false;
    final Object? status = decoded['status'];
    if (status is! String) return false;
    return status == 'ok';
  } on FormatException {
    return false;
  }
}

/// Classifies a low-level probe error into a [ReachabilityFailureKind].
ReachabilityFailureKind classifyProbeError(Object error) {
  if (error is TimeoutException) return ReachabilityFailureKind.timeout;
  if (error is HandshakeException) return ReachabilityFailureKind.tls;
  if (error is SocketException) return classifySocketError(error);
  if (error is HttpException) return ReachabilityFailureKind.unexpectedResponse;
  if (error is FormatException) {
    return ReachabilityFailureKind.unexpectedResponse;
  }
  return ReachabilityFailureKind.unknown;
}

/// Maps `SocketException` to a [ReachabilityFailureKind] using OS error codes
/// and message text. The mapping favours the most specific category.
ReachabilityFailureKind classifySocketError(SocketException e) {
  final OSError? os = e.osError;
  final int? code = os?.errorCode;
  final String message = '${e.message} ${os?.message ?? ''}'.toLowerCase();

  // DNS failures vary by platform; include common EAI/error codes.
  if (message.contains('failed host lookup') ||
      message.contains('name or service not known') ||
      message.contains('nodename nor servname') ||
      message.contains('temporary failure in name resolution') ||
      code == -2 || // EAI_NONAME (POSIX)
      code == -3 || // EAI_AGAIN
      code == -5 || // EAI_NODATA
      code == -8 || // EAI_SERVICE
      code == 3 || // ERROR_PATH_NOT_FOUND/UNSPEC (rare)
      code == 8 ||
      code == 11001 || // WSAHOST_NOT_FOUND
      code == 11004) {
    return ReachabilityFailureKind.dns;
  }

  if (code == 10061 || // WSAECONNREFUSED
      code == 111 || // ECONNREFUSED (POSIX)
      message.contains('connection refused') ||
      message.contains('actively refused')) {
    return ReachabilityFailureKind.connectionRefused;
  }

  if (code == 10060 || // WSAETIMEDOUT
      code == 110 || // ETIMEDOUT (POSIX)
      message.contains('timed out') ||
      message.contains('timeout')) {
    return ReachabilityFailureKind.timeout;
  }

  if (code == 10051 || // WSAENETUNREACH
      code == 10065 || // WSAEHOSTUNREACH
      code == 101 || // ENETUNREACH
      code == 113 || // EHOSTUNREACH
      message.contains('unreachable') ||
      message.contains('no route')) {
    return ReachabilityFailureKind.networkUnreachable;
  }

  return ReachabilityFailureKind.network;
}

/// Classifies a health response into a [ProbeResult].
///
/// [retryAfter] is the already-parsed `Retry-After` header value from the
/// response (or `null` when absent/unsatisfiable); the monitor compares it
/// against its own probe ladder and honours the larger delay (§40.5 C4).
ProbeResult classifyHealthResponse({
  required int statusCode,
  required String body,
  Duration? retryAfter,
}) {
  // Redirection — HttpClient may follow; treat unexpected if seen.
  if (statusCode >= 300 && statusCode < 400) {
    return ProbeResult.unreachable(
      failureKind: ReachabilityFailureKind.unexpectedResponse,
      httpStatus: statusCode,
    );
  }

  // 2xx: must match liveness contract
  if (statusCode >= 200 && statusCode < 300) {
    if (isLivenessOkBody(body)) {
      return ProbeResult.reachable(
        httpStatus: statusCode,
        retryAfter: retryAfter,
      );
    }
    return ProbeResult.unreachable(
      failureKind: ReachabilityFailureKind.unexpectedResponse,
      httpStatus: statusCode,
    );
  }

  // 5xx: degraded
  if (statusCode >= 500) {
    return ProbeResult.degraded(httpStatus: statusCode, retryAfter: retryAfter);
  }

  // 4xx: server responded (e.g., 404, 429, 403, 401) — treat as reachable
  if (statusCode >= 400) {
    return ProbeResult.reachable(
      httpStatus: statusCode,
      retryAfter: retryAfter,
    );
  }

  // 1xx: unexpected
  return ProbeResult.unreachable(
    failureKind: ReachabilityFailureKind.unexpectedResponse,
    httpStatus: statusCode,
  );
}

/// HTTP `/healthz` probe using Dart `dart:io`.
class HttpHealthProbe implements ConnectivityProbe {
  HttpHealthProbe({
    required this.healthUri,
    this.timeout = _defaultTimeout,
    this.probeCap = _defaultProbeCap,
    HttpClient Function()? clientFactory,
    this.clock = DateTime.now,
    this.logger,
  }) : _clientFactory = clientFactory ?? HttpClient.new;

  final Uri healthUri;
  final Duration timeout;
  final Duration probeCap;
  final HttpClient Function() _clientFactory;
  final DateTime Function() clock;

  /// Structured, redacted diagnostics (§38.28.3). Passive evidence only.
  final TelemetryLogger? logger;

  @override
  Future<ProbeResult> probe() async {
    // The client is created *inside* the try: a factory that throws is an
    // unexpected probe error, not an escaping exception, so it must map to
    // `unreachable` and be classified like any other. The client is nullable so
    // the `finally` can close a partially-created one without a second throw.
    HttpClient? client;
    try {
      client = _clientFactory();
      return await _run(client).timeout(
        timeout,
        onTimeout: () => const ProbeResult.unreachable(
          failureKind: ReachabilityFailureKind.timeout,
        ),
      );
    } on Object catch (error) {
      logger?.log(
        SyncLogEvents.healthProbeError,
        fields: <String, Object?>{
          LoggableKeys.component: 'http_health_probe',
          LoggableKeys.errorClass: errorClassOf(error),
        },
      );
      return ProbeResult.unreachable(
        failureKind: classifyProbeError(error),
        httpStatus: null,
      );
    } finally {
      client?.close(force: true);
    }
  }

  Future<ProbeResult> _run(HttpClient client) async {
    client.connectionTimeout = timeout;
    client.idleTimeout = timeout;

    final HttpClientRequest request = await client.getUrl(healthUri);
    request.headers.set(HttpHeaders.acceptHeader, 'application/json');
    final HttpClientResponse response = await request.close();
    final String body = await _readBody(response);
    final Duration? retryAfter = _parseRetryAfter(
      response.headers.value(HttpHeaders.retryAfterHeader),
    );
    return classifyHealthResponse(
      statusCode: response.statusCode,
      body: body,
      retryAfter: retryAfter,
    );
  }

  Duration? _parseRetryAfter(String? value) {
    if (value == null) return null;
    return parseRetryAfter(value, now: clock(), cap: probeCap);
  }

  Future<String> _readBody(HttpClientResponse response) async {
    final StringBuffer buffer = StringBuffer();
    int total = 0;
    await for (final List<int> chunk in response) {
      total += chunk.length;
      if (total > _maxBodyBytes) break;
      final String chunkStr = utf8.decode(chunk, allowMalformed: true);
      buffer.write(chunkStr);
      if (buffer.length > _maxBodyBytes) {
        // truncate by string length if decode grew oddly
        final String s = buffer.toString();
        return s.substring(0, _maxBodyBytes);
      }
    }
    return buffer.toString();
  }
}
