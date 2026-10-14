/// The mutation-admission gate and its refusal vocabulary — Master Plan
/// §38.16.2, §38.16.5, §38.17, §10.3.1, §40.5 (M1b-S8).
///
/// §38.16.2's expiry rule is exact: "At expiry the device goes read-only for
/// mutations. It does not delete anything. Sales already committed remain
/// committed and still sync." So there are two halves to the offline session:
///
/// * **Mutations are refused** once the window closes — a new local business
///   record is not created (T-O17).
/// * **Reads and synchronisation are not blocked** — the device may still show
///   its data and push what it already committed (T-O15's "reads continue, and
///   committed sales still sync").
///
/// This file is the mutation half, expressed as a port the outbox writer
/// consults before it creates anything. Reads are never gated: absent a
/// mutation gate call, every read path behaves exactly as before.
library;

/// Why a new local mutation was refused.
///
/// One value per §38.16.2/§38.16.4/§38.16.5 condition, so the refusal is
/// diagnosable and the owner-facing surface (M8b) can explain it without
/// parsing a sentence.
enum MutationRefusalReason {
  /// No offline session exists: the device has never authenticated, or the
  /// session was cleared (a local password change, §38.16.4). "There is no
  /// offline first-run" (§38.16.2).
  noSession,

  /// The stored record failed local signature verification (§38.16.3, §38.17).
  signatureInvalid,

  /// The record's organization, device, or user does not match this install
  /// (§38.16.2, §10.3.1's anti-replay rule: a record copied to another device
  /// fails the binding check).
  bindingMismatch,

  /// The grace window has closed (§38.16.2). Reads and pushes continue.
  graceExpired,

  /// The organization's entitlement expired; offline sales stop (§38.16.5).
  entitlementExpired,

  /// A forward clock jump beyond tolerance was detected and the session must be
  /// revalidated online before it may mutate again (§38.16.5, F-21).
  clockTamperForward,

  /// A previous tamper detection flagged the session; it stays read-only for
  /// mutations until a fresh online session clears the flag (§38.16.5).
  revalidationRequired,
}

/// The invariant §38.16.2 enforces: a new local mutation is not permitted.
///
/// Thrown by [OfflineAuthGate.requireMutationAllowed] and propagated by the
/// outbox writer *before* any row is written, so a refused mutation leaves no
/// business record, no stock effect, and no outbox entry (T-O17).
class OfflineMutationRefusedException implements Exception {
  const OfflineMutationRefusedException(this.reason, {this.detail});

  /// The §38.16 condition that refused the mutation.
  final MutationRefusalReason reason;

  /// Optional diagnostic that never contains a secret (§38.28.3).
  final String? detail;

  @override
  String toString() =>
      'OfflineMutationRefusedException(${reason.name})${detail == null ? '' : ': $detail'} '
      '(§38.16.2 offline grace)';
}

/// The port the outbox writer consults before creating a mutation (§40.5).
///
/// A dependency-inverted interface: the outbox owns the "before I write a
/// mutation" seam, and the offline-grace module supplies the policy. A `null`
/// gate means "no offline-auth policy is wired", which is the state of every
/// pre-S8 caller and keeps the writer backward compatible.
abstract interface class OfflineAuthGate {
  /// Completes when a new local mutation is permitted.
  ///
  /// Completes normally when the session is valid and inside its window;
  /// throws [OfflineMutationRefusedException] otherwise. Must not write
  /// business data — it is an admission check, not the mutation.
  Future<void> requireMutationAllowed();
}
