import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/auth/snapshot_grace_verifier.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_record.dart';

import 'auth_test_harness.dart';

DateTime momentsFromNow(int secondsFromNow) =>
    DateTime.now().toUtc().add(Duration(seconds: secondsFromNow));

/// The verifier's rejection matrix (AC-6, §38.16.3, §38.17, M1b-S8 D-2).
///
/// One canonical valid snapshot is minted; every other case changes exactly
/// one fact, so each refusal is attributable.
void main() {
  final SnapshotTestAuthority authority = SnapshotTestAuthority.instance;

  SnapshotBackedGraceSignatureVerifier honestVerifier() =>
      SnapshotBackedGraceSignatureVerifier(
        RsaSignedSnapshotVerifier(publicKeyPemSpki: authority.spkiPem),
      );

  /// Rebuilds a record by hand so mutants hold whatever dishonest field the
  /// case needs (the record itself carries no mutation surface: signed
  /// material is value-shaped).
  OfflineGraceRecord rebuild(
    String snapshot, {
    String? userId,
    String? organizationId,
    String? deviceId,
    List<String>? permissions,
    int? permissionsVersion,
  }) {
    final SnapshotBackedGraceSignatureVerifier verifier = honestVerifier();
    final OfflineGraceRecord honest = verifier.recordFrom(
      snapshot: snapshot,
      deviceId: testDeviceId,
    )!;
    return OfflineGraceRecord(
      userId: userId ?? honest.userId,
      organizationId: organizationId ?? honest.organizationId,
      deviceId: deviceId ?? honest.deviceId,
      permissions: permissions ?? honest.permissions,
      permissionsVersion: permissionsVersion ?? honest.permissionsVersion,
      issuedAt: honest.issuedAt,
      expiresAt: honest.expiresAt,
      signature: snapshot,
    );
  }

  group('RsaSignedSnapshotVerifier', () {
    test('accepts a well-formed, in-window owner-legal snapshot', () {
      final SnapshotBackedGraceSignatureVerifier verifier = honestVerifier();

      final OfflineGraceRecord? built = verifier.recordFrom(
        snapshot: authority.mint(),
        deviceId: testDeviceId,
      );

      expect(built, isNotNull);
      expect(built?.userId, testUserId);
      expect(built?.organizationId, testOrganizationId);
      expect(
        built?.deviceId,
        testDeviceId,
        reason: 'the device fact is the server-issued bound id',
      );
      expect(
        verifier.verify(built!),
        isTrue,
        reason: 'the built record verifies against its own signature',
      );
    });

    test(
      'refuses every record when no key is deployed (no accepting default)',
      () {
        final SnapshotBackedGraceSignatureVerifier verifier =
            SnapshotBackedGraceSignatureVerifier(
              RsaSignedSnapshotVerifier(publicKeyPemSpki: null),
            );
        final RsaSignedSnapshotVerifier bare = RsaSignedSnapshotVerifier();

        expect(
          verifier.recordFrom(
            snapshot: authority.mint(),
            deviceId: testDeviceId,
          ),
          isNull,
        );
        expect(bare.signedFacts(authority.mint(), DateTime.now()), isNull);
        expect(verifier.verify(rebuild(authority.mint())), isFalse);
      },
    );

    test('refuses a tampered payload under a genuine header and signature', () {
      final SnapshotBackedGraceSignatureVerifier verifier = honestVerifier();
      final String tampered = tamperedPayload(authority.mint());

      expect(
        verifier.recordFrom(snapshot: tampered, deviceId: testDeviceId),
        isNull,
      );
    });

    test('refuses a snapshot signed by a foreign key', () {
      final SnapshotBackedGraceSignatureVerifier verifier =
          SnapshotBackedGraceSignatureVerifier(
            RsaSignedSnapshotVerifier(
              publicKeyPemSpki: SnapshotTestAuthority.foreign().spkiPem,
            ),
          );

      expect(
        verifier.recordFrom(snapshot: authority.mint(), deviceId: testDeviceId),
        isNull,
      );
    });

    test('refuses an unpinned or absent algorithm header', () {
      final SnapshotBackedGraceSignatureVerifier verifier = honestVerifier();

      expect(
        verifier.recordFrom(
          snapshot: authority.mint(corruptHeader: 'none'),
          deviceId: testDeviceId,
        ),
        isNull,
      );
      expect(
        verifier.recordFrom(
          snapshot: authority.mint(corruptHeader: 'HS256'),
          deviceId: testDeviceId,
        ),
        isNull,
      );
    });

    test('refuses a wrong issuer or audience', () {
      final SnapshotBackedGraceSignatureVerifier verifier = honestVerifier();

      expect(
        verifier.recordFrom(
          snapshot: authority.mint(iss: 'other-shop'),
          deviceId: testDeviceId,
        ),
        isNull,
      );
      expect(
        verifier.recordFrom(
          snapshot: authority.mint(aud: 'my-shop:other-surface'),
          deviceId: testDeviceId,
        ),
        isNull,
      );
    });

    test(
      'refuses an expired snapshot and one issued too far in the future',
      () {
        final SnapshotBackedGraceSignatureVerifier verifier = honestVerifier();

        expect(
          verifier.recordFrom(
            snapshot: authority.mint(expiresAt: momentsFromNow(-1)),
            deviceId: testDeviceId,
          ),
          isNull,
        );
        expect(
          verifier.recordFrom(
            snapshot: authority.mint(issuedAt: momentsFromNow(60 * 20)),
            deviceId: testDeviceId,
          ),
          isNull,
        );
      },
    );

    test('upholds the owner-exclusivity structural rule (§38.17)', () {
      final SnapshotBackedGraceSignatureVerifier verifier = honestVerifier();

      expect(
        verifier.recordFrom(
          snapshot: authority.mint(
            owner: false,
            perms: const <String>['sales.create', 'accounting.journal.post'],
          ),
          deviceId: testDeviceId,
        ),
        isNull,
        reason: 'a non-owner snapshot can never carry the owner-exclusive id',
      );
      // The owner *may* carry it.
      expect(
        verifier.recordFrom(
          snapshot: authority.mint(
            owner: true,
            perms: const <String>['sales.create', 'accounting.journal.post'],
          ),
          deviceId: testDeviceId,
        ),
        isNotNull,
      );
    });

    test('refuses a record whose fields disagree with the signed claims', () {
      final SnapshotBackedGraceSignatureVerifier verifier = honestVerifier();
      final String snapshot = authority.mint();

      expect(
        verifier.verify(
          rebuild(snapshot, organizationId: testSecondOrganizationId),
        ),
        isFalse,
        reason: 'a swapped org is not what was signed',
      );
      expect(
        verifier.verify(rebuild(snapshot, userId: 'someone-else')),
        isFalse,
      );
      expect(
        verifier.verify(
          rebuild(
            snapshot,
            permissions: const <String>['sales.create', 'users.manage'],
          ),
        ),
        isFalse,
        reason: 'an unsigned privilege inflation is refused',
      );
      expect(
        verifier.verify(rebuild(snapshot, deviceId: '')),
        isFalse,
        reason: 'no device fact, no record',
      );
    });

    test(
      'a foreign-key deployment verifies nothing, even well-formed material',
      () {
        final SnapshotBackedGraceSignatureVerifier verifier =
            SnapshotBackedGraceSignatureVerifier(
              RsaSignedSnapshotVerifier(
                publicKeyPemSpki: SnapshotTestAuthority.foreign().spkiPem,
              ),
            );
        final String snapshot = authority.mint();

        expect(
          verifier.recordFrom(snapshot: snapshot, deviceId: testDeviceId),
          isNull,
        );
        expect(verifier.verify(rebuild(snapshot)), isFalse);
      },
    );
  });
}

/// Rewrites one claim in the payload segment without re-signing: the attack
/// shape the matrix exists for. Same algorithm, same signer (header untouched),
/// new payload bytes the signature no longer covers.
String tamperedPayload(String jws) {
  final List<String> segments = jws.split('.');
  final String decoded = utf8.decode(decodeUrl(segments[1]));
  final Map<String, Object?> claims = (jsonDecode(decoded) as Map)
      .cast<String, Object?>();
  claims['org'] = testSecondOrganizationId;
  return '${segments[0]}.${base64UrlNoPadding(utf8.encode(jsonEncode(claims)))}.${segments[2]}';
}

Uint8List decodeUrl(String segment) {
  final String padded = segment.padRight(
    segment.length + (4 - segment.length % 4) % 4,
    '=',
  );
  return base64Url.decode(padded);
}

String base64UrlNoPadding(List<int> bytes) {
  final String encoded = base64Url.encode(bytes);
  return encoded.replaceAll('=', '');
}
