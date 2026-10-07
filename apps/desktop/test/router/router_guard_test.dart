import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/app/router/navigation_session.dart';
import 'package:my_shop_desktop/app/router/route_paths.dart';
import 'package:my_shop_desktop/app/router/router_guard.dart';

/// Unit coverage of every branch of the redirect rule (Master Plan section 6.6).
///
/// The guard is a pure function of `(session, location)`, so all six outcomes
/// are reachable here without a widget tree or an engine.
void main() {
  const NavigationSession notProvisioned = NavigationSession.notProvisioned();
  const NavigationSession unauthenticated = NavigationSession(
    authentication: AuthenticationState.unauthenticated,
  );
  const NavigationSession authenticatedNoOrganization = NavigationSession(
    authentication: AuthenticationState.authenticated,
  );
  const NavigationSession authenticatedWithOrganization = NavigationSession(
    authentication: AuthenticationState.authenticated,
    organizationId: 'organization-1',
  );

  group('resolveRouterRedirect', () {
    test('notProvisioned allows any location', () {
      expect(
        resolveRouterRedirect(notProvisioned, Uri.parse(RoutePaths.home)),
        isNull,
      );
      expect(
        resolveRouterRedirect(notProvisioned, Uri.parse(RoutePaths.signIn)),
        isNull,
      );
      expect(
        resolveRouterRedirect(notProvisioned, Uri.parse('/some/deep/link')),
        isNull,
      );
    });

    test('unauthenticated is sent to sign-in', () {
      expect(
        resolveRouterRedirect(unauthenticated, Uri.parse(RoutePaths.home)),
        RoutePaths.signIn,
      );
    });

    test(
      'unauthenticated already at sign-in is allowed (no redirect loop)',
      () {
        expect(
          resolveRouterRedirect(unauthenticated, Uri.parse(RoutePaths.signIn)),
          isNull,
        );
      },
    );

    test('authenticated without an organization is sent to setup', () {
      expect(
        resolveRouterRedirect(
          authenticatedNoOrganization,
          Uri.parse(RoutePaths.home),
        ),
        RoutePaths.organizationSetup,
      );
    });

    test(
      'authenticated without an organization already at setup is allowed',
      () {
        expect(
          resolveRouterRedirect(
            authenticatedNoOrganization,
            Uri.parse(RoutePaths.organizationSetup),
          ),
          isNull,
        );
      },
    );

    test('authenticated with an organization is allowed everywhere', () {
      expect(
        resolveRouterRedirect(
          authenticatedWithOrganization,
          Uri.parse(RoutePaths.home),
        ),
        isNull,
      );
      expect(
        resolveRouterRedirect(
          authenticatedWithOrganization,
          Uri.parse('/some/deep/link'),
        ),
        isNull,
      );
    });
  });
}
