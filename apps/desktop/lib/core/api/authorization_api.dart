/// The authorization wire surface (Master Plan §11.1–§11.4, §22.2's
/// permission column; the accepted M2-S3 `authorization.contract.ts`).
///
/// One call today:
///
/// - `GET /api/v1/organizations/:organizationId/authorization/me` — the
///   effective permission set of the signed-in actor for the organization
///   session resolves: role grants, then per-user overrides, then the owner
///   structure, with a `DENY` deleting everything it touches (§11.4). The
///   response also answers whether the actor *is* the organization's owner —
///   the §22.2 owner-exclusive row's only key.
///
/// The organization id arrives from the verified session (§9.3). The client
/// uses this answer to arrange its **affordances** (§13.4): what the UI shows,
/// hints at, or disables. Every actual decision is re-checked server-side —
/// the client's copy is never an enforcement instrument (mission §8: UI
/// hiding is not a substitute for backend authorization).
library;

import 'package:my_shop_desktop/core/api/api_client.dart';
import 'package:my_shop_desktop/core/api/auth_api.dart' show apiV1Namespace;

/// `GET …/authorization/me` — the effective capabilities of one actor.
final class EffectiveAuthorization {
  const EffectiveAuthorization({
    required this.organizationId,
    required this.userId,
    required this.permissionsVersion,
    required this.isOwner,
    required this.roleKey,
    required this.permissions,
  });

  final String organizationId;
  final String userId;

  /// The M2-S3 version token the server publishes with the set; a UI that
  /// compared a stale set could detect the change through it (the snapshot
  /// paths of §38.17 own the binding workflow).
  final int permissionsVersion;

  /// The §22.2 owner-exclusive fields' structural key: exactly one member of
  /// an organization carries this.
  final bool isOwner;

  /// The §11.3 seeded preset key of the actor's assigned role, when any
  /// (`'owner'`, `'salesperson'`, …). Display data; never an authority.
  final String? roleKey;

  /// The resolved effective permission ids, in the server's catalog order.
  final List<String> permissions;

  /// `true` when [permission] is present in the effective set.
  bool has(String permission) => permissions.contains(permission);

  factory EffectiveAuthorization.fromJson(Map<String, Object?> json) {
    const FormatException malformed = FormatException(
      'the authorization-me answer was not a readable effective set',
    );
    final Object? org = json['organizationId'];
    final Object? user = json['userId'];
    final Object? version = json['permissionsVersion'];
    final Object? owner = json['isOwner'];
    final Object? roleKey = json['roleKey'];
    final Object? permissions = json['permissions'];
    if (org is! String || org.isEmpty) {
      throw malformed;
    }
    if (user is! String || user.isEmpty) {
      throw malformed;
    }
    if (version is! int) {
      throw malformed;
    }
    if (owner is! bool) {
      throw malformed;
    }
    if (permissions is! List || permissions.any((Object? id) => id is! String)) {
      throw malformed;
    }
    return EffectiveAuthorization(
      organizationId: org,
      userId: user,
      permissionsVersion: version,
      isOwner: owner,
      roleKey: roleKey is String && roleKey.isNotEmpty ? roleKey : null,
      permissions: List<String>.from(permissions),
    );
  }
}

/// The authorization surface.
class AuthorizationApi {
  AuthorizationApi(this._client);

  final ApiClient _client;

  /// Reads the effective authorization for the session's organization.
  /// Failures surface exactly as the transport classifies them: a transport
  /// fault is a withheld attempt, a 403 problem document is the server's
  /// refusal — and the two are never conflated (mission §7).
  Future<EffectiveAuthorization> me({required String organizationId}) async {
    final ApiSuccess response = await _client.send(
      method: 'GET',
      path: '$apiV1Namespace/organizations/$organizationId/authorization/me',
    );
    final Map<String, Object?>? json = response.json;
    if (json == null) {
      throw const FormatException('the authorization endpoint returned no JSON object');
    }
    return EffectiveAuthorization.fromJson(json);
  }
}
