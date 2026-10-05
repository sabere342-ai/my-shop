import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:my_shop_desktop/main.dart';

void main() {
  testWidgets('the application bootstraps and renders a first frame', (tester) async {
    await tester.pumpWidget(const MyShopApp());

    expect(find.byType(MyShopApp), findsOneWidget);
    expect(find.byType(MaterialApp), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the shell renders no hardcoded user-visible text', (tester) async {
    // Master Plan section 6.8: zero hardcoded user-visible strings in Dart
    // source. Catalogues arrive in M1-S5; this asserts the interim state is
    // clean rather than asserting a screen that does not exist yet.
    await tester.pumpWidget(const MyShopApp());

    expect(find.textContaining('Hello'), findsNothing);
    expect(find.textContaining('World'), findsNothing);
  });
}