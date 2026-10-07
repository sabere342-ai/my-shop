// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_router.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// The session snapshot the redirect guard reads (Master Plan section 6.6).
///
/// Riverpod owns the value and `go_router` only ever sees it as an argument to
/// a pure function, which is what keeps routing testable without a widget
/// tree. The value is `notProvisioned` because no session store exists yet;
/// the first slice that persists a session replaces this provider's body, not
/// its consumers.

@ProviderFor(navigationSession)
final navigationSessionProvider = NavigationSessionProvider._();

/// The session snapshot the redirect guard reads (Master Plan section 6.6).
///
/// Riverpod owns the value and `go_router` only ever sees it as an argument to
/// a pure function, which is what keeps routing testable without a widget
/// tree. The value is `notProvisioned` because no session store exists yet;
/// the first slice that persists a session replaces this provider's body, not
/// its consumers.

final class NavigationSessionProvider
    extends
        $FunctionalProvider<
          NavigationSession,
          NavigationSession,
          NavigationSession
        >
    with $Provider<NavigationSession> {
  /// The session snapshot the redirect guard reads (Master Plan section 6.6).
  ///
  /// Riverpod owns the value and `go_router` only ever sees it as an argument to
  /// a pure function, which is what keeps routing testable without a widget
  /// tree. The value is `notProvisioned` because no session store exists yet;
  /// the first slice that persists a session replaces this provider's body, not
  /// its consumers.
  NavigationSessionProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'navigationSessionProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$navigationSessionHash();

  @$internal
  @override
  $ProviderElement<NavigationSession> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  NavigationSession create(Ref ref) {
    return navigationSession(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(NavigationSession value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<NavigationSession>(value),
    );
  }
}

String _$navigationSessionHash() => r'60dc1ee1a28f312af05aed650e235373f1879de0';

/// The client's single `GoRouter` (Master Plan section 6.6).
///
/// The route table is deliberately thin: the shell at `/`, the catch-all at
/// `/not-found`, and a `redirect` that delegates to
/// [resolveRouterRedirect]. Because the provider watches
/// [navigationSessionProvider], a session change rebuilds the router with the
/// new decision instead of nudging an already-built one.

@ProviderFor(appRouter)
final appRouterProvider = AppRouterProvider._();

/// The client's single `GoRouter` (Master Plan section 6.6).
///
/// The route table is deliberately thin: the shell at `/`, the catch-all at
/// `/not-found`, and a `redirect` that delegates to
/// [resolveRouterRedirect]. Because the provider watches
/// [navigationSessionProvider], a session change rebuilds the router with the
/// new decision instead of nudging an already-built one.

final class AppRouterProvider
    extends $FunctionalProvider<GoRouter, GoRouter, GoRouter>
    with $Provider<GoRouter> {
  /// The client's single `GoRouter` (Master Plan section 6.6).
  ///
  /// The route table is deliberately thin: the shell at `/`, the catch-all at
  /// `/not-found`, and a `redirect` that delegates to
  /// [resolveRouterRedirect]. Because the provider watches
  /// [navigationSessionProvider], a session change rebuilds the router with the
  /// new decision instead of nudging an already-built one.
  AppRouterProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'appRouterProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$appRouterHash();

  @$internal
  @override
  $ProviderElement<GoRouter> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  GoRouter create(Ref ref) {
    return appRouter(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(GoRouter value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<GoRouter>(value),
    );
  }
}

String _$appRouterHash() => r'0cc491fc4359f7f78c05e034c663e0b037eb48ac';
