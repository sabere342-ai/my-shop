import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_monitor.dart';
import 'package:my_shop_desktop/core/offline/connectivity/connectivity_probe.dart';
import 'package:my_shop_desktop/core/offline/connectivity/http_health_probe.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_auth_gate.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_service.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';
import 'package:my_shop_desktop/core/offline/sync/push_orchestrator.dart';
import 'package:my_shop_desktop/core/offline/sync/push_transport.dart';
import 'package:my_shop_desktop/core/telemetry/json_sinks.dart';
import 'package:my_shop_desktop/core/telemetry/metrics.dart';
import 'package:my_shop_desktop/core/telemetry/structured_log.dart';

import '../telemetry/telemetry_test_harness.dart';
import '../offline/grace_test_harness.dart';

// Master Plan §38.28.3 / §13.7. The adversarial half of the observability
// suite: every canary is driven through a *real* seam — the orchestrator, the
// connectivity monitor, the HTTP probe, the grace service — and through the
// sinks themselves, to prove the guarantee is structural rather than a
// redaction list that happens to know today's secret.

/// A transport that throws an unclassified error with an adversarial message.
class _ThrowingTransport implements SyncPushTransport {
  _ThrowingTransport(this.error);

  final Object error;

  @override
  Future<PushBatchResponse> push(PushBatchRequest request) async => throw error;
}

/// A probe that throws rather than returning a [ProbeResult].
class _ThrowingProbe implements ConnectivityProbe {
  _ThrowingProbe(this.error);

  final Object error;

  @override
  Future<ProbeResult> probe() async => throw error;
}

void main() {
  group('the allow-list is the boundary', () {
    test('no credential-shaped key is ever allow-listed', () {
      const List<String> forbidden = <String>[
        'password',
        'secret',
        'token',
        'apiKey',
        'accessToken',
        'refreshToken',
        'authorization',
        'cookie',
        'session',
      ];
      for (final String key in forbidden) {
        expect(allowedLogKeys, isNot(contains(key)), reason: '$key must never be loggable');
      }
    });

    test('a payload-shaped value under an allow-listed key is dropped entirely', () {
      // The shape a payload has (a Map or a List) never survives, so a call site
      // cannot leak one by passing it under a key the allow-list trusts.
      final Map<String, Object?> fields = allowlistLogFields(<String, Object?>{
        LoggableKeys.reason: <String, Object?>{'connectionString': connectionCanary},
        LoggableKeys.deviceId: <Object?>[tokenCanary],
        LoggableKeys.traceId: 'safe-trace',
      });
      expect(fields, <String, Object?>{LoggableKeys.traceId: 'safe-trace'});
      expect(fields.toString(), isNot(contains(connectionCanary)));
      expect(fields.toString(), isNot(contains(tokenCanary)));
    });

    test('a scalar under a credential-shaped key is still dropped', () {
      final Map<String, Object?> fields = allowlistLogFields(<String, Object?>{
        'password': secretCanary,
        'accessToken': tokenCanary,
        'connectionString': connectionCanary,
        LoggableKeys.errorClass: 'StateError',
      });
      expect(fields, <String, Object?>{LoggableKeys.errorClass: 'StateError'});
    });

    test('an injected newline cannot forge a log-line boundary', () {
      // A string with a control character is refused rather than escaped.
      expect(loggableScalar('$secretCanary\n$tokenCanary'), isNull);
      final Map<String, Object?> fields = allowlistLogFields(<String, Object?>{
        LoggableKeys.errorClass: '$secretCanary\n$tokenCanary',
      });
      expect(fields, isEmpty);
    });
  });

  group('a caught error is logged by class, never by value', () {
    test('the orchestrator records an unexpected throw by class (transport seam)', () async {
      final db = openMemoryDatabase();
      addTearDown(() async => db.close());
      await seedDeviceBinding(db);
      final OutboxRepository repo = OutboxRepository(db);
      await repo.enqueue(testCommand());
      final RecordingTelemetrySink sink = RecordingTelemetrySink();
      final PushOrchestrator orchestrator = PushOrchestrator(
        outbox: repo,
        transport: _ThrowingTransport(const FormatException('$connectionCanary $tokenCanary')),
        localSchemaVersion: 2,
        logger: TelemetryLogger(sink: sink),
      );

      await orchestrator.runOnce();

      final TelemetryRecord record = sink.single(SyncLogEvents.pushTransportUnexpected);
      expect(record.fields[LoggableKeys.errorClass], 'FormatException');
      expect(sink.serialized(), isNot(contains(connectionCanary)));
      expect(sink.serialized(), isNot(contains(tokenCanary)));
    });

    test('the connectivity monitor records a probe throw by class (monitor seam)', () async {
      final RecordingTelemetrySink sink = RecordingTelemetrySink();
      final ConnectivityMonitor monitor = ConnectivityMonitor(
        probe: _ThrowingProbe(StateError('probe failed: $secretCanary')),
        logger: TelemetryLogger(sink: sink),
      );
      addTearDown(monitor.dispose);

      await monitor.checkNow();

      final TelemetryRecord record = sink.single(SyncLogEvents.connectivityProbeUnexpected);
      expect(record.fields[LoggableKeys.component], 'connectivity_monitor');
      expect(record.fields[LoggableKeys.errorClass], 'StateError');
      expect(sink.serialized(), isNot(contains(secretCanary)));
    });

    test('the HTTP probe records a factory throw by class (probe seam)', () async {
      final RecordingTelemetrySink sink = RecordingTelemetrySink();
      final HttpHealthProbe probe = HttpHealthProbe(
        healthUri: Uri.parse('http://127.0.0.1:1/healthz'),
        clientFactory: () => throw const FormatException(tokenCanary),
        logger: TelemetryLogger(sink: sink),
      );

      final ProbeResult result = await probe.probe();

      expect(result.classification, ProbeClassification.unreachable);
      final TelemetryRecord record = sink.single(SyncLogEvents.healthProbeError);
      expect(record.fields[LoggableKeys.component], 'http_health_probe');
      expect(record.fields[LoggableKeys.errorClass], 'FormatException');
      expect(sink.serialized(), isNot(contains(tokenCanary)));
    });
  });

  group('the grace service records a security event without a value', () {
    test('a forward clock jump is recorded with a component and reason only', () async {
      final db = openMemoryDatabase();
      addTearDown(() async => db.close());
      await seedDeviceBinding(db);
      final TestWallClock wall = TestWallClock(DateTime.utc(2026, 3, 1, 12));
      final TestMonotonicClock monotonic = TestMonotonicClock();
      final RecordingTelemetrySink sink = RecordingTelemetrySink();
      final OfflineGraceService service = OfflineGraceService(
        db,
        verifier: const TestGraceSignatureVerifier(),
        wallClock: wall.now,
        monotonicClock: monotonic.elapsed,
        telemetry: TelemetryLogger(sink: sink),
      );
      await service.establishSession(
        buildGraceRecord(issuedAt: testGraceIssuedAt, expiresAt: testGraceExpiresAt),
      );
      await service.status();

      wall.advance(const Duration(hours: 3)); // monotonic held still: tampered

      await expectLater(
        service.requireMutationAllowed(),
        throwsA(isA<OfflineMutationRefusedException>()),
      );

      final TelemetryRecord record = sink.single(SyncLogEvents.clockTamper);
      expect(record.fields[LoggableKeys.component], 'offline_grace');
      expect(record.fields[LoggableKeys.reason], 'forward_jump');
      // No clock value, no record, no payload.
      expect(record.fields.length, 2);
    });
  });

  group('a JSON line carries only the redacted record', () {
    test('a credential key and a payload cannot survive serialisation', () {
      final List<String> lines = <String>[];
      final TelemetryLogger logger = TelemetryLogger(
        sink: JsonLineTelemetrySink(writeLine: lines.add),
      );
      final TelemetryMetrics metrics = TelemetryMetrics(
        sink: JsonLineMetricsSink(writeLine: lines.add),
      );

      logger.log(
        SyncLogEvents.pushPass,
        fields: <String, Object?>{
          LoggableKeys.deviceId: 'd1',
          'password': secretCanary,
          'payload': <String, Object?>{'connection': connectionCanary},
        },
      );
      metrics.observe(
        SyncMetricNames.ackLatencyMs,
        1,
        labels: <String, Object?>{
          MetricLabels.outcome: 'APPLIED',
          'accessToken': tokenCanary,
        },
      );

      expect(lines.length, 2);
      final String joined = lines.join('\n');
      for (final String canary in <String>[
        secretCanary,
        connectionCanary,
        tokenCanary,
        payloadCanary,
      ]) {
        expect(joined, isNot(contains(canary)));
      }
      // Each line is valid JSON on its own.
      for (final String line in lines) {
        expect(jsonDecode(line), isA<Map<String, Object?>>());
      }
    });
  });

  group('a throwing destination is isolated', () {
    test('logger and metrics swallow a throwing sink', () {
      final TelemetryLogger logger = TelemetryLogger(
        sink: RecordingTelemetrySink(failOnWrite: true),
      );
      final TelemetryMetrics metrics = TelemetryMetrics(
        sink: RecordingMetricsSink(failOnWrite: true),
      );
      expect(
        () => logger.log(
          SyncLogEvents.pushPass,
          fields: <String, Object?>{LoggableKeys.deviceId: 'd1'},
        ),
        returnsNormally,
      );
      expect(() => metrics.gauge(SyncMetricNames.outboxDepth, 1), returnsNormally);
      expect(() => metrics.counter(SyncMetricNames.permanentRejections, 1), returnsNormally);
      expect(() => metrics.observe(SyncMetricNames.ackLatencyMs, 1), returnsNormally);
    });

    test('a JSON sink whose writer throws does not escape the logger', () {
      final TelemetryLogger logger = TelemetryLogger(
        sink: JsonLineTelemetrySink(
          writeLine: (String line) => throw StateError('$secretCanary in the writer'),
        ),
      );
      expect(
        () => logger.log(SyncLogEvents.pushPass, fields: <String, Object?>{LoggableKeys.deviceId: 'd1'}),
        returnsNormally,
      );
    });
  });
}
