/// The client's transport (Master Plan section 7.3, section 34.1, ADR-001).
///
/// One HTTP door for every REST call the client makes: base URL resolution
/// under the versioned `/api/v1` namespace, a per-request §38.28.1 `trace_id`
/// header (the same `x-trace-id` the server's request logger honours), optional
/// `Bearer` injection from the session's access token, and one problem-document
/// failure mapping (§34.3).
///
/// Honest failure semantics (§38.11 applies to every client-server exchange):
///
/// - A 2xx answer resolves to [ApiSuccess]; the caller reads its body.
/// - A non-2xx answer throws [ApiFailure] with the server's own code (§7.3:
///   the server is the only authority; the client never invents a verdict).
/// - No answer at all (timeout, DNS, refused connection) throws
///   [ApiFailure.transport] - "the attempt was withheld", never "the server
///   refused" and never "the server succeeded".
///
/// This layer holds no tokens itself: the access token arrives through
/// [TokenHeaderSource] each call, and its only storage is the platform
/// keystore (§13.6, the slice's governing acceptance).
library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:my_shop_desktop/core/api/api_failure.dart';
import 'package:my_shop_desktop/core/telemetry/correlation.dart';

/// The header name the §38.28.1 `trace_id` travels under (§38.10.1 push
/// contract uses the same name).
const String traceHeaderName = 'x-trace-id';

/// Supplies the current access token for a call, or `null` for an anonymous
/// one. The session store owns the value; this layer never caches it.
typedef TokenHeaderSource = String? Function();

/// Burns a fresh §38.28.1 `trace_id`; injectable so tests can assert
/// correlation.
typedef TimeTrace = String Function();

/// The session's own handle on the transport's `Bearer` source.
///
/// The client holds at most one working session; the source is mutable
/// because the *session controller* is what changes it (on sign-in,
/// restore, refresh, sign-out) — and the token's only durable home remains
/// the platform keystore (§13.6). The transport itself never stores tokens.
final class MutableTokenSource {
  String? _accessToken;

  /// Reads the current access token, or `null` when none is held.
  String? read() => _accessToken;

  /// Publishes the working token for unauthenticated→authenticated calls,
  /// or clears it. Callers pass the keystore-persisted value's in-memory
  /// copy; nothing here survives across a process restart except through
  /// the keystore.
  void update(String? accessToken) {
    _accessToken = accessToken;
  }
}

/// The transport's fixed settings. A value object so composition can build
/// one from configuration and tests can build one from a fake URI.
class ApiClientConfig {
  const ApiClientConfig({
    required this.baseUrl,
    this.timeout = const Duration(seconds: 20),
  });

  /// The server origin, e.g. `https://shop.example.com`. Paths attach the
  /// versioned namespace themselves (§34.1).
  final Uri baseUrl;

  /// The per-call budget. A call that exceeds it is a withheld attempt
  /// (§38.11): the server's eventual answer, if any, must not be assumed.
  final Duration timeout;
}

/// A 2xx outcome: the HTTP status and the decoded JSON body (or raw text when
/// the body is not JSON).
class ApiSuccess {
  const ApiSuccess({required this.status, this.json, this.body});

  final int status;
  final Map<String, Object?>? json;
  final String? body;
}

/// The one HTTP door.
class ApiClient {
  ApiClient(this._config, {http.Client? client, TimeTrace? newTraceId})
    : _client = client ?? http.Client(),
      _newTraceId = newTraceId ?? generateTraceId;

  final ApiClientConfig _config;
  final http.Client _client;
  final TimeTrace _newTraceId;

  /// The mutable bearer source the session controller publishes to.
  final MutableTokenSource tokenSource = MutableTokenSource();

  /// Sends one request (§34.1). Throws [ApiFailure] exactly as the library
  /// doc states.
  Future<ApiSuccess> send({
    required String method,
    required String path,
    Map<String, String> headers = const <String, String>{},
    Object? body,
  }) async {
    final Uri uri = _config.baseUrl.replace(path: path);
    final Map<String, String> requestHeaders = <String, String>{
      traceHeaderName: _newTraceId(),
      ...headers,
    };

    final String? accessToken = tokenSource.read();
    if (accessToken != null) {
      requestHeaders['Authorization'] = 'Bearer $accessToken';
    }

    final String? requestBody = body != null ? jsonEncode(body) : null;
    if (requestBody != null) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    final http.Response response;
    try {
      final http.Request request = http.Request(method, uri)
        ..headers.addAll(requestHeaders);
      if (requestBody != null) {
        request.body = requestBody;
      }
      final Future<http.Response> future = _client
          .send(request)
          .then(http.Response.fromStream);
      response = await future.timeout(_config.timeout);
    } on TimeoutException catch (error) {
      throw ApiFailure.transport(error.message ?? 'the request timed out');
    } on http.ClientException catch (error) {
      throw ApiFailure.transport(error.message);
    } on Exception catch (error) {
      // http also surfaces socket faults as plain SocketException-driven
      // ClientExceptions in wrapper transports; classify anything unknown as
      // a withheld attempt, never as a server decision.
      throw ApiFailure.transport(error.toString());
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final Object? decoded = _decodeBody(response.body);
      throw ApiProblemDecoder().decodeNonSuccess(response.statusCode, decoded);
    }
    return ApiSuccess(
      status: response.statusCode,
      json: _decodeBody(response.body),
      body: response.body,
    );
  }

  Map<String, Object?>? _decodeBody(String body) {
    if (body.isEmpty) return null;
    try {
      final Object? parsed = jsonDecode(body);
      if (parsed is Map) return Map<String, Object?>.from(parsed);
      return null;
    } on FormatException {
      return null;
    }
  }

  /// Closes the underlying client. Idempotent: package:http's client no-ops
  /// after its first close.
  void dispose() => _client.close();
}
