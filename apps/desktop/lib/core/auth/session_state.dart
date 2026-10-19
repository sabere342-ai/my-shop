/// The observable session state — the value the router guard and the shell
/// read (Master Plan §6.6, §38.31, §40.6 M2-S7).
///
/// [phase] maps one-to-one onto [AuthenticationState], with the honest boot
/// gate: `bootPending` is the instant before the keystore has answered, and
/// the router holds `notProvisioned` for it rather than guessing
/// (section 6.6: the redirect is a pure function of `(session, location)`).
/// [exitReason] carries the closed reason the last session ended with, so
/// the sign-in screen can explain itself without leaking internals (§34.3).
library;

import 'package:flutter/foundation.dart';
import 'package:my_shop_desktop/core/auth/auth_session.dart';

/// One session snapshot.
@immutable
class AppSessionState {
  const AppSessionState._(this.phase, this.session, this.exitReason);

  /// The boot instant: the keystore has not answered yet.
  const AppSessionState.bootPending()
    : this._(SessionPhase.bootPending, null, null);

  /// No session. [exitReason], when present, says why.
  const AppSessionState.signedOut({SessionExitReason? exitReason})
    : this._(SessionPhase.signedOut, null, exitReason);

  /// A usable session.
  const AppSessionState.signedIn(AuthSession session)
    : this._(SessionPhase.signedIn, session, null);

  final SessionPhase phase;
  final AuthSession? session;
  final SessionExitReason? exitReason;
}
