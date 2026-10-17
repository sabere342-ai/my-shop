import 'package:flutter/material.dart';

/// Master Plan section 6.9 colour roles.
///
/// This palette is the only place a colour literal exists in the client:
/// `tool/ci/design-system-check.mjs` fails the build on `Colors.*` or
/// `Color(0x...)` anywhere in `apps/desktop/lib` outside `lib/core/ui`, so every
/// surface, control and state in the app composes from these tokens.
///
/// The seven roles named by section 6.9 (`surface`, `onSurface`, `primary`,
/// `success`, `warning`, `danger`, `disabled`) are the contract. `onPrimary`,
/// `outline` and `surfaceRaised` are the three companions a control system
/// cannot be composed without: text on a filled button, borders for fields and
/// dividers, and the raised white plane an input or card sits on.
abstract final class AppColors {
  /// The page canvas every screen is painted on.
  static const Color surface = Color(0xFFF4F6F8);

  /// The raised plane: inputs, sheets, cards and menus.
  static const Color surfaceRaised = Color(0xFFFFFFFF);

  /// Text, icons and glyphs painted on [surface].
  static const Color onSurface = Color(0xFF16181D);

  /// Borders for fields, dividers and quiet separations.
  static const Color outline = Color(0xFFD5D9DE);

  /// The brand action: filled buttons, active navigation, focus rings.
  static const Color primary = Color(0xFF0B4F9E);

  /// Text and glyphs painted on a filled [primary] or [danger] surface.
  static const Color onPrimary = Color(0xFFFFFFFF);

  /// Positive confirmation: a completed sync, a healthy state.
  static const Color success = Color(0xFF137333);

  /// Attention without failure: low stock, a pending review.
  static const Color warning = Color(0xFF9A5B00);

  /// Failure and destruction: error states, validation, danger buttons.
  static const Color danger = Color(0xFFB3261E);

  /// Disabled controls and read-only affordances.
  static const Color disabled = Color(0xFF9AA0A6);
}
