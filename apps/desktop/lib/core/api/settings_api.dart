/// The settings wire surface (Master Plan §22, §38.18; §40.7 row M3-S1 as
/// accepted on the backend; §34.1).
///
/// Two calls over the M2-S7 transport:
///
/// - `GET /api/v1/organizations/:organizationId/settings` — the
///   organization's typed settings with the current `settings_version`.
///   Requires `settings.view` server-side; an unauthorized call answers the
///   server's problem document, which the transport has already classified.
/// - `PUT /api/v1/organizations/:organizationId/settings` — the
///   field-authorized partial update. Only the fields the caller means to
///   change are sent; `settingsVersion` in the body is the §38.18 concurrency
///   token whose mismatch answers `409 SETTINGS_VERSION_CONFLICT`.
///
/// The organization id arrives from the verified **session** (§9.3: tenant
/// scope derives from credentials, never from a request body). Nothing here
/// invents a value, retries silently, or fabricates a success: what comes
/// back is the server's canonical answer or a typed failure.
library;

import 'package:my_shop_desktop/core/api/api_client.dart';
import 'package:my_shop_desktop/core/api/auth_api.dart' show apiV1Namespace;
import 'package:my_shop_desktop/features/settings/models/organization_settings.dart';

/// One fetched settings answer: the verbatim wire payload (what the cache
/// stores, §38.18) beside the strictly parsed model (what the UI shows).
final class FetchedSettings {
  const FetchedSettings({required this.payload, required this.settings});

  final Map<String, Object?> payload;
  final OrganizationSettings settings;
}

/// The settings surface.
class SettingsApi {
  SettingsApi(this._client);

  final ApiClient _client;

  Map<String, Object?> _map(ApiSuccess response) {
    final Map<String, Object?>? json = response.json;
    if (json == null) {
      throw const FormatException('the settings endpoint returned no JSON object');
    }
    return json;
  }

  /// Reads the organization's typed settings (§38.18: authoritative values
  /// with their monotonic version; the §22.3 read-only client records what
  /// the server said, and what the server said is all it records).
  Future<FetchedSettings> get({
    required String organizationId,
  }) async {
    final ApiSuccess response = await _client.send(
      method: 'GET',
      path: '$apiV1Namespace/organizations/$organizationId/settings',
    );
    final Map<String, Object?> json = _map(response);
    return FetchedSettings(
      payload: json,
      settings: OrganizationSettings.fromWire(json),
    );
  }

  /// Submits one field-authorized partial update. The [body] must carry
  /// `settingsVersion` plus only the members being offered. The server's
  /// canonical post-write answer is what this call resolves to — never the
  /// client's draft (§22.3: displayed live data is live, never guessed).
  Future<FetchedSettings> update({
    required String organizationId,
    required Map<String, Object?> body,
  }) async {
    final ApiSuccess response = await _client.send(
      method: 'PUT',
      path: '$apiV1Namespace/organizations/$organizationId/settings',
      body: body,
    );
    final Map<String, Object?> json = _map(response);
    return FetchedSettings(
      payload: json,
      settings: OrganizationSettings.fromWire(json),
    );
  }
}
