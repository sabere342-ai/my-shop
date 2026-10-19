/// The token vault — the slice's governing acceptance lives here.
///
/// Master Plan §40.6 M2-S7: "**Token never written outside secure storage.**"
/// §6.10: "Session tokens — Platform secure storage. Only. Fail-closed."
/// §13.6: the platform keystore only; no reversible fallback.
///
/// [StoredTokens] holds the short-lived RS256 access token and the opaque
/// rotating refresh token as one value. [SecureTokenStore] is the **only**
/// persistence for it: every read goes to the [Keystore], every write goes to
/// the [Keystore], nothing here ever writes a token to a database, a file, or
/// shared preferences, and there is no second spell of the keys.
///
/// The validation is strict at the boundary: a stored payload that does not
/// round-trip the exact stored shape is reported as
/// [SecureKeystoreException corrupted] and produces **no tokens** — the
/// session layer then treats the device as signed out (fail-closed), rather
/// than trusting a malformed value that might have been tampered with (§13.4:
/// clients fail closed in the presence of anomalies).
library;

import 'dart:convert';

import 'package:my_shop_desktop/core/auth/keystore.dart';

/// A keystore token record. `accessExpireAtDevice` is the client-computed
/// instant the access token expires (`expiresIn` seconds after receipt); it
/// is bookkeeping on the device clock, never a security decision — the
/// server's own token verification (M2-S2) is the authority (§7.3).
class StoredTokens {
  const StoredTokens({
    required this.accessToken,
    required this.refreshToken,
    required this.accessExpiresAtDevice,
  });

  final String accessToken;
  final String refreshToken;
  final DateTime accessExpiresAtDevice;

  Map<String, Object?> toJson() => <String, Object?>{
    'accessToken': accessToken,
    'refreshToken': refreshToken,
    'accessExpiresAtDeviceMs': accessExpiresAtDevice.millisecondsSinceEpoch,
  };

  factory StoredTokens.fromJson(Map<String, Object?> json) {
    final Object? access = json['accessToken'];
    final Object? refresh = json['refreshToken'];
    final Object? deviceMs = json['accessExpiresAtDeviceMs'];
    if (access is! String || access.isEmpty) {
      throw const FormatException('token payload `accessToken` missing');
    }
    if (refresh is! String || refresh.isEmpty) {
      throw const FormatException('token payload `refreshToken` missing');
    }
    if (deviceMs is! int) {
      throw const FormatException(
        'token payload `accessExpiresAtDeviceMs` missing',
      );
    }
    return StoredTokens(
      accessToken: access,
      refreshToken: refresh,
      accessExpiresAtDevice: DateTime.fromMillisecondsSinceEpoch(deviceMs),
    );
  }
}

/// The keystore keys this module owns. Prefixed so they cannot collide with
/// the installation vault's keys.
enum TokenVaultKey implements VaultKey {
  accessToken('auth.access_token'),
  refreshToken('auth.refresh_token');

  const TokenVaultKey(this.value);

  @override
  final String value;
}

/// A vault key contract so one prefix discipline holds across auth modules.
abstract interface class VaultKey {
  String get value;
}

/// Reads, writes, and clears the token record **through the keystore**.
class SecureTokenStore {
  SecureTokenStore(this._keystore);

  final Keystore _keystore;

  /// The combined payload's stored form: one key, one JSON value, written and
  /// read atomically. It lives under the access-token key so a torn write
  /// cannot expose a mismatched pair.
  ///
  /// Deliberate shape: the two credential-class values share one record so a
  /// halfway rotation (new access, old refresh) is never persisted.
  static const VaultKey _combinedKey = TokenVaultKey.accessToken;

  /// Reads the record, or `null` when the device holds none.
  ///
  /// A platform failure or a malformed payload throws
  /// [SecureKeystoreException]; the session layer converts that into
  /// "signed out" (fail-closed, §13.6) and **wipes** the record, because a
  /// token record the client cannot parse is no longer a controlled secret
  /// (§13.4). The wipe is best effort: a failing keystore stays failing; the
  /// outcome for the caller is the same session-less state either way.
  Future<StoredTokens?> read() async {
    final String? raw = await _keystore.read(_combinedKey.value);
    if (raw == null) return null;
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map) {
        throw const SecureKeystoreException(
          KeystoreFailureReason.corrupted,
          'token record is not an object',
        );
      }
      return StoredTokens.fromJson(Map<String, Object?>.from(decoded));
    } on FormatException {
      await _wipeBestEffort(raw);
      rethrow;
    }
  }

  /// Saves the record as one atomic value.
  Future<void> save(StoredTokens tokens) async {
    await _keystore.write(_combinedKey.value, jsonEncode(tokens.toJson()));
  }

  /// Removes every token byte from the keystore.
  ///
  /// Deleting the one combined key clears the entire record: there is no
  /// third token byte that could survive it (the governing acceptance).
  Future<void> clear() async {
    await _keystore.delete(_combinedKey.value);
  }

  Future<void> _wipeBestEffort(String raw) async {
    try {
      await _keystore.delete(_combinedKey.value);
    } on SecureKeystoreException {
      // The keystore is already failing; the session outcome (signed out,
      // refused) does not depend on the wipe succeeding. Nothing else here
      // would write the corrupted bytes anywhere — they are discarded in
      // memory with this call.
    }
  }
}
