import 'package:flutter/material.dart';

/// Whether a caller is allowed to see [child] (section 6.9).
///
/// The gate takes the answer from its caller instead of reading a provider
/// itself: this slice has no permission model to query, and a design-system
/// widget that reached into application state would invert the dependency the
/// plan fixes in section 6.3. Feature slices resolve their own permission and
/// pass the boolean down.
class AppPermissionGate extends StatelessWidget {
  const AppPermissionGate({
    required this.hasPermission,
    required this.child,
    this.fallback = const SizedBox.shrink(),
    super.key,
  });

  /// The caller's answer: show [child] when `true`, [fallback] when `false`.
  final bool hasPermission;

  /// What only permitted callers may see.
  final Widget child;

  /// What everybody sees: quiet by default, so a denied screen never looks
  /// like an error.
  final Widget fallback;

  @override
  Widget build(BuildContext context) {
    return hasPermission ? child : fallback;
  }
}
