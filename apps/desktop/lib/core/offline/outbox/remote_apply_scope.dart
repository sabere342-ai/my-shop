/// The structural outbox-suppression context — Master Plan §38.12.1, §40.5
/// (M1b-S7), ADR-038.
///
/// §38.12.1's rule is blunt: **"Applying a remote change MUST NOT create an
/// outgoing mutation."** The plan makes that structural rather than a flag an
/// author has to remember: "Remote applies run inside a suppression context;
/// the outbox writer throws if invoked while it is active. This is a
/// *crash-on-violation*, not a flag to be remembered."
///
/// This file is that context. It is deliberately tiny and holds no business
/// state:
///
/// * **Ambient, not injected.** The scope lives in the current [Zone], so any
///   [OutboxRepository] code path sees it without a constructor parameter that
///   a second, bypassing instance could omit. ADR-003 bans a global mutable
///   *singleton* holding business state; a zone-scoped context is the opposite
///   — it is per-call, and it is gone the moment the call returns.
/// * **Nested by depth, not by a boolean.** [currentDepth] is an integer, so a
///   nested remote apply cannot clear its parent's suppression when it
///   finishes. A boolean cleared in a `finally` would.
/// * **Exception-safe by construction.** [run] uses `runZoned`, so the context
///   is torn down when the enclosed future completes — on success, on throw, or
///   on a deliberate invariant violation. There is no cleanup an author can
///   forget.
library;

import 'dart:async';

/// The private zone key. A `const` object has canonical identity, so the key is
/// stable across the library without any mutable global.
class _RemoteApplyKey {
  const _RemoteApplyKey();
}

const _RemoteApplyKey _remoteApplyKey = _RemoteApplyKey();

/// The remote-apply suppression context (§38.12.1).
///
/// `applyRemoteWithoutOutbox` runs its work inside [run]; the outbox writer
/// refuses to enqueue while [isActive] is true.
abstract final class RemoteApplyScope {
  /// How many remote-apply scopes embrace the current call, `0` outside one.
  ///
  /// `> 1` means a remote apply is nested inside another — allowed (a change
  /// can legitimately be applied from within a remote apply, e.g. a future
  /// dependency resolution), and the invariant still holds at every depth.
  static int get currentDepth {
    final Object? raw = Zone.current[_remoteApplyKey];
    return raw is int ? raw : 0;
  }

  /// True while a remote-origin apply is in progress.
  ///
  /// This is the single predicate the outbox writer consults, so the suppression
  /// cannot depend on which repository instance was used (§38.12.1).
  static bool get isActive => currentDepth > 0;

  /// Runs [body] inside a fresh remote-apply context and returns its result.
  ///
  /// The context is a child [Zone] and cannot leak: when the returned future
  /// completes, the context is gone, whether [body] returned, threw, or was
  /// aborted by an [OutboxWriteDuringRemoteApplyException].
  static Future<T> run<T>(Future<T> Function() body) {
    final int depth = currentDepth + 1;
    return runZoned(
      body,
      zoneValues: <Object, Object>{_remoteApplyKey: depth},
    );
  }
}

/// The invariant violation §38.12.1 makes loud: an outgoing mutation was
/// attempted while a remote-origin change was being applied.
///
/// This is never a recoverable business error. It means a code path would have
/// echoed a server change straight back to the server — the replication loop
/// the plan calls "extremely hard to diagnose in the field". It therefore
/// propagates out of the apply transaction, rolling back both the local write
/// and any applied-sequence advance, so the violation cannot be silently
/// swallowed (§38.12.1, §5.2 of the S7 mandate).
class OutboxWriteDuringRemoteApplyException implements Exception {
  const OutboxWriteDuringRemoteApplyException();

  @override
  String toString() =>
      'OutboxWriteDuringRemoteApplyException: OutboxRepository.enqueue was called while a '
      'remote-apply context was active. A remote-origin change must never create an outgoing '
      'mutation (§38.12.1, ADR-038).';
}
