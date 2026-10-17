import 'package:flutter/widgets.dart';

/// Master Plan section 6.9: the corner-radius scale.
abstract final class AppRadius {
  /// Tight rounding for small controls and tags.
  static const double small = 4;

  /// The default rounding for buttons, fields and menus.
  static const double medium = 8;

  /// Rounding for dialogs, sheets and cards.
  static const double large = 16;

  /// Fully rounded ends for chips and pills.
  static const double pill = 999;

  /// [small] as a ready-made [BorderRadius].
  static const BorderRadius smallBox = BorderRadius.all(Radius.circular(small));

  /// [medium] as a ready-made [BorderRadius].
  static const BorderRadius mediumBox = BorderRadius.all(Radius.circular(medium));

  /// [large] as a ready-made [BorderRadius].
  static const BorderRadius largeBox = BorderRadius.all(Radius.circular(large));

  /// [pill] as a ready-made [BorderRadius].
  static const BorderRadius pillBox = BorderRadius.all(Radius.circular(pill));
}
