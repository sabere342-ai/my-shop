/// The identity wire surface (Master Plan section 10, section 10.3, §40.6
/// M2-S2 contract as shipped in `auth.contract.ts`).
///
/// Four calls, exercised by this slice's flow:
///
/// - `POST /api/v1/auth/login`   - email + password → token pair.
/// - `POST /api/v1/auth/refresh` - the opaque refresh token → a fresh pair
///   (rotation; presenting an already-rotated token revokes the whole session
///   family server-side, §10.3).
/// - `POST /api/v1/auth/logout`  - revoke the session family a refresh token
///   belongs to. An unknown token is *not* an error (the server answers 204),
///   so local wiping never depends on server state.
/// - `GET  /api/v1/auth/me`      - the verified identity behind a bearer
///   access token: the user, the session, the organization memberships read
///   from server state (§9.3: never from the request), and the optional
///   device binding of M2-S5.
///
/// No request here carries an organization id: tenant scope is derived from
/// verified credentials, never asserted by the client (§9.3).
library;

import 'package:my_shop_desktop/core/api/api_client.dart';

/// The versioned namespace every identity call lives under (§34.1).
const String apiV1Namespace = '/api/v1';

/// `POST /api/v1/auth/login` -> the token pair, decoded strictly.
class LoginWireResponse {
  const LoginWireResponse({
    required this.accessToken,
    required this.expiresIn,
    required this.refreshToken,
    required this.refreshExpiresIn,
  });

  final String accessToken;
  final int expiresIn;
  final String refreshToken;
  final int refreshExpiresIn;

  factory LoginWireResponse.fromJson(Map<String, Object?> json) {
    final Object? access = json['accessToken'];
    final Object? expiry = json['expiresIn'];
    final Object? refresh = json['refreshToken'];
    final Object? refreshExpiry = json['refreshExpiresIn'];
    if (access is! String) {
      throw const FormatException('login response carried no accessToken');
    }
    if (expiry is! int) {
      throw const FormatException('login response carried no expiresIn');
    }
    if (refresh is! String) {
      throw const FormatException('login response carried no refreshToken');
    }
    if (refreshExpiry is! int) {
      throw const FormatException('login response carried no refreshExpiresIn');
    }
    return LoginWireResponse(
      accessToken: access,
      expiresIn: expiry,
      refreshToken: refresh,
      refreshExpiresIn: refreshExpiry,
    );
  }
}

/// `GET /api/v1/auth/me` -> the verified identity behind the access token.
class MeWireResponse {
  const MeWireResponse({
    required this.userId,
    required this.email,
    required this.organizations,
    required this.sessionId,
    required this.permissionsVersion,
    required this.expiresAt,
    this.deviceId,
  });

  final String userId;
  final String email;
  final List<String> organizations;
  final String sessionId;
  final int permissionsVersion;
  final DateTime expiresAt;

  /// The M2-S5 bound device id of this session, when one exists.
  final String? deviceId;

  factory MeWireResponse.fromJson(Map<String, Object?> json) {
    final Object? user = json['userId'];
    final Object? mail = json['email'];
    final Object? orgs = json['organizations'];
    final Object? session = json['sessionId'];
    final Object? perms = json['permissionsVersion'];
    final Object? expiry = json['expiresAt'];
    final Object? device = json['deviceId'];
    if (user is! String) {
      throw const FormatException('me response carried no userId');
    }
    if (mail is! String) {
      throw const FormatException('me response carried no email');
    }
    if (session is! String) {
      throw const FormatException('me response carried no sessionId');
    }
    if (perms is! int) {
      throw const FormatException('me response carried no permissionsVersion');
    }
    if (expiry is! String) {
      throw const FormatException('me response carried no expiresAt');
    }
    final DateTime parsedExpiry = DateTime.parse(expiry);
    if (orgs is! List || orgs.any((Object? o) => o is! String)) {
      throw const FormatException(
        'me response carried no organization id array',
      );
    }
    return MeWireResponse(
      userId: user,
      email: mail,
      organizations: List<String>.from(orgs),
      sessionId: session,
      permissionsVersion: perms,
      expiresAt: parsedExpiry,
      deviceId: device is String && device.isNotEmpty ? device : null,
    );
  }
}

/// The identity surface.
class AuthApi {
  AuthApi(this._client);

  final ApiClient _client;

  /// Exchanges credentials for a token pair. The server's problem document
  /// (invalid credentials, throttling, validation) throws [ApiFailure].
  Future<LoginWireResponse> login({
    required String email,
    required String password,
  }) async {
    final ApiSuccess response = await _client.send(
      method: 'POST',
      path: '$apiV1Namespace/auth/login',
      body: <String, Object?>{'email': email, 'password': password},
    );
    return LoginWireResponse.fromJson(_map(response));
  }

  /// Exchanges a refresh token for a fresh pair (§10.3 rotation).
  Future<LoginWireResponse> refresh({required String refreshToken}) async {
    final ApiSuccess response = await _client.send(
      method: 'POST',
      path: '$apiV1Namespace/auth/refresh',
      body: <String, Object?>{'refreshToken': refreshToken},
    );
    return LoginWireResponse.fromJson(_map(response));
  }

  /// Revokes the session family of [refreshToken]. Unknown tokens are not
  /// errors server-side; this call cannot fail the local sign-out.
  Future<void> logout({required String refreshToken}) async {
    await _client.send(
      method: 'POST',
      path: '$apiV1Namespace/auth/logout',
      body: <String, Object?>{'refreshToken': refreshToken},
    );
  }

  /// Reads the verified identity behind the current access token.
  Future<MeWireResponse> me() async {
    final ApiSuccess response = await _client.send(
      method: 'GET',
      path: '$apiV1Namespace/auth/me',
    );
    return MeWireResponse.fromJson(_map(response));
  }

  Map<String, Object?> _map(ApiSuccess response) {
    final Map<String, Object?>? json = response.json;
    if (json == null) {
      throw const FormatException(
        'the identity endpoint returned no JSON object',
      );
    }
    return json;
  }
}
