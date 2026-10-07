/// Master Plan section 6.9: an 8-point spacing scale.
///
/// Every gap, inset and control dimension in the client is a whole multiple of
/// [unit]; nothing invents a 5 or a 12.
abstract final class AppSpacing {
  /// The unit the scale is built on.
  static const double unit = 8;

  /// One unit: the gap between a control and its own label.
  static const double one = 8;

  /// Two units: padding inside a card, the gap between sibling controls.
  static const double two = 16;

  /// Three units: page padding.
  static const double three = 24;

  /// Four units: the gap between a screen title and its first section.
  static const double four = 32;

  /// Five units: default control height.
  static const double five = 40;

  /// Six units: the gap between major regions.
  static const double six = 48;

  /// The minimum height every button and field is laid out at (five units).
  static const double controlHeight = 40;

  /// The width dialogs and sheets are constrained to, so goldens and layouts
  /// do not depend on the host window.
  static const double panelWidth = 440;
}
