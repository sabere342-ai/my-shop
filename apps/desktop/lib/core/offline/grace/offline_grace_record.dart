/// The signed offline grace record and the cached authorisation snapshot —
/// Master Plan §38.16.2, §38.16.3, §38.17, §10.3.1, §40.5 (M1b-S8), ADR-044.
///
/// §38.16.2 bounds offline operation to "only a previously authenticated user
/// on a previously registered and not-revoked device", and §38.16.3 says the
/// offline session "carries a signed snapshot: the user's permissions,
/// `permissions_version`, the organization id, the device id, the issued-at
/// time, and the grace expiry. It is validated locally against the stored
/// signature before use."
///
/// This class is that record. It is a **value object**: it holds exactly the
/// fields the plan lists, it carries the server's signature as an opaque
/// string, and it knows how to produce the canonical bytes that signature
/// covers ([signedPayload]). Verifying the signature is a separate concern with
/// a separate owner ([GraceSignatureVerifier]); this file only defines what is
/// signed.
///
/// Two deliberate distinctions:
///
/// * **The device wall clock at issuance is not here.** It is client-local
///   bookkeeping the store keeps beside the record (§38.16.5's "a persisted
///   high-water mark"); putting it in the signed payload would make the
///   signature cover a value the server never saw.
/// * **`signature` is not signed.** It *is* the signature. It is excluded from
///   [signedPayload] and carried separately.
library;

import 'dart:convert';

/// The permission identifiers are an open vocabulary owned by the server
/// (§11's permission catalogue, M2-S3); the record stores whatever the server
/// signed and never invents, widens, or filters it.
class OfflineGraceRecord {
  OfflineGraceRecord({
    required this.userId,
    required this.organizationId,
    required this.deviceId,
    required Iterable<String> permissions,
    required this.permissionsVersion,
    required this.issuedAt,
    required this.expiresAt,
    required this.signature,
    this.entitlementExpiresAt,
  }) : permissions = List<String>.unmodifiable(_normalize(permissions));

  /// §38.16.3 "the user id" — whose offline session this is.
  final String userId;

  /// §38.16.2 "Tenant scope, from device binding" — the organization.
  final String organizationId;

  /// §38.16.2 "bound to the device installation id" — the installation that
  /// may use this record. A record moved to another device fails this check.
  final String deviceId;

  /// §38.16.3 "the user's permissions" — the effective permission set as the
  /// server last issued it. Never widened locally (§38.17).
  final List<String> permissions;

  /// §38.16.3 `permissions_version` — the monotonic version the snapshot was
  /// issued at (§38.17's "cached snapshot is bounded").
  final int permissionsVersion;

  /// §38.16.3 "the issued-at time" — server time when the record was issued.
  final DateTime issuedAt;

  /// §38.16.3 "the grace expiry" — server time at which the window closes
  /// (§38.16.2, `offline_grace_duration`).
  final DateTime expiresAt;

  /// §38.16.5 entitlement expiry, when the organization is on a time-limited
  /// plan. At this instant offline sales stop and the device goes read-only.
  final DateTime? entitlementExpiresAt;

  /// The server's signature over [signedPayload]. Opaque to the client.
  final String signature;

  /// The window the server issued, `expiresAt - issuedAt`. Used to map the
  /// server's expiry onto the device clock without mixing the two clocks
  /// (§38.16.5: business dates derive from a server-issued offset; the window
  /// *length* is offset-invariant).
  Duration get graceWindow => expiresAt.difference(issuedAt);

  /// True when [permission] appears in the snapshot.
  bool hasPermission(String permission) => permissions.contains(permission);

  /// The canonical bytes the signature covers (§38.16.3).
  ///
  /// Built as an ordered map so the encoding is deterministic across hosts:
  /// the verifier on the server and the verifier on the device must hash the
  /// same string, and Dart preserves map insertion order.
  String get signedPayload => jsonEncode(<String, Object?>{
        'userId': userId,
        'organizationId': organizationId,
        'deviceId': deviceId,
        'permissions': permissions,
        'permissionsVersion': permissionsVersion,
        'issuedAt': issuedAt.toUtc().toIso8601String(),
        'expiresAt': expiresAt.toUtc().toIso8601String(),
        'entitlementExpiresAt': entitlementExpiresAt?.toUtc().toIso8601String(),
      });

  /// The stored form: the signed fields plus the signature.
  Map<String, Object?> toJson() => <String, Object?>{
        ..._signedFields(),
        'signature': signature,
      };

  /// Parses the stored form, rejecting anything that is not a record.
  factory OfflineGraceRecord.fromJson(Map<String, Object?> json) {
    final Object? permissions = json['permissions'];
    if (permissions is! List<Object?>) {
      throw FormatException('grace record `permissions` must be a list: $json');
    }
    return OfflineGraceRecord(
      userId: _requireString(json, 'userId'),
      organizationId: _requireString(json, 'organizationId'),
      deviceId: _requireString(json, 'deviceId'),
      permissions: permissions.map((Object? value) {
        if (value is! String) {
          throw FormatException('grace record permission must be a string: $value');
        }
        return value;
      }),
      permissionsVersion: _requireInt(json, 'permissionsVersion'),
      issuedAt: _requireDate(json, 'issuedAt'),
      expiresAt: _requireDate(json, 'expiresAt'),
      entitlementExpiresAt: _optionalDate(json, 'entitlementExpiresAt'),
      signature: _requireString(json, 'signature'),
    );
  }

  Map<String, Object?> _signedFields() => <String, Object?>{
        'userId': userId,
        'organizationId': organizationId,
        'deviceId': deviceId,
        'permissions': permissions,
        'permissionsVersion': permissionsVersion,
        'issuedAt': issuedAt.toUtc().toIso8601String(),
        'expiresAt': expiresAt.toUtc().toIso8601String(),
        'entitlementExpiresAt': entitlementExpiresAt?.toUtc().toIso8601String(),
      };

  static List<String> _normalize(Iterable<String> permissions) {
    final List<String> unique = <String>{...permissions}.toList()..sort();
    return unique;
  }

  static String _requireString(Map<String, Object?> json, String key) {
    final Object? value = json[key];
    if (value is! String || value.isEmpty) {
      throw FormatException('grace record `$key` must be a non-empty string: $json');
    }
    return value;
  }

  static int _requireInt(Map<String, Object?> json, String key) {
    final Object? value = json[key];
    if (value is! int) {
      throw FormatException('grace record `$key` must be an integer: $json');
    }
    return value;
  }

  static DateTime _requireDate(Map<String, Object?> json, String key) {
    final String raw = _requireString(json, key);
    final DateTime? parsed = DateTime.tryParse(raw);
    if (parsed == null) {
      throw FormatException('grace record `$key` is not an ISO-8601 instant: $raw');
    }
    return parsed.toUtc();
  }

  static DateTime? _optionalDate(Map<String, Object?> json, String key) {
    final Object? value = json[key];
    if (value == null) return null;
    if (value is! String) {
      throw FormatException('grace record `$key` must be a string or null: $json');
    }
    final DateTime? parsed = DateTime.tryParse(value);
    if (parsed == null) {
      throw FormatException('grace record `$key` is not an ISO-8601 instant: $value');
    }
    return parsed.toUtc();
  }

  @override
  String toString() => 'OfflineGraceRecord(user: $userId, org: $organizationId, '
      'device: $deviceId, permissions: ${permissions.length}@$permissionsVersion, '
      'expires: ${expiresAt.toIso8601String()})';
}
