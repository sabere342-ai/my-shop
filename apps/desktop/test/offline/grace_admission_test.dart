import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_auth_gate.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_record.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_service.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';
import 'package:my_shop_desktop/core/offline/outbox/sync_state.dart';
import 'package:my_shop_desktop/core/offline/sync/push_orchestrator.dart';
import 'package:my_shop_desktop/core/offline/sync/push_transport.dart';

import 'grace_test_harness.dart';

// Master Plan §38.16.2, §38.16.4, §38.16.5, §38.17, §10.3.1, §40.5 (M1b-S8),
// T-O15, T-O17.
//
// The offline session has two halves and this file pins both:
//
//   * T-O17 — once the window closes, a new local mutation is refused and
//     leaves no business record and no outbox entry.
//   * T-O15 — at expiry the device goes read-only for *mutations* only:
//     "reads continue, and committed sales still sync".

/// A transport that answers every mutation of the batch with one status.
class _ScriptedTransport implements SyncPushTransport {
  _ScriptedTransport(this._status);

  final PushMutationStatus _status;
  int calls = 0;

  @override
  Future<PushBatchResponse> push(PushBatchRequest request) async {
    calls += 1;
    return PushBatchResponse(
      syncBatchId: request.syncBatchId,
      outcomes: <PushMutationOutcome>[
        for (final PushMutationWire mutation in request.mutations)
          PushMutationOutcome(
            mutationId: mutation.mutationId,
            status: _status,
            resultRef: 'r-${mutation.mutationId}',
            serverSequence: '${mutation.deviceLocalSequence}',
            receivedAt: DateTime.utc(2026, 3, 1),
          ),
      ],
    );
  }
}

/// A gate that records how often it is consulted, so a test can prove the
/// read and transition paths never touch it.
class _SpyAuthGate implements OfflineAuthGate {
  int calls = 0;

  @override
  Future<void> requireMutationAllowed() async {
    calls += 1;
  }
}

void main() {
  group('offline grace establishment (§38.16.2, §38.16.3)', () {
    late AppDatabase db;
    late GraceFixture fixture;

    setUp(() async {
      db = openMemoryDatabase();
      await seedDeviceBinding(db);
      fixture = GraceFixture(db);
    });

    tearDown(() async {
      await db.close();
    });

    test('a device that has never authenticated has no session and refuses '
        'mutations', () async {
      final OfflineGraceStatus status = await fixture.service.status();
      expect(status.hasSession, isFalse);
      expect(status.isReadOnlyForMutations, isTrue);
      expect(status.refusalReason, MutationRefusalReason.noSession);
      expect(status.mutationsAllowed, isFalse);
      expect(status.readsAllowed, isTrue, reason: '§38.16.2: reads are not gated');

      await expectLater(
        fixture.service.requireMutationAllowed(),
        throwsA(isA<OfflineMutationRefusedException>().having(
          (OfflineMutationRefusedException e) => e.reason,
          'reason',
          MutationRefusalReason.noSession,
        )),
      );
    });

    test('a signed, bound record establishes a session and permits mutations',
        () async {
      final GraceEstablishment outcome = await fixture.service.establishSession(
        buildGraceRecord(issuedAt: testGraceIssuedAt, expiresAt: testGraceExpiresAt),
      );
      expect(outcome, GraceEstablishment.established);

      final OfflineGraceStatus status = await fixture.service.status();
      expect(status.hasSession, isTrue);
      expect(status.mutationsAllowed, isTrue);
      expect(status.refusalReason, isNull);
      expect(status.permissionsVersion, 7);
      expect(status.permissions, <String>['sales.create', 'sales.void']);
      expect(status.expiresAt!.toUtc(), fixture.wall.now().add(testGraceWindow).toUtc(),
          reason: 'the window starts at establishment, on the device timeline');

      await fixture.service.requireMutationAllowed();
    });

    test('a record signed by another server is refused and stores nothing',
        () async {
      final GraceEstablishment outcome = await fixture.service.establishSession(
        buildGraceRecord(
          issuedAt: testGraceIssuedAt,
          expiresAt: testGraceExpiresAt,
          key: testOtherGraceKey,
        ),
      );
      expect(outcome, GraceEstablishment.signatureInvalid);
      expect((await fixture.service.status()).hasSession, isFalse);
      expect(await outboxRowCount(db), 0);
    });

    test('a record bound to another device is refused and stores nothing',
        () async {
      final GraceEstablishment outcome = await fixture.service.establishSession(
        buildGraceRecord(
          issuedAt: testGraceIssuedAt,
          expiresAt: testGraceExpiresAt,
          deviceId: '99999999-9999-4999-8999-999999999999',
        ),
      );
      expect(outcome, GraceEstablishment.bindingMismatch);
      expect((await fixture.service.status()).hasSession, isFalse);
    });

    test('a record bound to another organization is refused', () async {
      final GraceEstablishment outcome = await fixture.service.establishSession(
        buildGraceRecord(
          issuedAt: testGraceIssuedAt,
          expiresAt: testGraceExpiresAt,
          organizationId: '88888888-8888-4888-8888-888888888888',
        ),
      );
      expect(outcome, GraceEstablishment.bindingMismatch);
    });

    test('tampering with a signed field invalidates the record (§38.16.3)',
        () async {
      final OfflineGraceRecord honest =
          buildGraceRecord(issuedAt: testGraceIssuedAt, expiresAt: testGraceExpiresAt);
      final OfflineGraceRecord forged =
          tamperGraceRecord(honest, permissionsVersion: 999);

      final GraceEstablishment outcome = await fixture.service.establishSession(forged);
      expect(outcome, GraceEstablishment.signatureInvalid,
          reason: 'the signature no longer covers the record');
    });

    test('a local password change clears the session immediately (§38.16.4)',
        () async {
      await fixture.service.establishSession(
        buildGraceRecord(issuedAt: testGraceIssuedAt, expiresAt: testGraceExpiresAt),
      );
      expect((await fixture.service.status()).mutationsAllowed, isTrue);

      await fixture.service.clearSession();

      final OfflineGraceStatus status = await fixture.service.status();
      expect(status.hasSession, isFalse);
      expect(status.refusalReason, MutationRefusalReason.noSession);
    });
  });

  group('window admission (§38.16.2)', () {
    late AppDatabase db;
    late GraceFixture fixture;

    setUp(() async {
      db = openMemoryDatabase();
      await seedDeviceBinding(db);
      fixture = GraceFixture(db);
      await fixture.service.establishSession(
        buildGraceRecord(issuedAt: testGraceIssuedAt, expiresAt: testGraceExpiresAt),
      );
    });

    tearDown(() async {
      await db.close();
    });

    test('mutations are permitted inside the window and refused at expiry',
        () async {
      fixture.advance(const Duration(hours: 7));
      await fixture.service.requireMutationAllowed();

      // At the expiry instant the window is closed: the plan's "at expiry the
      // device goes read-only" is inclusive of the instant itself.
      fixture.advance(const Duration(hours: 1));
      await expectLater(
        fixture.service.requireMutationAllowed(),
        throwsA(isA<OfflineMutationRefusedException>().having(
          (OfflineMutationRefusedException e) => e.reason,
          'reason',
          MutationRefusalReason.graceExpired,
        )),
      );

      final OfflineGraceStatus status = await fixture.service.status();
      expect(status.isReadOnlyForMutations, isTrue);
      expect(status.readsAllowed, isTrue, reason: '§38.16.2: reads continue at expiry');
    });

    test('the reported expiry is establishment plus the server window',
        () async {
      final OfflineGraceStatus status = await fixture.service.status();
      expect(status.expiresAt!.toUtc(), fixture.wall.now().add(testGraceWindow).toUtc());
    });

    test('an expired session is re-opened only by a fresh establishment',
        () async {
      fixture.advance(testGraceWindow + const Duration(minutes: 1));
      expect(
        (await fixture.service.status()).refusalReason,
        MutationRefusalReason.graceExpired,
      );

      await fixture.service.establishSession(
        buildGraceRecord(issuedAt: testGraceIssuedAt, expiresAt: testGraceExpiresAt),
      );

      final OfflineGraceStatus status = await fixture.service.status();
      expect(status.mutationsAllowed, isTrue);
      expect(status.expiresAt!.toUtc(), fixture.wall.now().add(testGraceWindow).toUtc(),
          reason: 'a new session restarts the window at its own establishment');
    });

    test('an entitlement expiry makes the device read-only first (§38.16.5)',
        () async {
      // The organization is on a plan ending one hour after issuance, well
      // inside the eight-hour grace window.
      await fixture.service.establishSession(
        buildGraceRecord(
          issuedAt: testGraceIssuedAt,
          expiresAt: testGraceExpiresAt,
          entitlementExpiresAt: testGraceIssuedAt.add(const Duration(hours: 1)),
        ),
      );

      fixture.advance(const Duration(minutes: 90));
      await expectLater(
        fixture.service.requireMutationAllowed(),
        throwsA(isA<OfflineMutationRefusedException>().having(
          (OfflineMutationRefusedException e) => e.reason,
          'reason',
          MutationRefusalReason.entitlementExpired,
        )),
      );
    });
  });

  group('T-O17 / T-O15: the gate at the outbox boundary (§40.5)', () {
    late AppDatabase db;
    late GraceFixture fixture;
    late OutboxRepository outbox;

    setUp(() async {
      db = openMemoryDatabase();
      await seedDeviceBinding(db);
      fixture = GraceFixture(db);
      outbox = OutboxRepository(db, authGate: fixture.service);
    });

    tearDown(() async {
      await db.close();
    });

    test('T-O17: a refused mutation leaves no outbox row and no audit row',
        () async {
      await expectLater(
        outbox.enqueue(testCommand()),
        throwsA(isA<OfflineMutationRefusedException>()),
      );
      expect(await outboxRowCount(db), 0);
      expect(await auditRowCount(db), 0);
      expect(await hasMetaKey(db, OutboxRepository.sequenceCounterKey), isFalse,
          reason: 'the gate is consulted before the sequence is allocated');
    });

    test('a permitted mutation is written exactly as before', () async {
      await fixture.service.establishSession(
        buildGraceRecord(issuedAt: testGraceIssuedAt, expiresAt: testGraceExpiresAt),
      );
      final OutboxData row = await outbox.enqueue(testCommand());
      expect(row.syncState, SyncState.pending.wireName);
      expect(await outboxRowCount(db), 1);
      expect(await auditRowCount(db), 1);
    });

    test('T-O15: committed sales still sync after the window closes', () async {
      await fixture.service.establishSession(
        buildGraceRecord(issuedAt: testGraceIssuedAt, expiresAt: testGraceExpiresAt),
      );
      final OutboxData committed = await outbox.enqueue(testCommand());

      fixture.advance(testGraceWindow + const Duration(minutes: 1));
      await expectLater(
        outbox.enqueue(testCommand()),
        throwsA(isA<OfflineMutationRefusedException>()),
      );

      // Reads are unaffected: the committed sale is still selectable for push.
      final List<OutboxData> pending = await outbox.pendingForPush();
      expect(pending.map((OutboxData row) => row.mutationId), contains(committed.mutationId));

      final _ScriptedTransport transport = _ScriptedTransport(PushMutationStatus.applied);
      final PushOrchestrator orchestrator = PushOrchestrator(
        outbox: outbox,
        transport: transport,
        localSchemaVersion: 3,
      );
      final PushRunResult result = await orchestrator.runOnce();
      expect(result.applied, 1);
      expect((await outbox.requireById(committed.mutationId)).syncState, 'SYNCED');

      final OfflineGraceStatus status = await fixture.service.status();
      expect(status.readsAllowed, isTrue);
      expect(status.mutationsAllowed, isFalse);
    });

    test('the gate is consulted for enqueue only, never for reads or '
        'transitions', () async {
      final _SpyAuthGate gate = _SpyAuthGate();
      final OutboxRepository spied = OutboxRepository(db, authGate: gate);

      final OutboxData row = await spied.enqueue(testCommand());
      expect(gate.calls, 1, reason: 'one enqueue, one admission check');

      await spied.pendingForPush();
      await spied.byId(row.mutationId);
      await spied.countsByState();
      await spied.transition(mutationId: row.mutationId, to: SyncState.syncing);

      expect(gate.calls, 1, reason: 'reads and state transitions are never gated');
    });
  });
}
