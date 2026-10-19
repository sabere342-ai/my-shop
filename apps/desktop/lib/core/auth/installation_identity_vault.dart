/// The device installation vault — M2-S5's deferred client half
/// (§12.1, §12.3, §12.5), delivered by M2-S7.
///
/// §12.3: the installation carries an identity of two keystore-held values:
/// the **handle** (`installation_id`, the org-scoped address every
/// re-registration looks up) and the **credential** (`installation_secret`,
/// the high-entropy proof-of-possession whose *digest alone* the server
/// stores). §13.6: neither value may live anywhere but the platform keystore,
/// and neither is a secret in the credential sense once generated — but the
/// credential only ever leaves the device as the server's digest input, never
/// into a log, a test output, or an error (M2-S5 AC-10, §13.6).
///
/// [InstallationIdentityVault.ensure] generates both once per installation
/// and re-poses them afterwards: "re-presenting the same pair is an
/// idempotent re-registration, never a duplicate" (§12.1, M2-S5 AC-03).
library;

import 'dart:convert';
import 'dart:math';

import 'package:my_shop_desktop/core/auth/keystore.dart';
import 'package:my_shop_desktop/core/offline/outbox/uuid_v7.dart';

/// The §12.5 handle generator; injectable for deterministic tests.
typedef StringUuidV7 = String Function();

/// The two keystore values this module owns.
enum InstallationVaultKey {
  installationId('auth.installation_id'),
  installationSecret('auth.installation_secret');

  const InstallationVaultKey(this.value);

  final String value;
}

/// A generated installation identity, as the device contract expects it.
class InstallationIdentity {
  const InstallationIdentity({
    required this.installationId,
    required this.installationSecret,
  });

  /// §12.5 `installation_id`: stable per installation, org-scoped at the
  /// server. A unique suffix-free UUID so the server's `@IsUUID` accepts it
  /// and so it leaks no generation algorithm details on the wire.
  final String installationId;

  /// §12.3 credential: 256 bits of `Random.secure()` entropy, base64url —
  /// 43 characters, comfortably above the contract's 32-character floor.
  final String installationSecret;
}

/// The keystore-held installation identity, created once per install.
class InstallationIdentityVault {
  InstallationIdentityVault(
    this._keystore, {
    Random? random,
    StringUuidV7? newId,
  }) : _random = random ?? Random.secure(),
       _newId = newId ?? (() => generateUuidV7());

  static const int _secretBits = 256;

  final Keystore _keystore;
  final Random _random;
  final StringUuidV7 _newId;

  /// Returns the installation identity held in the keystore.
  ///
  /// A platform failure propagates (the session layer fails closed); a
  /// missing identity is **generated and stored**, so the first successful
  /// call after a wipe enrolls a new installation — this is exactly the
  /// §12.2 rule "re-installation enrolls a new installation id" applied to a
  /// wiped keystore: the old server-side row (if any) is orphaned by design
  /// and quarantined by the server's revocation machinery (§12.5).
  Future<InstallationIdentity> ensure() async {
    final String? existingId = await _keystore.read(
      InstallationVaultKey.installationId.value,
    );
    final String? existingSecret = await _keystore.read(
      InstallationVaultKey.installationSecret.value,
    );

    if (existingId != null && existingSecret != null) {
      return _validated(existingId, existingSecret);
    }

    // One half missing is as bad as both: an identity the device cannot
    // re-prove would let a re-registration fail server-side with a digest
    // mismatch. Wipe the fragments and enroll fresh, through the same path
    // the corrupted-value branch uses.
    if (existingId != null || existingSecret != null) {
      return _regenerate();
    }

    return _regenerate();
  }

  /// Clears the identity (a device reset. The server keeps its digest row —
  /// §12.5's record survives locally.)
  Future<void> clear() async {
    await _deleteBestEffort(InstallationVaultKey.installationId);
    await _deleteBestEffort(InstallationVaultKey.installationSecret);
  }

  Future<InstallationIdentity> _validated(String id, String secret) async {
    if (id.isNotEmpty && secret.isNotEmpty) {
      return InstallationIdentity(
        installationId: id,
        installationSecret: secret,
      );
    }
    // Generated values are never empty; a stored empty value means the
    // record was tampered with (§13.4) and the fragments are unusable. The
    // honest recovery is the wipe-and-regenerate path the missing-identity
    // branch already takes.
    return _regenerate();
  }

  Future<InstallationIdentity> _regenerate() async {
    await _deleteBestEffort(InstallationVaultKey.installationId);
    await _deleteBestEffort(InstallationVaultKey.installationSecret);
    final InstallationIdentity generated = InstallationIdentity(
      installationId: _newId(),
      installationSecret: _generateSecret(),
    );
    await _keystore.write(
      InstallationVaultKey.installationId.value,
      generated.installationId,
    );
    await _keystore.write(
      InstallationVaultKey.installationSecret.value,
      generated.installationSecret,
    );
    return generated;
  }

  String _generateSecret() {
    final List<int> bytes = List<int>.generate(
      _secretBits ~/ 8,
      (_) => _random.nextInt(256),
    );
    return base64Url.encode(bytes).replaceAll('=', '');
  }

  Future<void> _deleteBestEffort(InstallationVaultKey key) async {
    try {
      await _keystore.delete(key.value);
    } on SecureKeystoreException {
      // A failing keystore stays failing; the next [ensure] re-tries the
      // coherent path. No value material is echoed anywhere (§13.6).
    }
  }
}
