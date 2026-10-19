/// The device wire surface (M2-S5 contract: `device.contract.ts`) and the
/// org-scoped snapshot surface (M2-S3: `authorization.contract.ts`).
///
/// Two calls this slice exercises during enrollment:
///
/// - `POST /api/v1/organizations/:organizationId/devices` - register this
///   installation (idempotent 204 for the same handle + credential pair).
/// - `POST /api/v1/organizations/:organizationId/devices/:deviceId/bind-session`
///   - bind the caller's verified session to that device; the response is a
///   *fresh* access token carrying the `did` claim (the server re-mints; the
///   client never advances a claim itself).
///
/// and one for the offline authorization snapshot:
///
/// - `POST /api/v1/organizations/:organizationId/authorization/snapshot` -
///   mint the signed RS256 snapshot (§38.16.3, M2-S3). Signed by the identity
///   key material, audience `my-shop:authorization-snapshot`.
///
/// The organization id on every path comes from the verified `/auth/me`
/// memberships (§9.3): route parameters are derived values here, never
/// client-invented tenants.
library;

import 'package:my_shop_desktop/core/api/api_client.dart';
import 'package:my_shop_desktop/core/api/auth_api.dart' show apiV1Namespace;

/// `POST .../authorization/snapshot` -> the signed JWS and its expiry.
class SnapshotWireResponse {
  const SnapshotWireResponse({required this.snapshot, required this.expiresAt});

  /// The compact RS256 JWS (§38.16.3). Held like a credential-class value:
  /// never logged, only verified and stored in the offline session.
  final String snapshot;

  final DateTime expiresAt;

  factory SnapshotWireResponse.fromJson(Map<String, Object?> json) {
    final Object? snapshot = json['snapshot'];
    final Object? expiry = json['expiresAt'];
    if (snapshot is! String || snapshot.isEmpty) {
      throw const FormatException('snapshot response carried no snapshot');
    }
    if (expiry is! String) {
      throw const FormatException('snapshot response carried no expiresAt');
    }
    return SnapshotWireResponse(
      snapshot: snapshot,
      expiresAt: DateTime.parse(expiry),
    );
  }
}

/// The device record the register endpoint answers (and the owner's device
/// list surfaces). The installation credential and its digest are never part
/// of it (M2-S5 AC-10).
class DeviceRecordWire {
  const DeviceRecordWire({required this.deviceId, required this.status});

  final String deviceId;

  /// The §12.2 trust state. A `REVOKED` record must not be adopted into a
  /// session (re-registration of a revoked installation is refused
  /// server-side; this field is the client's honest confirmation).
  final String status;

  factory DeviceRecordWire.fromJson(Map<String, Object?> json) {
    final Object? id = json['deviceId'];
    final Object? status = json['status'];
    if (id is! String || id.isEmpty) {
      throw const FormatException('device record carried no deviceId');
    }
    if (status is! String || status.isEmpty) {
      throw const FormatException('device record carried no status');
    }
    return DeviceRecordWire(deviceId: id, status: status);
  }
}

/// The fresh, device-bound access token (§12.4). No refresh token rides this
/// answer: binding never rotates the family (M2-S5).
class BoundSessionWire {
  const BoundSessionWire({required this.accessToken, required this.expiresIn});

  final String accessToken;
  final int expiresIn;

  factory BoundSessionWire.fromJson(Map<String, Object?> json) {
    final Object? accessToken = json['accessToken'];
    final Object? expiresIn = json['expiresIn'];
    if (accessToken is! String || accessToken.isEmpty) {
      throw const FormatException(
        'bind-session response carried no accessToken',
      );
    }
    if (expiresIn is! int) {
      throw const FormatException('bind-session response carried no expiresIn');
    }
    return BoundSessionWire(accessToken: accessToken, expiresIn: expiresIn);
  }
}

/// The device + snapshot surface.
class EnrollmentApi {
  EnrollmentApi(this._client);

  final ApiClient _client;

  /// Registers this installation idempotently. Both a fresh registration and
  /// a re-registration answer the full device record with the
  /// server-issued device id.
  Future<DeviceRecordWire> registerDevice({
    required String organizationId,
    required String installationId,
    required String installationSecret,
    required String platform,
  }) async {
    final ApiSuccess response = await _client.send(
      method: 'POST',
      path: '$apiV1Namespace/organizations/$organizationId/devices',
      body: <String, Object?>{
        'installationId': installationId,
        'installationSecret': installationSecret,
        'platform': platform,
      },
    );
    return DeviceRecordWire.fromJson(
      _map(response, 'register response carried no JSON object'),
    );
  }

  /// Binds the current session to the device; the answer is the re-minted
  /// bound access token with its own budget (the `did` claim rides the
  /// server's signature).
  Future<BoundSessionWire> bindSession({
    required String organizationId,
    required String deviceId,
    required String installationSecret,
  }) async {
    final ApiSuccess response = await _client.send(
      method: 'POST',
      path:
          '$apiV1Namespace/organizations/$organizationId/devices/$deviceId/bind-session',
      body: <String, Object?>{'installationSecret': installationSecret},
    );
    return BoundSessionWire.fromJson(
      _map(response, 'bind-session response carried no JSON object'),
    );
  }

  /// Mints the caller's signed authorization snapshot (§38.16.3).
  Future<SnapshotWireResponse> mintSnapshot({
    required String organizationId,
  }) async {
    final ApiSuccess response = await _client.send(
      method: 'POST',
      path:
          '$apiV1Namespace/organizations/$organizationId/authorization/snapshot',
      body: <String, Object?>{},
    );
    return SnapshotWireResponse.fromJson(
      _map(response, 'snapshot response carried no JSON object'),
    );
  }

  Map<String, Object?> _map(ApiSuccess response, String message) {
    final Map<String, Object?>? json = response.json;
    if (json == null) {
      throw FormatException(message);
    }
    return json;
  }
}
