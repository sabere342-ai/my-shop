/// A run-based responsive arrangement for the settings field blocks (mission
/// §5's responsive layout requirement).
///
/// One honest implementation instead of two hand-maintained trees: on a wide
/// Windows surface the blocks flow two at a time (each at most half the
/// width), on a narrow Android surface they stack one per row. `Wrap` does
/// the flowing, so no layout code reads the direction — the arrangement
/// mirrors under Arabic by construction (§6.8's bidi gate).
library;

import 'package:flutter/material.dart';

/// The width above which two field blocks share a row.
const double settingsWideBreakpoint = 720;

/// The children flow left-to-start, at most [maxPerRow] per line on widest
/// paintings; every block ends flush, and the spacing scale stays 8-point.
class ResponsiveFieldGrid extends StatelessWidget {
  const ResponsiveFieldGrid({
    required this.blocks,
    this.perRowWidescreen = 2,
    super.key,
  });

  /// The settings field blocks.
  final List<Widget> blocks;

  /// How many blocks one row may carry on a wide surface.
  final int perRowWidescreen;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double width = constraints.maxWidth;
        final bool wide = width >= settingsWideBreakpoint;
        final double blockWidth = wide
            ? (width / perRowWidescreen) - 24
            : width;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            for (int index = 0; index < blocks.length; index += (wide ? perRowWidescreen : 1))
              _Row(
                blockWidth: blockWidth,
                children: blocks.sublist(
                  index,
                  (index + (wide ? perRowWidescreen : 1)).clamp(0, blocks.length),
                ),
              ),
          ],
        );
      },
    );
  }
}

final class _Row extends StatelessWidget {
  const _Row({required this.children, required this.blockWidth});

  final List<Widget> children;
  final double blockWidth;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          for (final Widget child in children)
            Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 4), child: child)),
        ],
      ),
    );
  }
}
