import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/telemetry/error_class.dart';

import 'telemetry_test_harness.dart';

// Master Plan §38.28.3. `errorClassOf` is the replacement for a dynamic
// `error.toString()`: it reads only the runtime type and sanitises it to a
// short identifier. The message, the stack, and any nested cause are never read,
// so a connection string or a token that arrives in an error message can never
// reach a log line.

/// A class whose own `toString()` throws. If `errorClassOf` ever called the
/// object's `toString()` — as the old seam did — this test would fail.
class _HostileToString {
  @override
  String toString() => throw StateError('toString must never be called: $connectionCanary');
}

void main() {
  group('errorClassOf', () {
    test('returns the runtime type name of a normal error', () {
      expect(errorClassOf(const FormatException('bad input')), 'FormatException');
      expect(errorClassOf(StateError('nope')), 'StateError');
      expect(errorClassOf(const _TimeoutException()), '_TimeoutException');
    });

    test('reports null as "null"', () {
      expect(errorClassOf(null), 'null');
    });

    test('reports a runtime type that is not a plain identifier as "Object"', () {
      // A generic, a collection, a record, and a closure all stringify to a
      // shape that is not a bare identifier, so none is allowed through.
      expect(errorClassOf(<String, Object?>{}), 'Object');
      expect(errorClassOf(<int>[1, 2]), 'Object');
      expect(errorClassOf(() => 0), 'Object');
    });

    test('never reads the message, the toString, or a cause', () {
      // The object's own `toString()` throws; a message-based classifier would
      // throw here, and the canary must never be observable.
      expect(errorClassOf(_HostileToString()), '_HostileToString');
      expect(
        errorClassOf(const FormatException(connectionCanary)).toString(),
        isNot(contains(connectionCanary)),
      );
      expect(errorClassOf(tokenCanary), 'String');
    });

    test('the emitted name is bounded by the declared maximum', () {
      expect(maxErrorClassNameLength, 64);
      for (final Object? value in <Object?>[
        const FormatException('x'),
        StateError('y'),
        null,
        <int>[1],
      ]) {
        expect(errorClassOf(value).length, lessThanOrEqualTo(maxErrorClassNameLength));
      }
    });
  });
}

/// A private type with a name that is a plain identifier, so the assertion does
/// not depend on a `dart:core` class name that might change.
class _TimeoutException implements Exception {
  const _TimeoutException();
}
