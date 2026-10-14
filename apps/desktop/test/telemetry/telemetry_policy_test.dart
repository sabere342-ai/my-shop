import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/telemetry/telemetry_policy.dart';

// Master Plan §38.28.3 / §13.7. The central client telemetry value policy: the
// per-key rules the structured log and the metrics emitter both consume.

void main() {
  group('closedVocabularyValue', () {
    test('returns a member and refuses a non-member or a non-string', () {
      expect(closedVocabularyValue('PENDING', syncStateNames), 'PENDING');
      expect(closedVocabularyValue('NOPE', syncStateNames), isNull);
      expect(closedVocabularyValue(7, syncStateNames), isNull);
      expect(closedVocabularyValue(null, syncStateNames), isNull);
    });
  });

  group('boundedTokenValue', () {
    test('matches a bounded identifier and refuses a space or an over-long value', () {
      expect(boundedTokenValue('StateError', classTokenPattern), 'StateError');
      expect(boundedTokenValue('TRANSIENT', classTokenPattern), 'TRANSIENT');
      expect(boundedTokenValue('has space', classTokenPattern), isNull);
      expect(boundedTokenValue('1startsWithDigit', classTokenPattern), isNull);
      expect(boundedTokenValue('a' * 65, classTokenPattern), isNull);
      expect(boundedTokenValue(1, classTokenPattern), isNull);
    });

    test('the upper-code pattern refuses a lowercase or hyphenated value', () {
      expect(boundedTokenValue('MISSING_OUTCOME', upperCodePattern), 'MISSING_OUTCOME');
      expect(boundedTokenValue('lowercase', upperCodePattern), isNull);
      expect(boundedTokenValue('HAS-HYPHEN', upperCodePattern), isNull);
    });
  });

  group('nonNegativeIntValue', () {
    test('accepts a non-negative int and refuses everything else', () {
      expect(nonNegativeIntValue(0), 0);
      expect(nonNegativeIntValue(5), 5);
      expect(nonNegativeIntValue(-1), isNull);
      expect(nonNegativeIntValue(1.5), isNull);
      expect(nonNegativeIntValue('1'), isNull);
    });
  });

  group('finiteNonNegativeNumberValue', () {
    test('accepts a finite non-negative int or double', () {
      expect(finiteNonNegativeNumberValue(0), 0);
      expect(finiteNonNegativeNumberValue(12.5), 12.5);
    });

    test('refuses a negative, a NaN, an infinity, and a non-number', () {
      expect(finiteNonNegativeNumberValue(-1), isNull);
      expect(finiteNonNegativeNumberValue(double.nan), isNull);
      expect(finiteNonNegativeNumberValue(double.infinity), isNull);
      expect(finiteNonNegativeNumberValue('1'), isNull);
    });
  });

  group('the vocabularies are closed, bounded sets', () {
    test('every member is a plain identifier', () {
      for (final Set<String> vocabulary in <Set<String>>[
        syncStateNames,
        mutationOutcomeNames,
        pushRunFaultNames,
        operationNames,
        reachabilityFailureKindNames,
        logComponentNames,
        logReasonNames,
      ]) {
        expect(vocabulary, isNotEmpty);
        for (final String value in vocabulary) {
          expect(value, matches(r'^[A-Za-z][A-Za-z0-9_]*$'), reason: 'unsafe vocabulary value');
        }
      }
    });
  });
}
