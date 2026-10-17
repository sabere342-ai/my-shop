import 'package:flutter/foundation.dart';

/// Where a session is in its authentication life cycle (section 6.6).
enum AuthenticationState {
  /// Before any account state has been read: the honest first frame of a
  /// client that has no session store yet.
  notProvisioned,

  /// An account is known to be signed out.
  unauthenticated,

  /// An account is signed in; the organization is what decides the next
  /// screen.
  authenticated,
}

/// The session snapshot the redirect guard reads (section 6.6).
///
/// It is an immutable value, not a stream: `go_router`'s `redirect` is a pure
/// function of `(session, location)`, and keeping the input a plain value is
/// what makes every branch of that function unit-testable without an engine.
@immutable
class NavigationSession {
  /// The state before any session store exists.
  const NavigationSession.notProvisioned()
      : authentication = AuthenticationState.notProvisioned,
        organizationId = null;

  /// A concrete session.
  const NavigationSession({
    required this.authentication,
    this.organizationId,
  });

  /// The authentication state of this snapshot.
  final AuthenticationState authentication;

  /// The workspace the session belongs to, once one is selected.
  final String? organizationId;
}
