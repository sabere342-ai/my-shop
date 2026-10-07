/// The route table's location strings (Master Plan section 6.6).
///
/// Paths live in one place so the redirect guard and the route registrations
/// cannot drift into two different spellings of the same screen.
abstract final class RoutePaths {
  /// The shell the signed-in workspace renders at (section 6.6).
  static const String home = '/';

  /// Where the guard sends an unauthenticated session.
  ///
  /// The route itself is registered when sign-in ships (M2-S7); the guard
  /// already returns the target so the redirect rule exists as one tested
  /// decision rather than as a rule that grows a second branch that day.
  static const String signIn = '/sign-in';

  /// Where the guard sends a session with no organization.
  ///
  /// Registered with organization setup (M2-S7), for the same reason as
  /// [signIn].
  static const String organizationSetup = '/organization-setup';

  /// The catch-all screen an unmatched location resolves to.
  static const String notFound = '/not-found';
}
