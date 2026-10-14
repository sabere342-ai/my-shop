import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/grace/clock_integrity_guard.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_auth_gate.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_service.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_store.dart';

import 'grace_test_harness.dart';

// Master Plan §38.16.5, F-21/F-22, §40.5 (M1b-S8).
//
// §38.16.5 splits clock tampering in two, and this file pins both halves plus
// the honesty about what a client-local guard cannot see:
//
//   * backward — a persisted high-water mark stops a rewound clock from
//     re-opening an expired window;
//   * forward  — a wall clock that outruns the monotonic source beyond the
//     stated tolerance forces online re-validation before mutating again.

final DateTime _t0 = DateTime.utc(2026, 3, 1, 12, 0, 0);

void main() {
  group('ClockIntegrityGuard (§38.16.5)', () {
    test('advancing both clocks together is ok', () {
      final TestWallClock wall = TestWallClock(_t0);
      final TestMonotonicClock monotonic = TestMonotonicClock();
      final ClockIntegrityGuard guard = ClockIntegrityGuard(
        wallClock: wall.now,
        monotonicClock: monotonic.elapsed,
      );

      wall.advance(const Duration(hours: 2));
      monotonic.advance(const Duration(hours: 2));

      final ClockObservation observation = guard.observe();
      expect(observation.integrity, ClockIntegrity.ok);
      expect(observation.effectiveNow, _t0.add(const Duration(hours: 2)));
    });

    test('a wall clock that outruns the monotonic clock is a forward jump', () {
      final TestWallClock wall = TestWallClock(_t0);
      final TestMonotonicClock monotonic = TestMonotonicClock();
      final ClockIntegrityGuard guard = ClockIntegrityGuard(
        wallClock: wall.now,
        monotonicClock: monotonic.elapsed,
      );

      wall.advance(const Duration(hours: 3)); // monotonic held still: tampered

      expect(guard.observe().integrity, ClockIntegrity.forwardJump);
    });

    test('the tolerance boundary is exact: equal is ok, past it is a jump', () {
      final TestWallClock insideWall = TestWallClock(_t0);
      final ClockIntegrityGuard inside = ClockIntegrityGuard(
        wallClock: insideWall.now,
        monotonicClock: TestMonotonicClock().elapsed,
        tolerance: const Duration(hours: 1),
      );
      insideWall.advance(const Duration(hours: 1));
      expect(inside.observe().integrity, ClockIntegrity.ok);

      final TestWallClock pastWall = TestWallClock(_t0);
      final ClockIntegrityGuard past = ClockIntegrityGuard(
        wallClock: pastWall.now,
        monotonicClock: TestMonotonicClock().elapsed,
        tolerance: const Duration(hours: 1),
      );
      pastWall.advance(const Duration(hours: 1, milliseconds: 1));
      expect(past.observe().integrity, ClockIntegrity.forwardJump);
    });

    test('a rewound clock is clamped by the high-water mark', () {
      final TestWallClock wall = TestWallClock(_t0);
      final ClockIntegrityGuard guard = ClockIntegrityGuard(
        wallClock: wall.now,
        monotonicClock: TestMonotonicClock().elapsed,
      );

      expect(guard.observe().integrity, ClockIntegrity.ok);

      wall.set(_t0.subtract(const Duration(hours: 3)));
      final ClockObservation observation = guard.observe();
      expect(observation.integrity, ClockIntegrity.backwardJump);
      expect(observation.effectiveNow, _t0, reason: 'effective time never regresses');
      expect(guard.highWater, _t0);
    });

    test('a persisted high-water in the future is honoured on the first '
        'observation', () {
      final TestWallClock wall = TestWallClock(_t0);
      final DateTime future = _t0.add(const Duration(days: 2));
      final ClockIntegrityGuard guard = ClockIntegrityGuard(
        wallClock: wall.now,
        monotonicClock: TestMonotonicClock().elapsed,
        persistedHighWater: future,
      );

      final ClockObservation observation = guard.observe();
      expect(observation.integrity, ClockIntegrity.backwardJump);
      expect(observation.effectiveNow, future);
    });
  });

  group('forward tamper forces re-validation (§38.16.5, F-21)', () {
    late AppDatabase db;
    late GraceFixture fixture;
    late OfflineGraceStore store;

    setUp(() async {
      db = openMemoryDatabase();
      await seedDeviceBinding(db);
      fixture = GraceFixture(db);
      store = OfflineGraceStore(db);
      await fixture.service.establishSession(
        buildGraceRecord(issuedAt: testGraceIssuedAt, expiresAt: testGraceExpiresAt),
      );
      // The first evaluation creates the per-process guard; its baseline is the
      // establishment wall time.
      await fixture.service.status();
    });

    tearDown(() async {
      await db.close();
    });

    test('a jump beyond tolerance is refused and flagged', () async {
      fixture.wall.advance(const Duration(hours: 3)); // monotonic held still

      await expectLater(
        fixture.service.requireMutationAllowed(),
        throwsA(isA<OfflineMutationRefusedException>().having(
          (OfflineMutationRefusedException e) => e.reason,
          'reason',
          MutationRefusalReason.clockTamperForward,
        )),
      );
      expect(await store.readRequiresRevalidation(), isTrue);
      expect(await store.readClockTamperCount(), 1);

      // The flag is sticky: the next check reports the durable requirement, not
      // the transient detection.
      await expectLater(
        fixture.service.requireMutationAllowed(),
        throwsA(isA<OfflineMutationRefusedException>().having(
          (OfflineMutationRefusedException e) => e.reason,
          'reason',
          MutationRefusalReason.revalidationRequired,
        )),
      );
    });

    test('returning the clock to normal does not clear the flag', () async {
      fixture.wall.advance(const Duration(hours: 3));
      await expectLater(
        fixture.service.requireMutationAllowed(),
        throwsA(isA<OfflineMutationRefusedException>()),
      );

      fixture.wall.set(_t0);
      await expectLater(
        fixture.service.requireMutationAllowed(),
        throwsA(isA<OfflineMutationRefusedException>().having(
          (OfflineMutationRefusedException e) => e.reason,
          'reason',
          MutationRefusalReason.revalidationRequired,
        )),
      );
    });

    test('a fresh online establishment clears the flag', () async {
      fixture.wall.advance(const Duration(hours: 3));
      await expectLater(
        fixture.service.requireMutationAllowed(),
        throwsA(isA<OfflineMutationRefusedException>()),
      );

      await fixture.service.establishSession(
        buildGraceRecord(issuedAt: testGraceIssuedAt, expiresAt: testGraceExpiresAt),
      );

      expect(await store.readRequiresRevalidation(), isFalse);
      await fixture.service.requireMutationAllowed();
    });

    test('a jump within tolerance is accepted', () async {
      fixture.wall.advance(const Duration(minutes: 30));
      await fixture.service.requireMutationAllowed();
    });

    test('the durable tamper count survives a restart', () async {
      fixture.wall.advance(const Duration(hours: 3));
      await expectLater(
        fixture.service.requireMutationAllowed(),
        throwsA(isA<OfflineMutationRefusedException>()),
      );

      final OfflineGraceService restarted =
          fixture.restart(wallNow: fixture.wall.now());

      expect((await restarted.status()).refusalReason,
          MutationRefusalReason.revalidationRequired);
      expect(await store.readClockTamperCount(), 1);
    });
  });

  group('backward tamper cannot re-open a window (§38.16.5)', () {
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

    test('a restarted process with a rewound clock is still expired', () async {
      final DateTime establishedAt = fixture.wall.now();
      fixture.advance(testGraceWindow + const Duration(hours: 1));
      await expectLater(
        fixture.service.requireMutationAllowed(),
        throwsA(isA<OfflineMutationRefusedException>().having(
          (OfflineMutationRefusedException e) => e.reason,
          'reason',
          MutationRefusalReason.graceExpired,
        )),
      );

      // A restart with the clock wound back to the establishment instant must
      // not re-open the window: the persisted high-water is ahead of it.
      final OfflineGraceService restarted =
          fixture.restart(wallNow: establishedAt);

      final OfflineGraceStatus status = await restarted.status();
      expect(status.refusalReason, MutationRefusalReason.graceExpired);
      expect(status.expiresAt!.toUtc(), establishedAt.add(testGraceWindow).toUtc(),
          reason: 'the expiry derives from the persisted establishment instant');
    });

    test('a backward jump inside the window neither extends it nor blocks reads',
        () async {
      final DateTime establishedAt = fixture.wall.now();
      fixture.advance(const Duration(hours: 1));
      await fixture.service.requireMutationAllowed();

      final OfflineGraceService restarted =
          fixture.restart(wallNow: establishedAt);

      final OfflineGraceStatus status = await restarted.status();
      expect(status.mutationsAllowed, isTrue);
      expect(status.readsAllowed, isTrue);
      expect(status.expiresAt!.toUtc(), establishedAt.add(testGraceWindow).toUtc(),
          reason: 'a rewound clock must not move the server-issued expiry');
    });
  });

  group('the stated residual risk (§38.16.5)', () {
    late AppDatabase db;
    late GraceFixture fixture;

    setUp(() async {
      db = openMemoryDatabase();
      await seedDeviceBinding(db);
      fixture = GraceFixture(db);
      await fixture.service.establishSession(
        buildGraceRecord(issuedAt: testGraceIssuedAt, expiresAt: testGraceExpiresAt),
      );
      await fixture.service.status();
    });

    tearDown(() async {
      await db.close();
    });

    test('a forward jump made while the process is stopped is not detectable '
        'locally, but the window still bounds it', () async {
      // The guard corroborates the wall clock against a monotonic source inside
      // one process. A jump performed while the process is not running cannot
      // be seen, so it is a documented residual bounded by the grace window.
      final OfflineGraceService restarted = fixture.restart(
        wallNow: fixture.wall.now().add(const Duration(days: 30)),
      );

      final OfflineGraceStatus status = await restarted.status();
      expect(status.refusalReason, MutationRefusalReason.graceExpired,
          reason: 'the window, not tamper detection, is what closes here');
      expect(await OfflineGraceStore(db).readRequiresRevalidation(), isFalse);
    });
  });
}
