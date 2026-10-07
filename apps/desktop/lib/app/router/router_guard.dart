import 'package:my_shop_desktop/app/router/navigation_session.dart';
import 'package:my_shop_desktop/app/router/route_paths.dart';

/// The `go_router` redirect rule for the whole client (Master Plan section
/// 6.6), as a pure function of `(session, location)`.
///
/// The four branches are the contract:
///
/// - `notProvisioned` allows every location. This is the honest baseline of a
///   client with no session store yet: it may not pretend to be signed in, and
///   it may not bounce a first frame to a screen that does not exist.
/// - `unauthenticated` is sent to sign-in, except when it is already there.
/// - `authenticated` without an organization is sent to organization setup,
///   except when it is already there (returning the current location would
///   loop until `go_router`'s redirect limit).
/// - `authenticated` with an organization is allowed everywhere.
///
/// Sign-in and organization setup register their routes in M2-S7; the guard
/// returns the targets now so the routing decision is written and tested once,
/// instead of being grown inside a route table the day those screens land.
String? resolveRouterRedirect(NavigationSession session, Uri location) {
  final String path = location.path;
  switch (session.authentication) {
    case AuthenticationState.notProvisioned:
      return null;
    case AuthenticationState.unauthenticated:
      return path == RoutePaths.signIn ? null : RoutePaths.signIn;
    case AuthenticationState.authenticated:
      if (session.organizationId != null) {
        return null;
      }
      return path == RoutePaths.organizationSetup
          ? null
          : RoutePaths.organizationSetup;
  }
}
