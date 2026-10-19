import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:my_shop_desktop/app/router/navigation_session.dart';
import 'package:my_shop_desktop/app/router/not_found_screen.dart';
import 'package:my_shop_desktop/app/router/route_paths.dart';
import 'package:my_shop_desktop/app/router/router_guard.dart';
import 'package:my_shop_desktop/app/router/shell_screen.dart';
import 'package:my_shop_desktop/core/auth/app_session_notifier.dart';
import 'package:my_shop_desktop/core/auth/auth_session.dart';
import 'package:my_shop_desktop/core/auth/session_state.dart';
import 'package:my_shop_desktop/features/auth/organization_setup_screen.dart';
import 'package:my_shop_desktop/features/auth/sign_in_screen.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'app_router.g.dart';

/// The session snapshot the redirect guard reads (Master Plan section 6.6).
///
/// Riverpod owns the value and `go_router` only ever sees it as an argument to
/// a pure function, which is what keeps routing testable without a widget
/// tree. The value is derived from the M2-S7 [appSessionProvider]: the boot
/// instant (`SessionPhase.bootPending`) maps to `notProvisioned` — the router
/// holds the honest first frame instead of guessing — and every resolved
/// session maps onto the guard's three-way contract. A session change rebuilds
/// the router with the new decision instead of nudging an already-built one.
@Riverpod(keepAlive: true)
NavigationSession navigationSession(Ref ref) {
  final AppSessionState state = ref.watch(appSessionProvider);
  return switch (state.phase) {
    SessionPhase.bootPending => const NavigationSession.notProvisioned(),
    SessionPhase.signedOut =>
      const NavigationSession(authentication: AuthenticationState.unauthenticated),
    SessionPhase.signedIn => NavigationSession(
        authentication: AuthenticationState.authenticated,
        organizationId: state.session?.organizationId,
      ),
  };
}

/// The client's single `GoRouter` (Master Plan section 6.6).
///
/// The route table is deliberately thin: the shell at `/`, the two session
/// screens the M2-S7 flow drives, the catch-all at `/not-found`, and a
/// `redirect` that delegates to [resolveRouterRedirect]. Because the provider
/// watches [navigationSessionProvider], a session change rebuilds the router
/// with the new decision instead of nudging an already-built one.
@Riverpod(keepAlive: true)
GoRouter appRouter(Ref ref) {
  final NavigationSession session = ref.watch(navigationSessionProvider);
  final GoRouter router = GoRouter(
    initialLocation: RoutePaths.home,
    routes: <RouteBase>[
      GoRoute(
        path: RoutePaths.home,
        name: 'home',
        builder: (BuildContext context, GoRouterState state) =>
            const ShellScreen(),
      ),
      GoRoute(
        path: RoutePaths.signIn,
        name: 'signIn',
        builder: (BuildContext context, GoRouterState state) =>
            const SignInScreen(),
      ),
      GoRoute(
        path: RoutePaths.organizationSetup,
        name: 'organizationSetup',
        builder: (BuildContext context, GoRouterState state) =>
            const OrganizationSetupScreen(),
      ),
      GoRoute(
        path: RoutePaths.notFound,
        name: 'notFound',
        builder: (BuildContext context, GoRouterState state) =>
            const NotFoundScreen(),
      ),
    ],
    redirect: (BuildContext context, GoRouterState state) =>
        resolveRouterRedirect(session, state.uri),
    onException: (BuildContext context, GoRouterState state, GoRouter router) =>
        router.go(RoutePaths.notFound),
  );
  ref.onDispose(router.dispose);
  return router;
}
