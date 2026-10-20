/// The settings surfaces' shared widgets (M3-S4). The status line is the
/// §38.18 honesty surface — it names what the user is looking at (live server
/// data, or the versioned offline copy) and never lets a cached display
/// masquerade as a live one (mission §7).
library;

import 'package:flutter/material.dart';
import 'package:my_shop_desktop/core/ui/components/app_button.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';
import 'package:my_shop_desktop/core/ui/theme/app_typography.dart';
import 'package:my_shop_desktop/l10n/app_localizations.dart';

/// One calm line, per §38.31's posture: live shows the source and version; a
/// cached display shows the offline wording, the cached version, and the
/// last-sync marker, plus the reconnect affordance the mission's refresh
/// scenario names ("refresh when connectivity returns").
class SettingsStatusLine extends StatelessWidget {
  const SettingsStatusLine({
    required this.isLive,
    required this.settingsVersion,
    this.cachedFetchedAt,
    this.onRefresh,
    super.key,
  });

  final bool isLive;
  final int settingsVersion;

  /// The §38.18 fetch metadata, when the display is cached.
  final DateTime? cachedFetchedAt;

  /// The reconnect affordance (cached displays only; a live display refreshes
  /// through the hub and failure surfaces instead).
  final VoidCallback? onRefresh;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    final String sourceLine = isLive
        ? l10n.settingsSourceLive
        : l10n.settingsOfflineBanner;
    final String versionLine = isLive
        ? l10n.settingsVersionLive(settingsVersion)
        : _cachedLine(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                sourceLine,
                style: AppTypography.caption.copyWith(
                  color: Theme.of(context).colorScheme.secondary,
                ),
              ),
            ),
            if (onRefresh != null)
              SettingsRefreshAction(onRefresh: onRefresh!),
          ],
        ),
        const SizedBox(height: AppSpacing.one),
        Text(versionLine, style: AppTypography.caption),
      ],
    );
  }

  String _cachedLine(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    final DateTime? fetchedAt = cachedFetchedAt;
    final String when = fetchedAt == null
        ? '—'
        : MaterialLocalizations.of(context).formatFullDate(fetchedAt);
    return l10n.settingsCachedLine(settingsVersion, when);
  }
}

/// The reconnect affordance the mission's cached-refresh scenario names.
class SettingsRefreshAction extends StatelessWidget {
  const SettingsRefreshAction({required this.onRefresh, super.key});

  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    return AppButton(
      label: l10n.settingsRetry,
      onPressed: onRefresh,
      variant: AppButtonVariant.secondary,
    );
  }
}
