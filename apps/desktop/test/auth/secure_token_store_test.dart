import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/auth/keystore.dart';
import 'package:my_shop_desktop/core/auth/secure_token_store.dart';

import 'auth_test_harness.dart';

/// The governing acceptance (§13.6, §6.10): a token is never written outside
/// secure storage, and a keystore that cannot honestly answer does not hand
/// back a session.
void main() {
  group('SecureTokenStore (AC-1)', () {
    test('save and read round-trip through the keystore only', () async {
      final RecordingKeystore keystore = RecordingKeystore();
      final SecureTokenStore store = SecureTokenStore(keystore);

      expect(
        await store.read(),
        isNull,
        reason: 'an empty keystore holds no session',
      );

      await store.save(
        StoredTokens(
          accessToken: testAccessToken,
          refreshToken: testRefreshToken,
          accessExpiresAtDevice: DateTime.now().add(const Duration(hours: 1)),
        ),
      );

      // Exactly one keystore write happened, under exactly one key.
      expect(keystore.written.keys.single, 'auth.access_token');
      // And the reading side gets the record back only through that key.
      final StoredTokens? tokens = await store.read();
      expect(tokens?.accessToken, testAccessToken);
      expect(tokens?.refreshToken, testRefreshToken);
    });

    test('clear removes every token byte from the keystore', () async {
      final RecordingKeystore keystore = RecordingKeystore();
      final SecureTokenStore store = SecureTokenStore(keystore);
      await store.save(
        StoredTokens(
          accessToken: testAccessToken,
          refreshToken: testRefreshToken,
          accessExpiresAtDevice: DateTime.now(),
        ),
      );

      await store.clear();

      expect(keystore.deleted, <String>['auth.access_token']);
      expect(await store.read(), isNull);
    });

    test(
      'a corrupted record is refused, wiped, and never handed back',
      () async {
        final RecordingKeystore keystore = RecordingKeystore(
          initiallyHeld: <String, String>{
            'auth.access_token': 'not json at all',
          },
        );
        final SecureTokenStore store = SecureTokenStore(keystore);

        await expectLater(
          store.read(),
          throwsA(isA<SecureKeystoreException>()),
        );
        // Fail-closed with hygiene: the uncontrolled record was deleted.
        expect(keystore.deleted, contains('auth.access_token'));

        // A malform-ed *shape* is the same refusal.
        final RecordingKeystore shapeless = RecordingKeystore(
          initiallyHeld: <String, String>{
            'auth.access_token': jsonEncode(<String, Object?>{
              'accessToken': testAccessToken,
              // refreshToken missing: a torn write's honest shape.
            }),
          },
        );
        final SecureTokenStore second = SecureTokenStore(shapeless);
        await expectLater(
          second.read(),
          throwsA(isA<SecureKeystoreException>()),
        );
        expect(shapeless.deleted, contains('auth.access_token'));
      },
    );

    test(
      'a failing keystore propagates its failure on every operation',
      () async {
        final RecordingKeystore keystore = RecordingKeystore()
          ..failReadKeys = <String>{'auth.access_token'}
          ..refuseWriteKeys = <String>{'auth.access_token'};
        final SecureTokenStore store = SecureTokenStore(keystore);

        await expectLater(
          store.save(
            StoredTokens(
              accessToken: testAccessToken,
              refreshToken: testRefreshToken,
              accessExpiresAtDevice: DateTime.now(),
            ),
          ),
          throwsA(isA<SecureKeystoreException>()),
        );
        await expectLater(
          store.read(),
          throwsA(isA<SecureKeystoreException>()),
        );
        // No value survived, nowhere.
        expect(keystore.written, isEmpty);
      },
    );
  });
}
