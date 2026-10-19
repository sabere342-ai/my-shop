/// The M2-S7 auth test harness — shared fakes and fixtures (§6.5: tests drive
/// real transitions with injectable fakes; there is no service locator here).
///
/// Two standing disciplines this file enforces for every suite that imports
/// it:
///
/// - **Sentinels, never real-looking material.** Every token value is a
///   plainly artificial sentinel (a `TOKEN`-prefixed string that no JWT or
///   credential scan could mistake for a live secret). The §13.6 redaction
///   tests are written against them; nothing in the repositorie's test tree
///   ever embeds a snapshot or token string literal.
/// - **The snapshot key pair is generated at test time, in memory.** The
///   repository never contains test private key material (stage 1's scan is
///   a hard gate, and a real private key has no business in a fixture).
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:my_shop_desktop/core/auth/keystore.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:pointycastle/asn1.dart';
import 'package:pointycastle/export.dart' as pc;

// ---------------------------------------------------------------------------
// Keys and sentinels
// ---------------------------------------------------------------------------

/// Fixed, valid UUID-shaped ids (same convention as the outbox harness) so a
/// failure reads identically on every machine.
const String testOrganizationId = '11111111-1111-4111-8111-111111111111';
const String testSecondOrganizationId = '11111111-1111-4111-8111-555555555555';
const String testDeviceId = '22222222-2222-4222-8222-222222222222';
const String testUserId = '33333333-3333-4333-8333-333333333333';
const String testSessionId = '44444444-4444-4444-8444-444444444444';

/// Sentinel token values (§13.6: artificial, unmisstakeable, never a real
/// credential shape).
const String testAccessToken = 'TOKEN sentry-access-token-unit-test';
const String testRefreshToken = 'TOKEN sentry-refresh-token-unit-test';
const String testBoundAccessToken = 'TOKEN sentry-bound-access-token-unit-test';
const String testInstallationSecret =
    'TOKEN sentry-installation-secret-unit-test';

/// A database on no disk at all.
AppDatabase memoryDatabase() {
  // Each suite owns its own throw-away in-memory database; they never share
  // an executor, so drift's shared-executor corruption warning is noise here.
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  return AppDatabase.forTesting(NativeDatabase.memory());
}

/// Every token byte this fake has been asked to persist, by keystore key.
/// It is also a **cross-check oracle** for the governing acceptance: a suite
/// that wants to prove no token left the keystore reads this map and the
/// local database and looks for the sentinels.
class RecordingKeystore implements Keystore {
  RecordingKeystore({this.initiallyHeld = const <String, String>{}});

  final Map<String, String> initiallyHeld;

  final Map<String, String> written = <String, String>{};
  final List<String> deleted = <String>[];

  /// Writes for these keys are turned away (the simulated broken platform
  /// keystore). Reads of those keys still answer what was last written.
  Set<String> refuseWriteKeys = const <String>{};

  /// Reads of these keys fail the platform way.
  Set<String> failReadKeys = const <String>{};

  @override
  Future<String?> read(String key) async {
    if (failReadKeys.contains(key)) {
      throw const SecureKeystoreException(
        KeystoreFailureReason.platformError,
        'read failed',
      );
    }
    return written[key] ?? initiallyHeld[key];
  }

  @override
  Future<void> write(String key, String value) async {
    if (refuseWriteKeys.contains(key)) {
      throw const SecureKeystoreException(
        KeystoreFailureReason.platformError,
        'write failed',
      );
    }
    written[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    deleted.add(key);
    written.remove(key);
  }
}

/// The combined token record the [RecordingKeystore] currently holds, parsed
/// back through the store's own contract key.
Map<String, Object?>? tokenRecordOf(RecordingKeystore keystore) {
  final String? raw = keystore.written['auth.access_token'];
  if (raw == null) {
    return null;
  }
  return (jsonDecode(raw) as Map).cast<String, Object?>();
}

/// Dumps the local database's own tables into one string so suites can prove
/// **no token sentinel survived outside the keystore** (the governing
/// acceptance's cross-check half).
Future<String> dumpLocalDatabase(AppDatabase db) async {
  final StringBuffer out = StringBuffer();
  final List<LocalMetaData> meta = await db.select(db.localMeta).get();
  for (final LocalMetaData row in meta) {
    out.write('${row.key}=${row.value}\n');
  }
  return out.toString();
}

// ---------------------------------------------------------------------------
// HTTP scripting
// ---------------------------------------------------------------------------

/// A scripted answer for one path, matched on the request method.
/// `null` delegates to the *unrouted* answer (a withheld attempt by default).
typedef ScriptedRoute = http.Response? Function(
  http.Request request,
  ScriptedServer server,
);

/// The script behind the http mock. Each server owns its route table; suites
/// mutate behavior between steps to replay a sequenced server (rotation,
/// stale answers, revocation).
class ScriptedServer {
  ScriptedServer({this.onUnrouted});

  /// What an unrouted request is answered with. The default sits at "the
  /// transport withheld the attempt" (no HTTP answer at all is not
  /// simulatable through a mock that always answers, so an unrouted call is
  /// an explicit client-side failure instead — the honest classification in
  /// the client's own taxonomy).
  void Function(http.Request request)? onUnrouted;

  final Map<String, Map<String, ScriptedRoute>> routes =
      <String, Map<String, ScriptedRoute>>{};

  /// Requests this server answered, in order, for call-count assertions
  /// (the one-retry refresh contract is a call-count statement).
  final List<http.Request> received = <http.Request>[];

  void route(String method, String path, ScriptedRoute answer) {
    routes.putIfAbsent(path, () => <String, ScriptedRoute>{})[method] = answer;
  }

  void clearRoute(String method, String path) {
    routes[path]?.remove(method);
  }

  http.Client client() => MockClient(_handle);

  Future<http.Response> _handle(http.BaseRequest baseRequest) async {
    final http.Request request = baseRequest as http.Request;
    received.add(request);
    final http.Response? Function(http.Request, ScriptedServer)? answer =
        routes[request.url.path]?[request.method];
    if (answer == null) {
      onUnrouted?.call(request);
      throw http.ClientException(
        'the server script never routed this call',
        request.url,
      );
    }
    final http.Response? response = answer(request, this);
    if (response != null) {
      return response;
    }
    throw http.ClientException(
      'the server script withheld its answer',
      request.url,
    );
  }
}

/// `application/json` 2xx builder.
http.Response jsonOk(Map<String, Object?> body, {int status = 200}) =>
    http.Response(
      jsonEncode(body),
      status,
      headers: <String, String>{'content-type': 'application/json'},
    );

/// An RFC 7807 problem answer in the shape the §34.1 server sends.
http.Response problem(
  String code, {
  int status = 400,
  String? traceId,
  String? detail,
}) => http.Response(
  jsonEncode(<String, Object?>{
    'code': code,
    'type': 'about:blank',
    'title': code,
    'detail': ?detail,
    'traceId': ?traceId,
  }),
  status,
  headers: <String, String>{'content-type': 'application/problem+json'},
);

/// Body-decoding helper for assertions about what the client actually sent.
Map<String, Object?> bodyOf(http.Request request) =>
    (jsonDecode(request.body) as Map).cast<String, Object?>();

// ---------------------------------------------------------------------------
// The test-side snapshot authority
// ---------------------------------------------------------------------------

/// The test's own offline identity server: it generates an RSA key pair once
/// per test run (in memory, never written anywhere), signs compact RS256
/// authorization snapshots exactly as the M2-S3 endpoint mints them, and
/// exposes the SPKI PEM a client deployment would pin (ADR-006).
///
/// The generation cost is paid once per suite instance; the pair is
/// deterministic in shape, not in value, and neither half travels anywhere.
class SnapshotTestAuthority {
  SnapshotTestAuthority._(this.publicKey, this.privateKey);

  static final SnapshotTestAuthority instance =
      SnapshotTestAuthority._generate();

  factory SnapshotTestAuthority._generate() {
    final pc.SecureRandom random = pc.SecureRandom('Fortuna')
      ..seed(
        pc.KeyParameter(
          Uint8List.fromList(
            List<int>.generate(32, (int index) => 0xA7 + index),
          ),
        ),
      );
    final pc.RSAKeyGenerator generator = pc.RSAKeyGenerator()
      ..init(
        pc.ParametersWithRandom(
          pc.RSAKeyGeneratorParameters(BigInt.from(65537), 1024, 64),
          random,
        ),
      );
    final pc.AsymmetricKeyPair<pc.PublicKey, pc.PrivateKey> pair =
        generator.generateKeyPair()
            as pc.AsymmetricKeyPair<pc.PublicKey, pc.PrivateKey>;
    return SnapshotTestAuthority._(
      pair.publicKey as pc.RSAPublicKey,
      pair.privateKey as pc.RSAPrivateKey,
    );
  }

  final pc.RSAPublicKey publicKey;
  final pc.RSAPrivateKey privateKey;

  bool _verifyOverrideShouldRefuse = false;

  /// Lets a suite make every minted signature mathematically wrong apart
  /// (simulating a foreign signer with the same claims).
  set corruptEverySignature(bool refuse) =>
      _verifyOverrideShouldRefuse = refuse;

  /// The deployment's pinned key (ADR-006): the SPKI PEM a client build
  /// carries as `MY_SHOP_SNAPSHOT_PUBLIC_KEY`.
  String get spkiPem {
    final ASN1Sequence algorithm = ASN1Sequence()
      ..add(ASN1ObjectIdentifier(<int>[1, 2, 840, 113549, 1, 1, 1]));
    final ASN1Sequence material = ASN1Sequence()
      ..add(ASN1Integer(publicKey.modulus))
      ..add(ASN1Integer(publicKey.exponent!));
    final ASN1Sequence spki = ASN1Sequence()
      ..add(algorithm)
      ..add(ASN1BitString(stringValues: material.encode()));
    final String body = base64.encode(spki.encode());
    return '-----BEGIN PUBLIC KEY-----\n$body\n-----END PUBLIC KEY-----\n';
  }

  /// Mints one snapshot with the M2-S3 claim set and overridable fields —
  /// the same tool every rejection-matrix case uses.
  String mint({
    String sub = testUserId,
    String org = testOrganizationId,
    List<String> perms = const <String>['sales.create'],
    int permsVersion = 7,
    bool owner = false,
    String? iss,
    String? aud,
    DateTime? issuedAt,
    DateTime? expiresAt,
    Map<String, Object?>? headerOverride,
    Object? payloadOverride,
    String? signatureOverride,
    String? corruptHeader,
  }) {
    final DateTime now = DateTime.now().toUtc();
    final DateTime iat = issuedAt ?? now;
    final DateTime exp = expiresAt ?? now.add(const Duration(hours: 72));

    final Map<String, Object?> header =
        headerOverride ?? <String, Object?>{'alg': 'RS256'};
    if (corruptHeader != null) {
      header['alg'] = corruptHeader;
      if (corruptHeader == 'none') {
        header.remove('alg');
      }
    }
    final Map<String, Object?> payload = payloadOverride is Map
        ? (payloadOverride).cast<String, Object?>()
        : <String, Object?>{
            'sub': sub,
            'org': org,
            'owner': owner,
            'perms': perms,
            'perms_version': permsVersion,
            'iss': iss ?? 'my-shop',
            'aud': aud ?? 'my-shop:authorization-snapshot',
            'iat': iat.millisecondsSinceEpoch ~/ 1000,
            'exp': exp.millisecondsSinceEpoch ~/ 1000,
          };

    final String headerSegment = _segmentOf(header);
    final String payloadSegment = payloadOverride is String
        ? payloadOverride
        : _segmentOf(payload);

    final String signatureSegment =
        signatureOverride ??
        _sign(
          '$headerSegment.$payloadSegment',
          corrupt: _verifyOverrideShouldRefuse,
        );

    return '$headerSegment.$payloadSegment.$signatureSegment';
  }

  String _segmentOf(Map<String, Object?> value) =>
      _base64UrlNoPadding(utf8.encode(jsonEncode(value)));

  String _sign(String input, {required bool corrupt}) {
    final pc.RSASigner signer = pc.RSASigner(
      pc.SHA256Digest(),
      '0609608648016503040201',
    )..init(true, pc.PrivateKeyParameter<pc.RSAPrivateKey>(privateKey));
    final Uint8List bytes = Uint8List.fromList(utf8.encode(input));
    final pc.RSASignature signature = signer.generateSignature(bytes);
    final Uint8List signatureBytes = corrupt
        ? Uint8List.fromList(
            signature.bytes.map<int>((int byte) => byte ^ 0xFF).toList(),
          )
        : signature.bytes;
    return _base64UrlNoPadding(signatureBytes);
  }

  /// A second, independent authority: same generation path, separate state.
  /// Its key verifies nothing [instance]'s key signed, and vice versa.
  static SnapshotTestAuthority foreign() {
    final SnapshotTestAuthority? existing = _foreign;
    if (existing != null) return existing;
    _foreign = _generateAnother();
    return _foreign!;
  }

  static SnapshotTestAuthority? _foreign;

  static SnapshotTestAuthority _generateAnother() {
    final pc.SecureRandom random = pc.SecureRandom('Fortuna')
      ..seed(
        pc.KeyParameter(
          Uint8List.fromList(
            List<int>.generate(32, (int index) => 0x31 + index),
          ),
        ),
      );
    final pc.RSAKeyGenerator generator = pc.RSAKeyGenerator()
      ..init(
        pc.ParametersWithRandom(
          pc.RSAKeyGeneratorParameters(BigInt.from(65537), 1024, 64),
          random,
        ),
      );
    final pc.AsymmetricKeyPair<pc.PublicKey, pc.PrivateKey> pair =
        generator.generateKeyPair()
            as pc.AsymmetricKeyPair<pc.PublicKey, pc.PrivateKey>;
    return SnapshotTestAuthority._(
      pair.publicKey as pc.RSAPublicKey,
      pair.privateKey as pc.RSAPrivateKey,
    );
  }
}

String _base64UrlNoPadding(List<int> bytes) {
  final String encoded = base64Url.encode(bytes);
  return encoded.replaceAll('=', '');
}
