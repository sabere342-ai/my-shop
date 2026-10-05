import 'package:flutter/material.dart';

/// My Shop client entry point.
///
/// Master Plan section 6.2 fixes the layout, and this file is the `app/`
/// bootstrap layer: it owns process start and nothing else. Routing is
/// `go_router` and state is Riverpod (sections 6.4 and 6.6), both of which
/// arrive with their wiring in M1-S5. They are deliberately not stubbed here,
/// because a stubbed provider graph invites code written against a shape that
/// does not exist yet.
///
/// The widget below renders a placeholder with no user-visible string. Master
/// Plan section 6.8 forbids hardcoded user-visible text in Dart source,
/// enforced by a CI grep gate, and Arabic catalogues arrive in M1-S5. An empty
/// shell that satisfies the gate honestly beats a "Hello World" that would have
/// to be deleted.
void main() {
  runApp(const MyShopApp());
}

class MyShopApp extends StatelessWidget {
  const MyShopApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(body: SizedBox.shrink()),
    );
  }
}