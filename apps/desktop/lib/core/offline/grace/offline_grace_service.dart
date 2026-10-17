/// The offline auth-grace service — Master Plan §38.16.2–§38.16.5, §38.17,
/// §10.3.1, §40.5 (M1b-S8), ADR-044.
///
/// This is the policy half of the offline session. It answers one question for
/// the mutation path — *may this device create a new local business record
/// right now?* — and it is deliberately the only place that logic lives, so the
/// boundary conditions of §38.16 are reviewable in one function rather than
/// re-derived at every call site.
///
/// The lifecycle it enforces:
///
/// * **Establishment.** A session exists only after a successful online
///   authentication/sync that produced a signed record (§38.16.2 "there is no
///   offline first-run"). [establishSession] verifies the signature and the
///   device binding before it stores anything, and starts the window at that
///   instant (§10.3.1 "grace start … not on app start").
/// * **Admission.** [requireMutationAllowed] permits a mutation only while the
///   record is signed, bound to this install, unexpired, and the clock is sane.
///   A refusal throws [OfflineMutationRefusedException] — the outbox writer
///   consults this before it writes anything, so a refusal leaves **no business
///   record** (T-O17).
/// * **Reads and pushes are never gated.** §38.16.2: expiry makes the device
///   "read-only for mutations"; it "does not delete anything" and committed
///   sales "still sync". No method here is on the read or push path, so both
///   continue unchanged (T-O15).
/// * **Clock.** Backward jumps cannot reopen an expired window; a forward jump
///   beyond tolerance (or a prior one not yet revalidated) forces read-only
///   until a fresh online session clears it (§38.16.5, F-21).
///
/// It holds no global mutable state (ADR-003): the store is the durability, the
/// guard is per-instance, and both clocks and the tolerance are injected so the
/// window and the tamper cases are tested without waiting or sleeping.
library;

import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/grace/clock_integrity_guard.dart';
import 'package:my_shop_desktop/core/offline/grace/grace_signature_verifier.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_auth_gate.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_record.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_store.dart';
import 'package:my_shop_desktop/core/telemetry/structured_log.dart';

/// The outcome of an [OfflineGraceService.establishSession] attempt.
enum GraceEstablishment {
  /// The record was signed, bound to this install, and stored; the window
  /// starts now (§38.16.2).
  established,

  /// The record failed local signature verification (§38.16.3). Nothing stored.
  signatureInvalid,

  /// The record's organization/device does not match this install
  /// (§38.16.2, §10.3.1 anti-replay). Nothing stored.
  bindingMismatch,
}

/// A snapshot of the offline session for the owner-facing surface and tests.
/// Reads are always permitted (§38.16.2); only mutations can be refused.
class OfflineGraceStatus {
  const OfflineGraceStatus({
    required this.hasSession,
    required this.isReadOnlyForMutations,
    required this.refusalReason,
    required this.expiresAt,
    required this.permissionsVersion,
    required this.permissions,
  });

  /// Whether a stored, bound session exists.
  final bool hasSession;

  /// Whether new mutations are refused right now.
  final bool isReadOnlyForMutations;

  /// Why, when [isReadOnlyForMutations] is true. `null` when mutations are
  /// permitted.
  final MutationRefusalReason? refusalReason;

  /// The grace expiry on the device timeline, when a session exists.
  final DateTime? expiresAt;

  /// The `permissions_version` of the cached snapshot, when a session exists.
  final int? permissionsVersion;

  /// The effective permission set of the cached snapshot, when one exists.
  final List<String> permissions;

  /// §38.16.2: reads continue at expiry.
  bool get readsAllowed => true;

  /// Mutations are permitted.
  bool get mutationsAllowed => !isReadOnlyForMutations;
}

/// The offline auth-grace policy and durable session owner (§40.5 M1b-S8).
class OfflineGraceService implements OfflineAuthGate {
  OfflineGraceService(
    AppDatabase db, {
    required this.verifier,
    DateTime Function()? wallClock,
    Duration Function()? monotonicClock,
    this.forwardJumpTolerance = ClockIntegrityGuard.defaultTolerance,
    this.telemetry,
  })  : _store = OfflineGraceStore(db),
        _wallClock = wallClock ?? DateTime.now,
        _monotonicClock = monotonicClock ?? _defaultMonotonic;

  final OfflineGraceStore _store;

  /// The signature verifier this session trusts (§38.16.3). Required, with no
  /// accepting default, so a device can never verify a record by accident.
  final GraceSignatureVerifier verifier;

  /// Structured, redacted diagnostics (§38.28.3, §38.16.5). Passive: a forward
  /// clock jump is recorded here, but the admission verdict never reads it.
  final TelemetryLogger? telemetry;

  final DateTime Function() _wallClock;
  final Duration Function() _monotonicClock;

  /// The stated forward-jump tolerance (§38.16.5). Public so a caller may
  /// surface or override it; defaults to one hour.
  final Duration forwardJumpTolerance;

  ClockIntegrityGuard? _clockGuard;

  /// Establishes (or replaces) the offline session from a signed record
  /// (§38.16.2, §38.16.3).
  ///
  /// A window is only ever created here, at a real authentication; nothing
  /// derives one from app start or restart.
  Future<GraceEstablishment> establishSession(OfflineGraceRecord record) async {
    if (!verifier.verify(record)) {
      return GraceEstablishment.signatureInvalid;
    }
    final ({String? organizationId, String? deviceId}) binding =
        await _store.readDeviceBinding();
    if (binding.organizationId != record.organizationId ||
        binding.deviceId != record.deviceId) {
      return GraceEstablishment.bindingMismatch;
    }

    final DateTime now = _wallClock();
    await _store.saveSession(record: record, deviceWallEstablishedAt: now);
    await _store.raiseClockHighWater(now);
    // A fresh online session is the revalidation §38.16.5 requires.
    await _store.setRequiresRevalidation(required: false);
    _clockGuard = null;
    return GraceEstablishment.established;
  }

  /// Removes the session. Used on logout and on a local password change, which
  /// invalidates the session "immediately, on that device" (§38.16.4).
  Future<void> clearSession() async {
    await _store.clearSession();
    _clockGuard = null;
  }

  /// The current session status, applying the admission rules without
  /// enforcing them.
  Future<OfflineGraceStatus> status() async {
    final _Admission admission = await _evaluate();
    final OfflineGraceRecord? record = admission.record;
    return OfflineGraceStatus(
      hasSession: record != null,
      isReadOnlyForMutations: admission.reason != null,
      refusalReason: admission.reason,
      expiresAt: admission.expiresAtDeviceWall,
      permissionsVersion: record?.permissionsVersion,
      permissions: record?.permissions ?? const <String>[],
    );
  }

  @override
  Future<void> requireMutationAllowed() async {
    final _Admission admission = await _evaluate();
    final MutationRefusalReason? reason = admission.reason;
    if (reason != null) {
      throw OfflineMutationRefusedException(reason);
    }
  }

  /// The admission decision, plus the values [status] surfaces.
  Future<_Admission> _evaluate() async {
    final StoredOfflineGrace? session = await _store.readSession();
    if (session == null) {
      return const _Admission(reason: MutationRefusalReason.noSession);
    }
    final OfflineGraceRecord record = session.record;

    if (!verifier.verify(record)) {
      return _Admission(reason: MutationRefusalReason.signatureInvalid, record: record);
    }

    final ({String? organizationId, String? deviceId}) binding =
        await _store.readDeviceBinding();
    if (binding.organizationId != record.organizationId ||
        binding.deviceId != record.deviceId) {
      return _Admission(reason: MutationRefusalReason.bindingMismatch, record: record);
    }

    if (await _store.readRequiresRevalidation()) {
      return _Admission(
        reason: MutationRefusalReason.revalidationRequired,
        record: record,
        expiresAtDeviceWall: _deviceExpiry(record, session),
      );
    }

    final ClockObservation clock = await _observeClock();
    await _store.raiseClockHighWater(clock.effectiveNow);
    if (clock.integrity == ClockIntegrity.forwardJump) {
      // §38.16.5: record the security event and require online re-validation.
      await _store.recordClockTamper();
      await _store.setRequiresRevalidation(required: true);
      // §38.16.5 names a "security event"; the durable flag is the local half,
      // and this structured record is the observable half. It carries no clock
      // value, no record, and no payload — only that the class of event
      // occurred, so a future security-event sink can be built on it (§38.28.3).
      telemetry?.log(
        SyncLogEvents.clockTamper,
        fields: <String, Object?>{
          LoggableKeys.component: 'offline_grace',
          LoggableKeys.reason: 'forward_jump',
        },
      );
      return _Admission(
        reason: MutationRefusalReason.clockTamperForward,
        record: record,
        expiresAtDeviceWall: _deviceExpiry(record, session),
      );
    }

    final DateTime expiresAtDeviceWall = _deviceExpiry(record, session);
    if (!clock.effectiveNow.isBefore(expiresAtDeviceWall)) {
      return _Admission(
        reason: MutationRefusalReason.graceExpired,
        record: record,
        expiresAtDeviceWall: expiresAtDeviceWall,
      );
    }

    final DateTime? entitlement = record.entitlementExpiresAt;
    if (entitlement != null) {
      // Same server-window → device-timeline mapping as the grace expiry.
      final Duration remaining = entitlement.difference(record.issuedAt);
      final DateTime entitlementDeviceWall = session.deviceWallEstablishedAt.add(remaining);
      if (!clock.effectiveNow.isBefore(entitlementDeviceWall)) {
        return _Admission(
          reason: MutationRefusalReason.entitlementExpired,
          record: record,
          expiresAtDeviceWall: expiresAtDeviceWall,
        );
      }
    }

    return _Admission(record: record, expiresAtDeviceWall: expiresAtDeviceWall);
  }

  /// The grace expiry translated onto the device timeline: the establishment
  /// instant plus the window the server issued. The window length is
  /// offset-invariant, so this never mixes the device clock with server time
  /// (§38.16.5).
  DateTime _deviceExpiry(OfflineGraceRecord record, StoredOfflineGrace session) {
    return session.deviceWallEstablishedAt.add(record.graceWindow);
  }

  Future<ClockObservation> _observeClock() async {
    final ClockIntegrityGuard guard = await _ensureGuard();
    final ClockObservation observation = guard.observe();
    final DateTime? highWater = guard.highWater;
    if (highWater != null) {
      await _store.raiseClockHighWater(highWater);
    }
    return observation;
  }

  Future<ClockIntegrityGuard> _ensureGuard() async {
    final ClockIntegrityGuard? existing = _clockGuard;
    if (existing != null) return existing;
    final ClockIntegrityGuard guard = ClockIntegrityGuard(
      wallClock: _wallClock,
      monotonicClock: _monotonicClock,
      persistedHighWater: await _store.readClockHighWater(),
      tolerance: forwardJumpTolerance,
    );
    _clockGuard = guard;
    return guard;
  }
}

/// The internal admission result.
class _Admission {
  const _Admission({this.reason, this.record, this.expiresAtDeviceWall});

  final MutationRefusalReason? reason;
  final OfflineGraceRecord? record;
  final DateTime? expiresAtDeviceWall;
}

/// Process-lifetime monotonic source: a stopped-at-construction-free stopwatch.
/// Injectable so tests can drive a forward jump deterministically.
final Stopwatch _processStopwatch = Stopwatch()..start();

Duration _defaultMonotonic() => _processStopwatch.elapsed;
