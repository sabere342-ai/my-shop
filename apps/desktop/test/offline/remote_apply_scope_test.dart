import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/outbox/remote_apply_scope.dart';

// Master Plan §38.12.1, §40.5 (M1b-S7): the suppression context is the
// structural half of loop prevention. It must be ambient (so no second outbox
// instance can bypass it), nested-safe (depth, not a boolean), and impossible to
// leak on any exit path.
void main() {
  group('RemoteApplyScope context semantics (§38.12.1)', () {
    test('is inactive at rest', () {
      expect(RemoteApplyScope.isActive, isFalse);
      expect(RemoteApplyScope.currentDepth, 0);
    });

    test('run activates the context and clears it on completion', () async {
      late bool inside;
      late int depthInside;
      await RemoteApplyScope.run(() async {
        inside = RemoteApplyScope.isActive;
        depthInside = RemoteApplyScope.currentDepth;
      });

      expect(inside, isTrue);
      expect(depthInside, 1);
      expect(RemoteApplyScope.isActive, isFalse,
          reason: 'the context must not survive the call');
      expect(RemoteApplyScope.currentDepth, 0);
    });

    test('the context does not leak when the body throws', () async {
      await expectLater(
        RemoteApplyScope.run(() async => throw StateError('boom')),
        throwsStateError,
      );
      expect(RemoteApplyScope.isActive, isFalse,
          reason: 'exception-safe cleanup is a §5.2 requirement');
      expect(RemoteApplyScope.currentDepth, 0);
    });

    test('sequential calls do not inherit a stale context', () async {
      await RemoteApplyScope.run(() async {});
      expect(RemoteApplyScope.isActive, isFalse);

      await RemoteApplyScope.run(() async {
        expect(RemoteApplyScope.currentDepth, 1,
            reason: 'a fresh call starts at depth 1, not at a residue');
      });
      expect(RemoteApplyScope.isActive, isFalse);
    });

    test('nested calls increase depth and restore the parent depth', () async {
      await RemoteApplyScope.run(() async {
        expect(RemoteApplyScope.currentDepth, 1);
        await RemoteApplyScope.run(() async {
          expect(RemoteApplyScope.currentDepth, 2);
          expect(RemoteApplyScope.isActive, isTrue);
        });
        expect(RemoteApplyScope.currentDepth, 1,
            reason: 'the child completing must not clear the parent context');
        expect(RemoteApplyScope.isActive, isTrue);
      });
      expect(RemoteApplyScope.isActive, isFalse);
    });

    test('work registered outside a scope is not suppressed', () async {
      // The delayed future captures the root zone at registration; it must not
      // observe the suppression even while a scope is running.
      final Future<int> outside =
          Future<int>.delayed(Duration.zero, () => RemoteApplyScope.currentDepth);
      await RemoteApplyScope.run(() async {
        await Future<void>.delayed(Duration.zero);
      });
      expect(await outside, 0,
          reason: 'suppression is zone-scoped, never global');
    });
  });
}
