import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/apply/apply_remote_without_outbox.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_auth_gate.dart';
import 'package:my_shop_desktop/core/offline/outbox/operation_type.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';
import 'package:my_shop_desktop/core/offline/outbox/remote_apply_scope.dart';

import 'grace_test_harness.dart';

// Master Plan §38.12.1, §38.16.2, §40.5 (M1b-S8).
//
// The outbox writer gained exactly one seam in M1b-S8: an optional
// [OfflineAuthGate] consulted before it writes a new mutation. This file pins
// the *ordering* of that seam and its backward compatibility:
//
//   * with no gate wired, the writer behaves exactly as it did before S8;
//   * the §38.12.1 remote-apply suppression still fires first, because it
//     guards a structural invariant, not a policy decision;
//   * the gate is consulted before validation and before any write.

class _ThrowingGate implements OfflineAuthGate {
  _ThrowingGate(this.error);

  final Object error;
  int calls = 0;

  @override
  Future<void> requireMutationAllowed() async {
    calls += 1;
    throw error;
  }
}

class _RefusingGate implements OfflineAuthGate {
  int calls = 0;

  @override
  Future<void> requireMutationAllowed() async {
    calls += 1;
    throw const OfflineMutationRefusedException(MutationRefusalReason.noSession);
  }
}

/// A command that is structurally invalid, so the writer would throw an
/// [ArgumentError] if it ever reached validation.
OutboxEnqueueCommand invalidCommand() => const OutboxEnqueueCommand(
      aggregateType: '  ',
      aggregateId: testAggregateId,
      operationType: OperationType.create,
      payload: <String, Object?>{'saleNo': 'S-1'},
      payloadVersion: 1,
      actorUserId: testActorUserId,
      actorRoleSnapshot: <String, Object?>{'permissions': <Object?>[]},
    );

Future<void> expectNothingWritten(AppDatabase db) async {
  expect(await outboxRowCount(db), 0);
  expect(await auditRowCount(db), 0);
  expect(await hasMetaKey(db, OutboxRepository.sequenceCounterKey), isFalse);
}

void main() {
  late AppDatabase db;

  setUp(() async {
    db = openMemoryDatabase();
    await seedDeviceBinding(db);
  });

  tearDown(() async {
    await db.close();
  });

  group('backward compatibility', () {
    test('with no gate, a mutation is written as before S8', () async {
      final OutboxRepository outbox = OutboxRepository(db);
      final OutboxData row = await outbox.enqueue(testCommand());
      expect(row.mutationId, isNotEmpty);
      expect(await outboxRowCount(db), 1);
    });
  });

  group('admission ordering', () {
    test('the remote-apply suppression fires before the gate', () async {
      final _RefusingGate gate = _RefusingGate();
      final OutboxRepository outbox = OutboxRepository(db, authGate: gate);

      await expectLater(
        applyRemoteWithoutOutbox(
          db,
          change: const RemoteChange(
            entityType: 'PRODUCT',
            entityId: 'p1',
            serverSequence: '1',
          ),
          apply: () async {
            await outbox.enqueue(testCommand());
          },
        ),
        throwsA(isA<OutboxWriteDuringRemoteApplyException>()),
        reason: '§38.12.1 is structural and must not be shadowed by the gate',
      );

      expect(gate.calls, 0, reason: 'the suppression throws before the gate is asked');
      await expectNothingWritten(db);
      expect(RemoteApplyScope.isActive, isFalse,
          reason: 'the suppression context must not outlive the call');
    });

    test('a refusing gate is consulted before command validation', () async {
      final _RefusingGate gate = _RefusingGate();
      final OutboxRepository outbox = OutboxRepository(db, authGate: gate);

      await expectLater(
        outbox.enqueue(invalidCommand()),
        throwsA(isA<OfflineMutationRefusedException>()),
        reason: 'admission precedes validation (§38.16.2)',
      );
      expect(gate.calls, 1);
      await expectNothingWritten(db);
    });

    test('without a gate the same invalid command reaches validation',
        () async {
      final OutboxRepository outbox = OutboxRepository(db);

      // With no gate the writer validates synchronously, so the throw happens
      // before `enqueue` returns a future.
      expect(() => outbox.enqueue(invalidCommand()), throwsArgumentError);
      await expectNothingWritten(db);
    });

    test('a gate that fails unexpectedly propagates and writes nothing',
        () async {
      final _ThrowingGate gate = _ThrowingGate(StateError('boom'));
      final OutboxRepository outbox = OutboxRepository(db, authGate: gate);

      await expectLater(outbox.enqueue(testCommand()), throwsStateError);
      expect(gate.calls, 1);
      await expectNothingWritten(db);
    });
  });
}
