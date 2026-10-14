import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';
import 'package:my_shop_desktop/core/offline/sync/backoff_policy.dart';
import 'package:my_shop_desktop/core/offline/sync/push_orchestrator.dart';
import 'package:my_shop_desktop/core/offline/sync/push_transport.dart';

import 'outbox_test_harness.dart';
import 'push_test_harness.dart';

/// Provenance the scheduler needs to persist a server-directed deadline
/// (Master Plan §40.5 C4, §38.10.4): `PushRunResult.serverRetryAfter` and
/// `PushRunResult.httpStatus` must describe the whole-request response, not the
/// jittered ladder value.
void main() {
  late AppDatabase db;
  late OutboxRepository repo;

  setUp(() {
    db = openMemoryDatabase();
    repo = OutboxRepository(db);
  });

  tearDown(() async {
    await db.close();
  });

  PushOrchestrator orchestratorFor(ScriptedPushTransport transport) {
    return PushOrchestrator(
      outbox: repo,
      transport: transport,
      localSchemaVersion: 2,
      batchIdFactory: () => 'batch',
      backoff: const BackoffPolicy(jitterFraction: 0),
    );
  }

  test('a per-mutation outcome pass is an implicit 200 with no directive', () async {
    await seedDeviceBinding(db);
    final OutboxData row = await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      appliedFor(row.mutationId),
    ]);
    final PushRunResult result = await orchestratorFor(transport).runOnce();
    expect(result.fault, isNull);
    expect(result.applied, 1);
    expect(result.httpStatus, 200);
    expect(result.serverRetryAfter, isNull);
  });

  test('429 carries the status and the raw Retry-After provenance', () async {
    await seedDeviceBinding(db);
    await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(
        kind: PushFailureKind.rateLimited,
        statusCode: 429,
        retryAfter: Duration(seconds: 15),
      ),
    ]);
    final PushRunResult result = await orchestratorFor(transport).runOnce();
    expect(result.fault, PushRunFault.transient);
    expect(result.httpStatus, 429);
    expect(result.serverRetryAfter, const Duration(seconds: 15));
    // The effective wait honours the server directive unchanged.
    expect(result.retryAfter, const Duration(seconds: 15));
  });

  test('503 without Retry-After yields a status but no directive', () async {
    await seedDeviceBinding(db);
    await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(
        kind: PushFailureKind.serverError,
        statusCode: 503,
      ),
    ]);
    final PushRunResult result = await orchestratorFor(transport).runOnce();
    expect(result.fault, PushRunFault.transient);
    expect(result.httpStatus, 503);
    expect(result.serverRetryAfter, isNull);
    // The ladder still produced an effective wait.
    expect(result.retryAfter, isNotNull);
  });

  test('a zero Retry-After is not a directive (strictly positive guard)', () async {
    await seedDeviceBinding(db);
    await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(
        kind: PushFailureKind.rateLimited,
        statusCode: 429,
        retryAfter: Duration.zero,
      ),
    ]);
    final PushRunResult result = await orchestratorFor(transport).runOnce();
    expect(result.httpStatus, 429);
    expect(result.serverRetryAfter, isNull);
    expect(result.retryAfter, isNotNull);
  });

  test('a network failure has no HTTP status', () async {
    await seedDeviceBinding(db);
    await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(kind: PushFailureKind.network),
    ]);
    final PushRunResult result = await orchestratorFor(transport).runOnce();
    expect(result.fault, PushRunFault.transient);
    expect(result.httpStatus, isNull);
    expect(result.serverRetryAfter, isNull);
  });

  test('426 CLIENT_TOO_OLD reports the status and requeues', () async {
    await seedDeviceBinding(db);
    await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(
        kind: PushFailureKind.clientTooOld,
        statusCode: 426,
      ),
    ]);
    final PushRunResult result = await orchestratorFor(transport).runOnce();
    expect(result.fault, PushRunFault.clientTooOld);
    expect(result.requeued, 1);
    expect(result.httpStatus, 426);
    expect(result.serverRetryAfter, isNull);
  });

  test('401 reports the status for the auth-attention evidence', () async {
    await seedDeviceBinding(db);
    await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(
        kind: PushFailureKind.unauthorized,
        statusCode: 401,
      ),
    ]);
    final PushRunResult result = await orchestratorFor(transport).runOnce();
    expect(result.fault, PushRunFault.authenticationRequired);
    expect(result.httpStatus, 401);
    expect(result.serverRetryAfter, isNull);
  });

  test('400 reports the status for a permanent batch rejection', () async {
    await seedDeviceBinding(db);
    await repo.enqueue(testCommand());
    final ScriptedPushTransport transport = ScriptedPushTransport(<Object>[
      const SyncPushTransportException(
        kind: PushFailureKind.badRequest,
        statusCode: 400,
      ),
    ]);
    final PushRunResult result = await orchestratorFor(transport).runOnce();
    expect(result.fault, PushRunFault.permanentBatchRejection);
    expect(result.httpStatus, 400);
    expect(result.serverRetryAfter, isNull);
  });
}
