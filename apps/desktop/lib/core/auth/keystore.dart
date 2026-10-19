/// The platform-keystore seam — Master Plan §13.6, §6.10, §40.6 M2-S7.
///
/// §6.10 is categorical: "Session tokens — **Platform secure storage. Only.**
/// Fail-closed (§13.6)." This file is the only door between the client's
/// business code and where a token byte can live:
///
/// - The **port** ([Keystore]) is what business code depends on: read, write,
///   delete, by key. It does not know what a token is.
/// - The **adapter** ([FlutterSecureKeystore]) is the §13.6 platform keystore
///   via `flutter_secure_storage`: DPAPI-backed on Windows, the Android
///   keystore-backed encrypted storage on Android. It carries no plaintext
///   fallback and no second implementation — the legacy "XOR secure store /
///   PowerShell DPAPI shell-out" pattern (§5.4, `DO_NOT_COPY`) is exactly what
///   this adapter refuses to be.
///
/// Fail-closed behaviour is a composition rule, not an adapter trick: a lost
/// or unreadable keystore means *no session*, reported by the session layer —
/// never a degraded plaintext path. `SecureKeystoreException` is what the
/// adapter reports, with a reason class and **no value material in the
/// message** (§13.6 redaction).
library;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The platform-keystore port (§13.6).
abstract interface class Keystore {
  /// Reads one value, or `null` when absent.
  Future<String?> read(String key);

  /// Writes one value atomically.
  Future<void> write(String key, String value);

  /// Deletes one value. Deleting an absent key is not an error.
  Future<void> delete(String key);
}

/// Why a keystore operation failed, as one closed value. The reason is safe
/// for logs; no platform message, key name, or value rides with it (§13.6).
enum KeystoreFailureReason {
  /// The platform returned an error (locked, corrupted, unavailable).
  platformError,

  /// The stored bytes fail a shape check before they are trusted.
  corrupted,
}

/// The adapter's failure: what happened, never what was stored.
class SecureKeystoreException implements Exception {
  const SecureKeystoreException(this.reason, [this.diagnostic]);

  final KeystoreFailureReason reason;

  /// Short, credential-free context (e.g. `"read failed"`). Never a platform
  /// exception's message verbatim — those can embed stored material via
  /// key names and are never echoed (§13.6).
  final String? diagnostic;

  @override
  String toString() => 'SecureKeystoreException(${reason.name}, $diagnostic)';
}

/// The §13.6 adapter.
///
/// Windows and Android are the V1 targets (§6.1); both are supported by
/// `flutter_secure_storage` natively. The v11 defaults are the sanctioned
/// path for both: the Android options are KeyStore-backed AES-GCM (the
/// v10-era `encryptedSharedPreferences` mode was retired in v11), and the
/// Windows options are DPAPI-backed. No platform toggle here can produce a
/// plaintext fallback — that guarantee lives in the adapter's contract, not
/// in an option.
class FlutterSecureKeystore implements Keystore {
  FlutterSecureKeystore() : _storage = _defaultStorage;

  static const FlutterSecureStorage _defaultStorage = FlutterSecureStorage(
    aOptions: AndroidOptions(),
    wOptions: WindowsOptions(),
  );

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) async {
    try {
      final String? value = await _storage.read(key: key);
      return value;
    } on Exception {
      // The platform's message may embed key material or OS internals;
      // report the reason class only (§13.6).
      throw const SecureKeystoreException(
        KeystoreFailureReason.platformError,
        'read failed',
      );
    }
  }

  @override
  Future<void> write(String key, String value) async {
    try {
      await _storage.write(key: key, value: value);
    } on Exception {
      throw const SecureKeystoreException(
        KeystoreFailureReason.platformError,
        'write failed',
      );
    }
  }

  @override
  Future<void> delete(String key) async {
    try {
      await _storage.delete(key: key);
    } on Exception {
      throw const SecureKeystoreException(
        KeystoreFailureReason.platformError,
        'delete failed',
      );
    }
  }
}
