import 'package:drift/drift.dart' hide isNull, isNotNull;
import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/apply/apply_remote_without_outbox.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';
import 'package:my_shop_desktop/core/offline/outbox/remote_apply_scope.dart';

import 'outbox_test_harness.dart';

// Master Plan §38.12.1, §38.12.2, §40.5 (M1b-S7), T-O7.
//
// The two invariants this file exists to pin:
//
//   * T-O7 — applying any arbitrary remote change set leaves the outbox count
//     unchanged, and a stale page cannot roll local state back.
//   * §38.12.1 — a remote apply that tries to enqueue an outgoing mutation
//     crashes, and rolls its own local writes back with it.
//
// The "local effect" of a remote change is a fixture table the apply callback
// writes through the boundary, exactly as a future entity-retrieval slice will
// write `local_products`/`local_sales`. The boundary does not invent a business
// entity (descriptor-only pull, S6), so a deterministic fixture is the honest
// stand-in.
void main() {
  group('T-O7: loop prevention — applyRemoteWithoutOutbox (§38.12.1)', () {
    late AppDatabase db;
    late OutboxRepository outbox;

    setUp(() async {
      db = openMemoryDatabase();
      outbox = OutboxRepository(db);
      await seedDeviceBinding(db);
      await createFixtureTable(db);
    });

    tearDown(() async {
      await db.close();
    });

    // -----------------------------------------------------------------------
    // A. A newer change applies, persists its guard, and never touches the
    //    outbox.
    // -----------------------------------------------------------------------

    test('applies a newer change, persists the guard, and leaves the outbox '
        'untouched', () async {
      // A pre-existing local mutation is the T-O7 sentinel: it must survive
      // byte-for-byte and no sibling may appear.
      final existing = await outbox.enqueue(testCommand());
      final before = await outboxCount(db);
      expect(before, 1);

      var applyCalls = 0;
      final RemoteApplyResult result = await applyRemoteWithoutOutbox(
        db,
        change: const RemoteChange(
          entityType: 'PRODUCT',
          entityId: 'p1',
          serverSequence: '10',
        ),
        apply: () async {
          applyCalls += 1;
          await writeFixture(db, entityType: 'PRODUCT', entityId: 'p1', value: 'remote-10');
        },
      );

      expect(result.wasApplied, isTrue);
      expect(result.disposition, RemoteApplyDisposition.applied);
      expect(result.previousSequence, isNull,
          reason: 'the entity had no applied sequence yet');
      expect(applyCalls, 1, reason: 'the local effect runs exactly once');
      expect(await readFixture(db, 'PRODUCT', 'p1'), 'remote-10');

      final guard = await db.select(db.remoteAppliedChanges).getSingle();
      expect(guard.entityType, 'PRODUCT');
      expect(guard.entityId, 'p1');
      expect(guard.lastAppliedServerSequence, '10');

      expect(await outboxCount(db), before,
          reason: 'T-O7: a remote apply must not create an outgoing mutation');
      expect(await outbox.byId(existing.mutationId), isNotNull,
          reason: 'the pre-existing local mutation is untouched');
      expect(RemoteApplyScope.isActive, isFalse,
          reason: 'the suppression context must not outlive the call');
    });

    // -----------------------------------------------------------------------
    // B. Duplicate and stale changes are discarded without re-running the
    //    effect and without rolling anything back.
    // -----------------------------------------------------------------------

    test('discards a duplicate and a stale change without side effects',
        () async {
      var applyCalls = 0;
      Future<RemoteApplyResult> applySequence(String sequence) {
        return applyRemoteWithoutOutbox(
          db,
          change: RemoteChange(
            entityType: 'PRODUCT',
            entityId: 'p1',
            serverSequence: sequence,
          ),
          apply: () async {
            applyCalls += 1;
            await writeFixture(db,
                entityType: 'PRODUCT', entityId: 'p1', value: 'v$sequence');
          },
        );
      }

      expect((await applySequence('10')).wasApplied, isTrue);

      final duplicate = await applySequence('10');
      expect(duplicate.disposition, RemoteApplyDisposition.discardedStale,
          reason: 'a re-delivered change is not strictly newer');
      expect(duplicate.previousSequence, BigInt.from(10));
      expect(await readFixture(db, 'PRODUCT', 'p1'), 'v10',
          reason: 'the newer state must not be overwritten by a duplicate');

      final stale = await applySequence('7');
      expect(stale.disposition, RemoteApplyDisposition.discardedStale,
          reason: '§38.12.1: a stale page must not roll local state back');
      expect(stale.previousSequence, BigInt.from(10));
      expect(await readFixture(db, 'PRODUCT', 'p1'), 'v10');

      expect(applyCalls, 1,
          reason: 'only the strictly-newer change ran the local effect');
      final guard = await db.select(db.remoteAppliedChanges).getSingle();
      expect(guard.lastAppliedServerSequence, '10',
          reason: 'a discard never advances the guard');
    });

    // -----------------------------------------------------------------------
    // C. Increasing sequences advance the guard, including past 2^53.
    // -----------------------------------------------------------------------

    test('an increasing sequence advances the guard, including past 2^53',
        () async {
      Future<RemoteApplyResult> applySequence(String sequence) {
        return applyRemoteWithoutOutbox(
          db,
          change: RemoteChange(
            entityType: 'PRODUCT',
            entityId: 'p1',
            serverSequence: sequence,
          ),
          apply: () => writeFixture(db,
              entityType: 'PRODUCT', entityId: 'p1', value: 'v$sequence'),
        );
      }

      expect((await applySequence('10')).previousSequence, isNull);
      final second = await applySequence('11');
      expect(second.wasApplied, isTrue);
      expect(second.previousSequence, BigInt.from(10),
          reason: 'the guard reports the sequence it replaced');

      // `9007199254740993` is 2^53 + 1: exact only as a BigInt / decimal
      // string. A `double` comparison would mis-round it and could let a stale
      // change through (§38.11.1, §38.11.2).
      const String pastDouble = '9007199254740993';
      final big = await applySequence(pastDouble);
      expect(big.wasApplied, isTrue);
      expect(big.previousSequence, BigInt.from(11));

      // A value one below it is now genuinely stale.
      final below = await applySequence('9007199254740992');
      expect(below.disposition, RemoteApplyDisposition.discardedStale);
      expect(below.previousSequence, BigInt.parse(pastDouble));

      final guard = await db.select(db.remoteAppliedChanges).getSingle();
      expect(guard.lastAppliedServerSequence, pastDouble,
          reason: 'the 64-bit sequence is stored exactly, as a decimal string');
    });

    // -----------------------------------------------------------------------
    // D. The guard is per entity, not a single global cursor.
    // -----------------------------------------------------------------------

    test('the guard is per entity: a lower sequence on a different entity '
        'still applies', () async {
      expect(
        (await applyRemoteWithoutOutbox(
          db,
          change: const RemoteChange(
            entityType: 'PRODUCT',
            entityId: 'p1',
            serverSequence: '100',
          ),
          apply: () => writeFixture(db,
              entityType: 'PRODUCT', entityId: 'p1', value: 'p1'),
        ))
            .wasApplied,
        isTrue,
      );

      // §38.12.1 guards "the record's last-applied sequence", so a *different*
      // entity with a smaller sequence is not stale for that entity. The
      // server assigns sequences globally per organization, so an entity's
      // sequences are not `previous + 1` and must not be compared across
      // entities.
      final other = await applyRemoteWithoutOutbox(
        db,
        change: const RemoteChange(
          entityType: 'PRODUCT',
          entityId: 'p2',
          serverSequence: '5',
        ),
        apply: () => writeFixture(db,
            entityType: 'PRODUCT', entityId: 'p2', value: 'p2'),
      );
      expect(other.wasApplied, isTrue);

      final guards = await db.select(db.remoteAppliedChanges).get();
      expect(
        {for (final g in guards) '${g.entityType}/${g.entityId}': g.lastAppliedServerSequence},
        {'PRODUCT/p1': '100', 'PRODUCT/p2': '5'},
      );
    });

    // -----------------------------------------------------------------------
    // E. Invalid input is refused before anything is written.
    // -----------------------------------------------------------------------

    test('refuses an invalid server_sequence before any write', () async {
      for (final String bad in <String>['', '-1', '1.5', 'abc', ' 10', '10 ']) {
        await expectLater(
          attemptApply(
            db,
            entityType: 'PRODUCT',
            entityId: 'p1',
            serverSequence: bad,
            apply: () => writeFixture(db,
                entityType: 'PRODUCT', entityId: 'p1', value: 'nope'),
          ),
          throwsArgumentError,
          reason: 'server_sequence `$bad` is not a non-negative decimal integer',
        );
      }
      expect(await readFixture(db, 'PRODUCT', 'p1'), isNull);
      expect(await db.select(db.remoteAppliedChanges).get(), isEmpty);
      expect(await outboxCount(db), 0);
    });

    test('refuses an empty entity identity before any write', () async {
      await expectLater(
        attemptApply(
          db,
          entityType: '  ',
          entityId: 'p1',
          serverSequence: '1',
          apply: () => writeFixture(db,
              entityType: 'PRODUCT', entityId: 'p1', value: 'nope'),
        ),
        throwsArgumentError,
      );
      await expectLater(
        attemptApply(
          db,
          entityType: 'PRODUCT',
          entityId: '',
          serverSequence: '1',
          apply: () => writeFixture(db,
              entityType: 'PRODUCT', entityId: 'p1', value: 'nope'),
        ),
        throwsArgumentError,
      );
      expect(await readFixture(db, 'PRODUCT', 'p1'), isNull);
      expect(await db.select(db.remoteAppliedChanges).get(), isEmpty);
    });

    // -----------------------------------------------------------------------
    // F. A failed apply rolls back both the local effect and the guard advance;
    //    the change stays retryable.
    // -----------------------------------------------------------------------

    test('a failing apply rolls back the local effect and does not advance the '
        'guard, and the change is retryable', () async {
      var attempts = 0;
      await expectLater(
        applyRemoteWithoutOutbox(
          db,
          change: const RemoteChange(
            entityType: 'PRODUCT',
            entityId: 'p1',
            serverSequence: '10',
          ),
          apply: () async {
            attempts += 1;
            await writeFixture(db,
                entityType: 'PRODUCT', entityId: 'p1', value: 'partial');
            throw StateError('local write failed');
          },
        ),
        throwsStateError,
      );

      expect(await readFixture(db, 'PRODUCT', 'p1'), isNull,
          reason: 'the partially written local effect rolled back');
      expect(await db.select(db.remoteAppliedChanges).get(), isEmpty,
          reason: 'a failed apply must not advance the guard');
      expect(RemoteApplyScope.isActive, isFalse);

      // The same change is not poisoned: a retry applies exactly once.
      final retry = await applyRemoteWithoutOutbox(
        db,
        change: const RemoteChange(
          entityType: 'PRODUCT',
          entityId: 'p1',
          serverSequence: '10',
        ),
        apply: () async {
          attempts += 1;
          await writeFixture(db,
              entityType: 'PRODUCT', entityId: 'p1', value: 'committed');
        },
      );
      expect(retry.wasApplied, isTrue);
      expect(retry.previousSequence, isNull);
      expect(attempts, 2);
      expect(await readFixture(db, 'PRODUCT', 'p1'), 'committed');
      final guard = await db.select(db.remoteAppliedChanges).getSingle();
      expect(guard.lastAppliedServerSequence, '10');
    });

    // -----------------------------------------------------------------------
    // G. The crash-on-violation: enqueue during a remote apply throws and the
    //    whole apply rolls back; the suppression does not leak afterwards.
    // -----------------------------------------------------------------------

    test('enqueue during a remote apply throws and rolls the apply back',
        () async {
      await expectLater(
        applyRemoteWithoutOutbox(
          db,
          change: const RemoteChange(
            entityType: 'PRODUCT',
            entityId: 'p1',
            serverSequence: '10',
          ),
          apply: () async {
            // A remote change that tried to become an outgoing mutation — the
            // infinite replication loop §38.12.2 exists to make impossible.
            await writeFixture(db,
                entityType: 'PRODUCT', entityId: 'p1', value: 'echo');
            await outbox.enqueue(testCommand());
          },
        ),
        throwsA(isA<OutboxWriteDuringRemoteApplyException>()),
      );

      expect(await readFixture(db, 'PRODUCT', 'p1'), isNull,
          reason: 'the invariant violation rolled the local write back');
      expect(await db.select(db.remoteAppliedChanges).get(), isEmpty,
          reason: 'the guard did not advance on the violation');
      expect(await outboxCount(db), 0,
          reason: 'no outgoing mutation was created');

      // The context is gone, so an ordinary local mutation is unaffected.
      final normal = await outbox.enqueue(testCommand());
      expect(normal.mutationId, isNotEmpty);
      expect(await outboxCount(db), 1);
    });

    test('a nested remote apply is still suppressed at depth', () async {
      await expectLater(
        applyRemoteWithoutOutbox(
          db,
          change: const RemoteChange(
            entityType: 'PRODUCT',
            entityId: 'outer',
            serverSequence: '10',
          ),
          apply: () => applyRemoteWithoutOutbox(
            db,
            change: const RemoteChange(
              entityType: 'PRODUCT',
              entityId: 'inner',
              serverSequence: '20',
            ),
            apply: () => outbox.enqueue(testCommand()),
          ),
        ),
        throwsA(isA<OutboxWriteDuringRemoteApplyException>()),
      );

      expect(await db.select(db.remoteAppliedChanges).get(), isEmpty,
          reason: 'both the inner and outer guard writes rolled back');
      expect(await outboxCount(db), 0);
      expect(RemoteApplyScope.isActive, isFalse);
    });

    // -----------------------------------------------------------------------
    // H. T-O7 end-to-end: an arbitrary change set — applied once, then
    //    re-delivered in full — produces one effect per change and never a
    //    single outgoing mutation.
    // -----------------------------------------------------------------------

    test('T-O7: an arbitrary change set leaves the outbox unchanged, and a '
        'full re-delivery duplicates no effect', () async {
      await outbox.enqueue(testCommand());
      final before = await outboxCount(db);

      const List<(String, String)> entities = <(String, String)>[
        ('PRODUCT', 'p1'),
        ('PRODUCT', 'p2'),
        ('SALE', 's1'),
        ('STOCK_MOVEMENT', 'm1'),
      ];

      Future<void> applySet({required String sequenceSuffix}) async {
        var sequence = 1;
        for (final (String type, String id) in entities) {
          final String seq = '$sequence$sequenceSuffix';
          await applyRemoteWithoutOutbox(
            db,
            change: RemoteChange(
              entityType: type,
              entityId: id,
              serverSequence: seq,
            ),
            apply: () => writeFixture(db,
                entityType: type, entityId: id, value: 'applied-$seq'),
          );
          sequence += 1;
        }
      }

      // First delivery: sequences 10, 20, 30, 40.
      await applySet(sequenceSuffix: '0');
      expect(await db.select(db.remoteAppliedChanges).get(), hasLength(4));

      // Full re-delivery of the identical page: every change is now a
      // duplicate, so nothing re-applies and no state moves.
      await applySet(sequenceSuffix: '0');

      const Map<String, String> expectedValues = <String, String>{
        'PRODUCT/p1': 'applied-10',
        'PRODUCT/p2': 'applied-20',
        'SALE/s1': 'applied-30',
        'STOCK_MOVEMENT/m1': 'applied-40',
      };
      for (final MapEntry<String, String> entry in expectedValues.entries) {
        final List<String> parts = entry.key.split('/');
        expect(await readFixture(db, parts[0], parts[1]), entry.value,
            reason: 'a re-delivered page must not change local state');
      }
      expect(await db.select(db.remoteAppliedChanges).get(), hasLength(4),
          reason: 're-delivery adds no guard rows');

      expect(await outboxCount(db), before,
          reason: 'T-O7: the outbox is byte-identical after any remote apply');
    });
  });
}

// ---------------------------------------------------------------------------
// Fixture-entity helpers: the local effect a remote apply performs.
// ---------------------------------------------------------------------------

/// Calls [applyRemoteWithoutOutbox] from an `async` body, so a synchronous
/// argument-validation throw surfaces as a failed future an `expectLater`
/// matcher can observe (the boundary throws before it returns a future).
Future<RemoteApplyResult> attemptApply(
  AppDatabase db, {
  required String entityType,
  required String entityId,
  required String serverSequence,
  RemoteApplyOperation? apply,
}) async {
  return applyRemoteWithoutOutbox(
    db,
    change: RemoteChange(
      entityType: entityType,
      entityId: entityId,
      serverSequence: serverSequence,
    ),
    apply: apply ?? () async {},
  );
}

Future<void> createFixtureTable(AppDatabase db) {
  return db.customStatement(
    'CREATE TABLE fixture_entities ('
    'entity_type TEXT NOT NULL, '
    'entity_id TEXT NOT NULL, '
    'value TEXT NOT NULL, '
    'PRIMARY KEY (entity_type, entity_id))',
  );
}

Future<void> writeFixture(
  AppDatabase db, {
  required String entityType,
  required String entityId,
  required String value,
}) {
  // `customStatement` binds raw values (unlike `customSelect`, which takes
  // `Variable`s), so the arguments are passed directly.
  return db.customStatement(
    'INSERT INTO fixture_entities (entity_type, entity_id, value) '
    'VALUES (?, ?, ?) '
    'ON CONFLICT (entity_type, entity_id) DO UPDATE SET value = excluded.value',
    <Object?>[entityType, entityId, value],
  );
}

Future<String?> readFixture(
  AppDatabase db,
  String entityType,
  String entityId,
) async {
  final row = await db.customSelect(
    'SELECT value FROM fixture_entities WHERE entity_type = ? AND entity_id = ?',
    variables: <Variable<Object>>[
      Variable<String>(entityType),
      Variable<String>(entityId),
    ],
  ).getSingleOrNull();
  return row?.read<String>('value');
}

Future<int> outboxCount(AppDatabase db) async {
  final row = await db.customSelect('SELECT COUNT(*) AS n FROM outbox').getSingle();
  return row.read<int>('n');
}
