import 'package:flutter/material.dart';

/// Master Plan section 6.9 type scale.
///
/// Five steps, each a named token. `tool/ci/design-system-check.mjs` fails the
/// build on `fontSize:` anywhere in `apps/desktop/lib` outside `lib/core/ui`,
/// so every text style in the client is one of these steps or a
/// `Theme.of(context).textTheme` slot that this scale fills.
abstract final class AppTypography {
  /// The family the whole scale requests.
  ///
  /// On device the engine resolves it against the platform (Roboto on Android,
  /// the system fallback on Windows). `flutter test` loads no fonts at all, so
  /// the golden harness registers the committed fixture under this exact name;
  /// one family name keeps production rendering and golden rendering on the
  /// same request path.
  static const String fontFamily = 'Roboto';

  /// Screen and empty-state headings. 32.
  static const TextStyle display = TextStyle(
    fontFamily: fontFamily,
    fontSize: 32,
    fontWeight: FontWeight.w700,
    height: 1.25,
  );

  /// Section and dialog titles. 20.
  static const TextStyle title = TextStyle(
    fontFamily: fontFamily,
    fontSize: 20,
    fontWeight: FontWeight.w600,
    height: 1.3,
  );

  /// Body copy and field values. 16.
  static const TextStyle body = TextStyle(
    fontFamily: fontFamily,
    fontSize: 16,
    fontWeight: FontWeight.w400,
    height: 1.5,
  );

  /// Controls: buttons, labels, section headers. 14.
  static const TextStyle label = TextStyle(
    fontFamily: fontFamily,
    fontSize: 14,
    fontWeight: FontWeight.w600,
    height: 1.4,
  );

  /// Hints, metadata and captions. 12.
  static const TextStyle caption = TextStyle(
    fontFamily: fontFamily,
    fontSize: 12,
    fontWeight: FontWeight.w400,
    height: 1.4,
  );
}
