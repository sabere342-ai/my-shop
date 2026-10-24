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
/// tree. The value is derived from the M2-S7 [appSessionProvider]: the boot
/// instant (`SessionPhase.bootPending`) maps to `notProvisioned` — the router
/// holds the honest first frame instead of guessing — and every resolved
/// session maps onto the guard's three-way contract. A session change rebuilds
/// the router with the new decision instead of nudging an already-built one.

@ProviderFor(navigationSession)
final navigationSessionProvider = NavigationSessionProvider._();

/// The session snapshot the redirect guard reads (Master Plan section 6.6).
///
/// Riverpod owns the value and `go_router` only ever sees it as an argument to
/// a pure function, which is what keeps routing testable without a widget
/// tree. The value is derived from the M2-S7 [appSessionProvider]: the boot
/// instant (`SessionPhase.bootPending`) maps to `notProvisioned` — the router
/// holds the honest first frame instead of guessing — and every resolved
/// session maps onto the guard's three-way contract. A session change rebuilds
/// the router with the new decision instead of nudging an already-built one.

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
  /// tree. The value is derived from the M2-S7 [appSessionProvider]: the boot
  /// instant (`SessionPhase.bootPending`) maps to `notProvisioned` — the router
  /// holds the honest first frame instead of guessing — and every resolved
  /// session maps onto the guard's three-way contract. A session change rebuilds
  /// the router with the new decision instead of nudging an already-built one.
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

String _$navigationSessionHash() => r'd1e7e21b7dd578a2619adfd968604dcb506073ac';

/// The client's single `GoRouter` (Master Plan section 6.6).
///
/// The route table is deliberately thin: the shell at `/`, the two session
/// screens the M2-S7 flow drives, the catch-all at `/not-found`, and a
/// `redirect` that delegates to [resolveRouterRedirect]. Because the provider
/// watches [navigationSessionProvider], a session change rebuilds the router
/// with the new decision instead of nudging an already-built one.

@ProviderFor(appRouter)
final appRouterProvider = AppRouterProvider._();

/// The client's single `GoRouter` (Master Plan section 6.6).
///
/// The route table is deliberately thin: the shell at `/`, the two session
/// screens the M2-S7 flow drives, the catch-all at `/not-found`, and a
/// `redirect` that delegates to [resolveRouterRedirect]. Because the provider
/// watches [navigationSessionProvider], a session change rebuilds the router
/// with the new decision instead of nudging an already-built one.

final class AppRouterProvider
    extends $FunctionalProvider<GoRouter, GoRouter, GoRouter>
    with $Provider<GoRouter> {
  /// The client's single `GoRouter` (Master Plan section 6.6).
  ///
  /// The route table is deliberately thin: the shell at `/`, the two session
  /// screens the M2-S7 flow drives, the catch-all at `/not-found`, and a
  /// `redirect` that delegates to [resolveRouterRedirect]. Because the provider
  /// watches [navigationSessionProvider], a session change rebuilds the router
  /// with the new decision instead of nudging an already-built one.
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

String _$appRouterHash() => r'a161768b17fe4f16376fd2affdd1be2bfb46587d';
