/// The concrete grace-record verifier — Master Plan §38.16.3, §38.17,
/// §40.5 row M1b-S8 ("port" shipped there), §40.6 M2-S3 ("signed snapshot
/// issuance" is what minted the signed material), §40.6 M2-S7 (this file).
///
/// The server's signed material is the **authorization snapshot** M2-S3 mints
/// at `POST /organizations/:organizationId/authorization/snapshot`: a compact
/// RS256 JWS signed by the identity key material over
/// `{ sub, org, role_id, role_key, owner, perms, perms_version,
/// catalog_version, iss, aud, iat, exp }`. This verifier is the M1b-S8 port's
/// production implementation:
///
/// 1. It parses the record's `signature` as a JWS and checks the `alg` header
///    **before** any signature work (M2-S2's pinning discipline, AC-18's
///    client-side half).
/// 2. It verifies the RS256 signature over the signing input with the
///    **pinned deployment key** — the server's SPKI public key shipped with
///    the deployment bundle (ADR-006: one backend, one key, distributed with
///    the client configuration it belongs to; no fetched JWKS and no
///    new backend surface in a client-only slice).
/// 3. It re-checks issuer, audience, expiry (with the server's own 60-second
///    skew), and the §38.17 structural rule that a non-owner snapshot carries
///    no owner-exclusive permission — inlined at exactly one id today
///    (`accounting.journal.post`), mirrored from the server catalog and must
///    change only when that catalog changes.
/// 4. It **rebuilds** the record from the signed claims and refuses when the
///    record disagrees on any signed-bound fact, so the unsigned fields of an
///    `OfflineGraceRecord` can never diverge from what the server actually
///    signed.
///
/// **No accepting default.** Without key material this verifier refuses every
/// record (fail-closed, M1b-S8 D-2). Composition either deploys a pinned key
/// or deploys a client that can never establish an offline session.
///
/// The device fact: §38.16.3 lists the device id among the signed contents,
/// and M2-S3's snapshot deliberately carries none ("device binding is M2-S5";
/// AC-21). This implementation therefore takes the device id from the
/// **bound-session fact** — the server-issued device id the client received
/// at bind time — and relies on the store's establish-time and
/// every-admission binding checks (M1b-S8 S-7, D-4) for install locality.
/// The signature binds the authorization facts (§38.17); the device fact is
/// server-issued and locally corroborated, never client-invented. The
/// refinement — a snapshot that signs the device id too — is recorded in the
/// M2-S7 record as deferred backend work with the residual stated.
///
/// Pure and side-effect free, exactly as the port demands.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:my_shop_desktop/core/offline/grace/grace_signature_verifier.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_record.dart';
import 'package:pointycastle/asn1.dart';
import 'package:pointycastle/export.dart' as pc;

/// All the M2-S3 snapshot facts that must agree before a record is accepted.
class SignedSnapshot {
  const SignedSnapshot({
    required this.userId,
    required this.organizationId,
    required this.permissions,
    required this.permissionsVersion,
    required this.issuedAt,
    required this.expiresAt,
    required this.isOwner,
  });

  final String userId;
  final String organizationId;
  final List<String> permissions;
  final int permissionsVersion;
  final DateTime issuedAt;
  final DateTime expiresAt;
  final bool isOwner;
}

/// The §38.17 structural rule, mirrored from the server catalog (§11.2).
/// Exactly one owner-exclusive id today; keep in step with the server's
/// `OWNER_EXCLUSIVE_PERMISSION_IDS`.
const String _ownerExclusivePermissionId = 'accounting.journal.post';

const String _snapshotIssuer = 'my-shop';
const String _snapshotAudience = 'my-shop:authorization-snapshot';
const String _rs256 = 'RS256';
const int _clockSkewSeconds = 60;
const String _base64UrlPattern = r'^[A-Za-z0-9_-]+$';

/// Verifies an [OfflineGraceRecord] against the pinned deployment key.
class RsaSignedSnapshotVerifier {
  /// [publicKeyPemSpki] may be `null`: the honest, deliberately refusing
  /// "nothing deployed" configuration (the no-accepting-default rule).
  RsaSignedSnapshotVerifier({this.publicKeyPemSpki});

  /// The server's SPKI PEM (`-----BEGIN PUBLIC KEY-----`), pinned by the
  /// deployment (ADR-006). `null` (nothing deployed) is the honest,
  /// deliberately *refusing* configuration.
  final String? publicKeyPemSpki;

  /// The parsed key, cached after the first successful parse. Parsing costs
  /// are once per process, matching the verifier's "same record and key,
  /// same answer" contract.
  pc.RSAPublicKey? _parsedKey;

  bool verifySignature(String signature) {
    final pc.RSAPublicKey? key = _readKey();
    if (key == null) return false;
    final List<String> segments = signature.split('.');
    if (segments.length != 3) return false;
    final String headerSegment = segments[0].isEmpty ? '' : segments[0];
    final String payloadSegment = segments[1].isEmpty ? '' : segments[1];
    final String signatureSegment = segments[2].isEmpty ? '' : segments[2];
    if (!_isBase64Url(headerSegment) ||
        !_isBase64Url(payloadSegment) ||
        !_isBase64Url(signatureSegment)) {
      return false;
    }
    final Map<String, Object?>? header = _decodeJson(headerSegment);
    if (header == null || header['alg'] != _rs256) {
      // Pin before signature work: `alg: none` and HS256 confusion are the
      // canonical JWS downgrade attacks (AC-18's client-side half).
      return false;
    }
    final Uint8List? macBytes = _decodeBase64Url(signatureSegment);
    if (macBytes == null) return false;
    final String signingInput = '$headerSegment.$payloadSegment';
    final pc.RSASigner signer = pc.RSASigner(
      pc.SHA256Digest(),
      '0609608648016503040201',
    );
    signer.init(false, pc.PublicKeyParameter<pc.RSAPublicKey>(key));
    try {
      return signer.verifySignature(
        _bytesOf(signingInput),
        pc.RSASignature(macBytes),
      );
    } on Exception {
      return false;
    }
  }

  /// The record's signed facts from the [signature] JWS, or `null` when the
  /// material is not a verifiable, in-window, structurally-legal snapshot.
  SignedSnapshot? signedFacts(String signature, DateTime now) {
    if (!verifySignature(signature)) {
      return null;
    }
    final List<String> segments = signature.split('.');
    if (segments.length != 3) return null;
    final Map<String, Object?> payload =
        _decodeJson(segments[1]) ?? <String, Object?>{};
    if (payload['iss'] != _snapshotIssuer ||
        payload['aud'] != _snapshotAudience) {
      return null;
    }
    final Object? issued = payload['iat'];
    final Object? expires = payload['exp'];
    final Object? owner = payload['owner'];
    if (issued is! int || expires is! int || owner is! bool) return null;
    final DateTime nowUtc = now.toUtc();
    final int nowSeconds = nowUtc.millisecondsSinceEpoch ~/ 1000;
    if (expires <= nowSeconds) return null;
    // Future-issue tolerance mirrors the server's own skew, but only in the
    // server's direction: a snapshot stamped in the future by more than the
    // server's own skew is refused.
    if (issued > nowSeconds + _clockSkewSeconds) return null;

    final Object? perms = payload['perms'];
    if (perms is! List || perms.any((Object? id) => id is! String)) return null;
    final List<String> permissions = List<String>.from(perms);
    if (!owner && permissions.contains(_ownerExclusivePermissionId)) {
      // §38.17: an offline snapshot can never grant an owner-exclusive
      // permission. The server refuses to mint and refuses to verify such a
      // snapshot; the client refuses to accept one, too.
      return null;
    }

    final Object? sub = payload['sub'];
    final Object? org = payload['org'];
    final Object? version = payload['perms_version'];
    if (sub is! String || sub.isEmpty) return null;
    if (org is! String || org.isEmpty) return null;
    if (version is! int) return null;

    return SignedSnapshot(
      userId: sub,
      organizationId: org,
      permissions: _normalize(permissions),
      permissionsVersion: version,
      issuedAt: DateTime.fromMillisecondsSinceEpoch(issued * 1000, isUtc: true),
      expiresAt: DateTime.fromMillisecondsSinceEpoch(
        expires * 1000,
        isUtc: true,
      ),
      isOwner: owner,
    );
  }

  pc.RSAPublicKey? _readKey() {
    final pc.RSAPublicKey? cached = _parsedKey;
    if (cached != null) return cached;
    final String? pem = publicKeyPemSpki;
    if (pem == null || pem.isEmpty) return null;
    final pc.RSAPublicKey? key = _parseSpkiPem(pem);
    if (key != null) {
      _parsedKey = key;
    }
    return key;
  }

  /// Parses `-----BEGIN PUBLIC KEY-----` SPKI into an RSA public key.
  /// Anything else (invalid base64, not DER, not RSA) is a refusal, not a
  /// crash — fail-closed at the byte level (§13.6).
  static pc.RSAPublicKey? _parseSpkiPem(String pem) {
    final RegExp bodyPattern = RegExp(
      r'-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----',
    );
    final RegExpMatch? match = bodyPattern.firstMatch(pem);
    if (match == null) return null;
    final String body = match.group(1)!.replaceAll(RegExp(r'\s'), '');
    final Uint8List der;
    try {
      der = base64.decode(body);
    } on FormatException {
      return null;
    }
    final ASN1Parser parser = ASN1Parser(der);
    final ASN1Object? top;
    try {
      top = parser.hasNext() ? parser.nextObject() : null;
    } on Exception {
      return null;
    }
    if (top is! ASN1Sequence) return null;
    final List<ASN1Object?> elements = top.elements ?? <ASN1Object?>[];
    if (elements.length != 2) return null;
    final ASN1BitString? bitString = elements[1] is ASN1BitString
        ? elements[1] as ASN1BitString
        : null;
    if (bitString == null) return null;
    final Uint8List valueBytes = bitString.valueBytes ?? Uint8List(0);
    // SPKI carries whole-byte key material, so the bit string's unused-bits
    // count must be zero and its content is that count byte *plus* the DER
    // `RSAPublicKey` sequence. pointycastle's `valueBytes` is the raw
    // content, so the count byte is stripped by hand (§13.6: fail closed
    // on anything but the exact shape).
    if (valueBytes.length < 2 || bitString.unusedbits != 0) return null;
    final Uint8List keyBytes = Uint8List.sublistView(valueBytes, 1);
    final ASN1Parser innerParser = ASN1Parser(keyBytes);
    final ASN1Object? inner;
    try {
      inner = innerParser.hasNext() ? innerParser.nextObject() : null;
    } on Exception {
      return null;
    }
    if (inner is! ASN1Sequence) return null;
    final List<ASN1Object?> keyParts = inner.elements ?? <ASN1Object?>[];
    if (keyParts.length != 2) return null;
    final BigInt? modulus = keyParts[0] is ASN1Integer
        ? (keyParts[0]! as ASN1Integer).integer
        : null;
    final BigInt? exponent = keyParts[1] is ASN1Integer
        ? (keyParts[1]! as ASN1Integer).integer
        : null;
    if (modulus == null || exponent == null) return null;
    return pc.RSAPublicKey(modulus, exponent);
  }

  static bool _isBase64Url(String segment) =>
      segment.isNotEmpty && RegExp(_base64UrlPattern).hasMatch(segment);

  static Uint8List? _decodeBase64Url(String segment) {
    try {
      final String padded = segment.padRight(
        segment.length + (4 - segment.length % 4) % 4,
        '=',
      );
      return base64Url.decode(padded);
    } on FormatException {
      return null;
    }
  }

  static Uint8List _bytesOf(String value) =>
      Uint8List.fromList(utf8.encode(value));

  static Map<String, Object?>? _decodeJson(String segment) {
    final Uint8List? bytes = _decodeBase64Url(segment);
    if (bytes == null) return null;
    try {
      final Object? decoded = jsonDecode(utf8.decode(bytes));
      if (decoded is Map) return Map<String, Object?>.from(decoded);
      return null;
    } on FormatException {
      return null;
    }
  }

  static List<String> _normalize(List<String> permissions) {
    final List<String> unique = <String>{...permissions}.toList()..sort();
    return unique;
  }
}

/// The M1b-S8 port adapter bridging the M2-S3 signed snapshot to the
/// `OfflineGraceRecord` the grace service consumes: the record it builds is
/// verified against the very JWS it came from, so the flow never assembles a
/// record from unverified bytes. The device fact is supplied by the caller
/// from the server-issued bound id and is corroborated by the establish-time
/// and every-admission binding checks (M1b-S8 S-7/D-4).
class SnapshotBackedGraceSignatureVerifier implements GraceSignatureVerifier {
  const SnapshotBackedGraceSignatureVerifier(this._verifier);

  final RsaSignedSnapshotVerifier _verifier;

  /// Builds the record from the signed snapshot's own claims, refusing
  /// (`null`) a snapshot that does not verify — a record that would be
  /// refused by [verify] is never constructed in the first place.
  OfflineGraceRecord? recordFrom({
    required String snapshot,
    required String deviceId,
  }) {
    final SignedSnapshot? facts = _verifier.signedFacts(
      snapshot,
      DateTime.now(),
    );
    if (facts == null) return null;
    return OfflineGraceRecord(
      userId: facts.userId,
      organizationId: facts.organizationId,
      deviceId: deviceId,
      permissions: facts.permissions,
      permissionsVersion: facts.permissionsVersion,
      issuedAt: facts.issuedAt,
      expiresAt: facts.expiresAt,
      signature: snapshot,
    );
  }

  @override
  bool verify(OfflineGraceRecord record) {
    final DateTime now = DateTime.now();
    final SignedSnapshot? facts = _verifier.signedFacts(record.signature, now);
    if (facts == null) return false;
    return facts.userId == record.userId &&
        facts.organizationId == record.organizationId &&
        facts.permissionsVersion == record.permissionsVersion &&
        _datesAgree(facts.issuedAt, record.issuedAt) &&
        _datesAgree(facts.expiresAt, record.expiresAt) &&
        _listsAgree(facts.permissions, record.permissions) &&
        record.deviceId.isNotEmpty;
  }

  static bool _datesAgree(DateTime signed, DateTime record) =>
      signed.millisecondsSinceEpoch == record.toUtc().millisecondsSinceEpoch;

  static bool _listsAgree(List<String> signed, List<String> record) {
    final List<String> recordNormalized = <String>{...record}.toList()..sort();
    if (signed.length != recordNormalized.length) return false;
    for (int i = 0; i < signed.length; i++) {
      if (signed[i] != recordNormalized[i]) return false;
    }
    return true;
  }
}
