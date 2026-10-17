import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

/// Directory-level test configuration (Master Plan sections 6.9 and 36.3).
///
/// `flutter test` compares a rendered PNG against the committed golden byte for
/// byte. The goldens under `test/golden/goldens/` are produced on the
/// developer's host, while continuous integration runs the same suite on Linux;
/// the two engines rasterise Arabic glyph edges with sub-pixel differences that
/// are invisible to a reviewer but are still byte noise. A small tolerance
/// keeps the gate about the rendered design rather than about the host's
/// anti-aliasing. A real regression — a moved control, a wrong colour role, a
/// dropped catalog string — changes far more than [precisionTolerance] of the
/// pixels and still fails.
const double precisionTolerance = 0.01;

Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  goldenFileComparator = _TolerantGoldenFileComparator(
    Uri.parse('test/golden/design_system_golden_test.dart'),
    precisionTolerance: precisionTolerance,
  );
  await testMain();
}

/// A [LocalFileComparator] that accepts a bounded pixel difference.
///
/// It is the comparator the Flutter SDK documents for projects that need a
/// tolerance; the failure path still produces the standard diff images.
class _TolerantGoldenFileComparator extends LocalFileComparator {
  _TolerantGoldenFileComparator(
    super.testFile, {
    required double precisionTolerance,
  }) : assert(
         0 <= precisionTolerance && precisionTolerance <= 1,
         'precisionTolerance must be between 0 and 1',
       ),
       _precisionTolerance = precisionTolerance;

  /// The largest fraction of differing pixels treated as a match.
  final double _precisionTolerance;

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final ComparisonResult result = await GoldenFileComparator.compareLists(
      imageBytes,
      await getGoldenBytes(golden),
    );

    if (result.passed || result.diffPercent <= _precisionTolerance) {
      result.dispose();
      return true;
    }

    final String error = await generateFailureOutput(result, golden, basedir);
    result.dispose();
    throw FlutterError(error);
  }
}
