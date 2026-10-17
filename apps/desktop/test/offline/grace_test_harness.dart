import 'package:drift/drift.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/grace/grace_signature_verifier.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_record.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_service.dart';

import 'outbox_test_harness.dart';

// Master Plan §38.16.2–§38.16.5, §40.5 (M1b-S8).
//
// The shared fixtures for the offline-auth-grace tests. The device binding and
// the in-memory database come from `outbox_test_harness.dart` unchanged, so the
// grace and outbox suites agree by construction on the organization/device
// identity the record must bind to (§38.16.2, §38.8.1).
export 'outbox_test_harness.dart';

/// The test "server key" the [TestGraceSignatureVerifier] trusts.
const String testGraceKey = 'my-shop-test-grace-key-1';

/// A second key that never verifies against [testGraceKey] — the "wrong server"
/// a copied or forged record presents.
const String testOtherGraceKey = 'my-shop-test-grace-key-2';

/// A deterministic, non-cryptographic digest used only to make a record's
/// signature depend on every signed field.
///
/// The real verifier is an asymmetric one owned by the identity/permission
/// slices (M2-S3, §40.6); this primitive exists so a test can tamper with one
/// field and watch verification fail without shipping a fake crypto scheme.
String signGracePayload(String payload, String key) {
  int accumulator = 7;
  for (final int unit in '$key|$payload'.codeUnits) {
    accumulator = (accumulator * 31 + unit) & 0x7fffffff;
  }
  return 'test-grace-sig-$accumulator';
}

/// A [GraceSignatureVerifier] that trusts exactly [key].
///
/// It is pure and side-effect free, as the port demands (§40.5): the same
/// record always yields the same answer and verification writes nothing.
class TestGraceSignatureVerifier implements GraceSignatureVerifier {
  const TestGraceSignatureVerifier({this.key = testGraceKey});

  final String key;

  @override
  bool verify(OfflineGraceRecord record) =>
      record.signature == signGracePayload(record.signedPayload, key);
}

/// Builds a record whose signature is valid for [key] over exactly its fields.
///
/// [signature], when supplied, is used verbatim instead of being computed — the
/// way a tampered or foreign record arrives with a signature that does not
/// cover its content.
OfflineGraceRecord buildGraceRecord({
  required DateTime issuedAt,
  required DateTime expiresAt,
  String userId = testActorUserId,
  String organizationId = testOrganizationId,
  String deviceId = testDeviceId,
  List<String> permissions = const <String>['sales.create', 'sales.void'],
  int permissionsVersion = 7,
  DateTime? entitlementExpiresAt,
  String? signature,
  String key = testGraceKey,
}) {
  final OfflineGraceRecord draft = OfflineGraceRecord(
    userId: userId,
    organizationId: organizationId,
    deviceId: deviceId,
    permissions: permissions,
    permissionsVersion: permissionsVersion,
    issuedAt: issuedAt,
    expiresAt: expiresAt,
    entitlementExpiresAt: entitlementExpiresAt,
    signature: '',
  );
  return OfflineGraceRecord(
    userId: userId,
    organizationId: organizationId,
    deviceId: deviceId,
    permissions: permissions,
    permissionsVersion: permissionsVersion,
    issuedAt: issuedAt,
    expiresAt: expiresAt,
    entitlementExpiresAt: entitlementExpiresAt,
    signature: signature ?? signGracePayload(draft.signedPayload, key),
  );
}

/// Rebuilds [original] with one or more fields changed but its original
/// signature kept, so verification must fail (§38.16.3, §10.3.1 anti-replay).
OfflineGraceRecord tamperGraceRecord(
  OfflineGraceRecord original, {
  String? userId,
  String? organizationId,
  String? deviceId,
  List<String>? permissions,
  int? permissionsVersion,
  DateTime? issuedAt,
  DateTime? expiresAt,
  DateTime? entitlementExpiresAt,
}) {
  return OfflineGraceRecord(
    userId: userId ?? original.userId,
    organizationId: organizationId ?? original.organizationId,
    deviceId: deviceId ?? original.deviceId,
    permissions: permissions ?? original.permissions,
    permissionsVersion: permissionsVersion ?? original.permissionsVersion,
    issuedAt: issuedAt ?? original.issuedAt,
    expiresAt: expiresAt ?? original.expiresAt,
    entitlementExpiresAt: entitlementExpiresAt ?? original.entitlementExpiresAt,
    signature: original.signature,
  );
}

/// A wall clock the test sets and advances explicitly.
class TestWallClock {
  TestWallClock(this._now);

  DateTime _now;

  DateTime now() => _now;

  void set(DateTime value) => _now = value;

  void advance(Duration by) => _now = _now.add(by);
}

/// A monotonic source the test advances alongside the wall clock to model real
/// elapsed time, or holds still to model a tampered wall clock (§38.16.5).
class TestMonotonicClock {
  Duration _elapsed = Duration.zero;

  Duration elapsed() => _elapsed;

  void advance(Duration by) => _elapsed += by;
}

/// The fixed server issuance the grace fixtures are built from: an 8-hour
/// window, so "inside", "at", and "past" expiry are unambiguous.
final DateTime testGraceIssuedAt = DateTime.utc(2026, 3, 1, 8, 0, 0);
const Duration testGraceWindow = Duration(hours: 8);
final DateTime testGraceExpiresAt = testGraceIssuedAt.add(testGraceWindow);

/// A running service plus the two clocks the test drives.
///
/// [advance] moves the wall and monotonic clocks together, which is what real
/// elapsed time does; a test that tampers with the wall clock moves [wall]
/// alone to model a change under a running process (§38.16.5).
class GraceFixture {
  GraceFixture(
    this.db, {
    GraceSignatureVerifier verifier = const TestGraceSignatureVerifier(),
  })  : _verifier = verifier,
        wall = TestWallClock(DateTime.utc(2026, 3, 1, 12, 0, 0)),
        monotonic = TestMonotonicClock() {
    service = OfflineGraceService(
      db,
      verifier: verifier,
      wallClock: wall.now,
      monotonicClock: monotonic.elapsed,
    );
  }

  final AppDatabase db;
  final GraceSignatureVerifier _verifier;
  final TestWallClock wall;
  final TestMonotonicClock monotonic;
  late final OfflineGraceService service;

  /// Real elapsed time: the wall and monotonic clocks advance together.
  void advance(Duration by) {
    wall.advance(by);
    monotonic.advance(by);
  }

  /// A second service over the same database with fresh clocks — a process
  /// restart. Its monotonic clock starts at zero, as a process's does.
  OfflineGraceService restart({
    required DateTime wallNow,
    Duration monotonicElapsed = Duration.zero,
  }) {
    return OfflineGraceService(
      db,
      verifier: _verifier,
      wallClock: () => wallNow,
      monotonicClock: () => monotonicElapsed,
    );
  }
}

/// The number of outbox rows — the T-O17 "no business record, no outbox entry"
/// sentinel.
Future<int> outboxRowCount(AppDatabase db) async => (await db.select(db.outbox).get()).length;

/// The number of local audit rows, so a refused mutation is proven to have left
/// no partial state either.
Future<int> auditRowCount(AppDatabase db) async =>
    (await db.select(db.localAuditEvents).get()).length;

/// The raw `local_meta` value at [key], or `null` when absent.
Future<String?> rawMeta(AppDatabase db, String key) async {
  for (final LocalMetaData row in await db.select(db.localMeta).get()) {
    if (row.key == key) return row.value;
  }
  return null;
}

/// Whether `local_meta` holds [key] — used to prove a refused mutation never
/// allocated anything.
Future<bool> hasMetaKey(AppDatabase db, String key) async =>
    await rawMeta(db, key) != null;

/// Writes a raw `local_meta` value, the way a corrupted or adversarial database
/// row would look (§38.26 T-O21).
Future<void> writeRawMeta(AppDatabase db, String key, String value) {
  return db.into(db.localMeta).insert(
        LocalMetaCompanion.insert(key: key, value: value),
        mode: InsertMode.insertOrReplace,
      );
}
