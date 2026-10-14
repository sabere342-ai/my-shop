import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_probe.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_state.dart';
import 'package:my_shop_desktop/core/offline/connectivity/http_health_probe.dart';

void main() {
  group('isLivenessOkBody', () {
    test('accepts the exact liveness contract', () {
      expect(isLivenessOkBody('{"status":"ok"}'), isTrue);
    });

    test('rejects a different status value', () {
      expect(isLivenessOkBody('{"status":"down"}'), isFalse);
    });

    test('rejects a non-string status', () {
      expect(isLivenessOkBody('{"status":123}'), isFalse);
    });

    test('rejects HTML (a captive portal answer)', () {
      expect(isLivenessOkBody('<html>hello</html>'), isFalse);
    });

    test('rejects an empty body', () {
      expect(isLivenessOkBody(''), isFalse);
    });
  });

  group('classifyProbeError', () {
    test('maps a timeout', () {
      expect(
        classifyProbeError(TimeoutException('slow')),
        ReachabilityFailureKind.timeout,
      );
    });

    test('maps a handshake failure', () {
      expect(
        classifyProbeError(const HandshakeException('bad cert')),
        ReachabilityFailureKind.tls,
      );
    });

    test('maps an unrecognised error to unknown', () {
      expect(classifyProbeError(StateError('x')), ReachabilityFailureKind.unknown);
    });
  });

  group('classifySocketError', () {
    test('maps DNS failures', () {
      expect(
        classifySocketError(
          const SocketException('Failed host lookup: health.example'),
        ),
        ReachabilityFailureKind.dns,
      );
      expect(
        classifySocketError(
          const SocketException('x', osError: OSError('', 11001)),
        ),
        ReachabilityFailureKind.dns,
      );
    });

    test('maps connection refused', () {
      expect(
        classifySocketError(
          const SocketException('Connection refused', osError: OSError('', 10061)),
        ),
        ReachabilityFailureKind.connectionRefused,
      );
    });

    test('maps a network-unreachable error', () {
      expect(
        classifySocketError(
          const SocketException('No route to host', osError: OSError('', 10065)),
        ),
        ReachabilityFailureKind.networkUnreachable,
      );
    });

    test('falls back to network for an unknown socket error', () {
      expect(
        classifySocketError(const SocketException('mystery')),
        ReachabilityFailureKind.network,
      );
    });
  });

  group('classifyHealthResponse', () {
    test('200 with the liveness contract is reachable', () {
      final ProbeResult result = classifyHealthResponse(
        statusCode: 200,
        body: '{"status":"ok"}',
      );
      expect(result.classification, ProbeClassification.reachable);
      expect(result.httpStatus, 200);
    });

    test('200 with the wrong shape is unreachable (captive portal)', () {
      final ProbeResult result = classifyHealthResponse(
        statusCode: 200,
        body: '<html>login</html>',
      );
      expect(result.classification, ProbeClassification.unreachable);
      expect(result.failureKind, ReachabilityFailureKind.unexpectedResponse);
    });

    test('5xx is degraded and carries the status', () {
      final ProbeResult result = classifyHealthResponse(
        statusCode: 503,
        body: 'busy',
      );
      expect(result.classification, ProbeClassification.degraded);
      expect(result.failureKind, ReachabilityFailureKind.serverError);
      expect(result.httpStatus, 503);
    });

    test('4xx is reachable: the server answered', () {
      final ProbeResult result = classifyHealthResponse(
        statusCode: 404,
        body: 'nope',
      );
      expect(result.classification, ProbeClassification.reachable);
      expect(result.httpStatus, 404);
    });

    test('429 is reachable and preserves Retry-After', () {
      final ProbeResult result = classifyHealthResponse(
        statusCode: 429,
        body: 'slow down',
        retryAfter: const Duration(seconds: 20),
      );
      expect(result.classification, ProbeClassification.reachable);
      expect(result.retryAfter, const Duration(seconds: 20));
    });

    test('a redirect is unexpected', () {
      final ProbeResult result = classifyHealthResponse(
        statusCode: 302,
        body: '',
      );
      expect(result.classification, ProbeClassification.unreachable);
      expect(result.failureKind, ReachabilityFailureKind.unexpectedResponse);
    });
  });

  group('HttpHealthProbe against a local server', () {
    late HttpServer server;
    late Uri healthUri;

    Future<void> startServer(
      Future<void> Function(HttpRequest request) handler,
    ) async {
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      healthUri = Uri.parse('http://127.0.0.1:${server.port}/healthz');
      server.listen((HttpRequest request) async {
        await handler(request);
      });
    }

    tearDown(() async {
      await server.close(force: true);
    });

    test('a healthy server is reachable', () async {
      await startServer((HttpRequest request) async {
        request.response
          ..statusCode = 200
          ..headers.contentType = ContentType.json
          ..write('{"status":"ok"}');
        await request.response.close();
      });
      final HttpHealthProbe probe = HttpHealthProbe(healthUri: healthUri);
      final ProbeResult result = await probe.probe();
      expect(result.classification, ProbeClassification.reachable);
      expect(result.httpStatus, 200);
    });

    test('a 503 server is degraded', () async {
      await startServer((HttpRequest request) async {
        request.response
          ..statusCode = 503
          ..write('unavailable');
        await request.response.close();
      });
      final HttpHealthProbe probe = HttpHealthProbe(healthUri: healthUri);
      final ProbeResult result = await probe.probe();
      expect(result.classification, ProbeClassification.degraded);
      expect(result.httpStatus, 503);
    });

    test('a captive portal (HTML 200) is unreachable', () async {
      await startServer((HttpRequest request) async {
        request.response
          ..statusCode = 200
          ..headers.contentType = ContentType.html
          ..write('<html>sign in</html>');
        await request.response.close();
      });
      final HttpHealthProbe probe = HttpHealthProbe(healthUri: healthUri);
      final ProbeResult result = await probe.probe();
      expect(result.classification, ProbeClassification.unreachable);
      expect(result.failureKind, ReachabilityFailureKind.unexpectedResponse);
    });

    test('a 429 with Retry-After carries the directive', () async {
      await startServer((HttpRequest request) async {
        request.response
          ..statusCode = 429
          ..headers.set(HttpHeaders.retryAfterHeader, '42')
          ..write('slow');
        await request.response.close();
      });
      final HttpHealthProbe probe = HttpHealthProbe(healthUri: healthUri);
      final ProbeResult result = await probe.probe();
      expect(result.classification, ProbeClassification.reachable);
      expect(result.retryAfter, const Duration(seconds: 42));
    });

    test('a closed port is unreachable (never hangs)', () async {
      await startServer((HttpRequest request) async {
        request.response.statusCode = 200;
        await request.response.close();
      });
      // Close the server, then probe the now-dead port.
      final int deadPort = server.port;
      await server.close(force: true);
      final HttpHealthProbe probe = HttpHealthProbe(
        healthUri: Uri.parse('http://127.0.0.1:$deadPort/healthz'),
        timeout: const Duration(seconds: 2),
      );
      final ProbeResult result = await probe.probe();
      expect(result.classification, ProbeClassification.unreachable);
      expect(result.failureKind, isNot(ReachabilityFailureKind.serverError));
    });

    test('a slow server is bounded by the timeout', () async {
      await startServer((HttpRequest request) async {
        await Future<void>.delayed(const Duration(seconds: 30));
        request.response.statusCode = 200;
        await request.response.close();
      });
      final HttpHealthProbe probe = HttpHealthProbe(
        healthUri: healthUri,
        timeout: const Duration(milliseconds: 200),
      );
      final ProbeResult result = await probe.probe();
      expect(result.classification, ProbeClassification.unreachable);
      expect(result.failureKind, ReachabilityFailureKind.timeout);
    });
  });
}
