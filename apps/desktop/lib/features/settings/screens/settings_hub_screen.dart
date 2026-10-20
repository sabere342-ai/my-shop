import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:my_shop_desktop/app/router/route_paths.dart';
import 'package:my_shop_desktop/core/ui/components/app_button.dart';
import 'package:my_shop_desktop/core/ui/theme/app_colors.dart';
import 'package:my_shop_desktop/core/ui/theme/app_radius.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';
import 'package:my_shop_desktop/core/ui/theme/app_typography.dart';
import 'package:my_shop_desktop/features/settings/screens/settings_scaffold.dart'
    show buildSettingsStatus;
import 'package:my_shop_desktop/features/settings/settings_composition.dart';
import 'package:my_shop_desktop/features/settings/widgets/settings_status_line.dart';
import 'package:my_shop_desktop/l10n/app_localizations.dart';

/// The settings hub (Master Plan §22): the entry the router's `/settings`
/// answers. The feed (loading / denied / failure) renders through
/// [buildSettingsStatus]; only a live or cached display reaches the two
/// entries — the §22.2 identity/operations screen and the §17/§18 pricing
/// screen. `settings.view` is a server decision; what the hub shows is the
/// server's own answer as the feed classifies it (mission §7).
class SettingsHubScreen extends ConsumerWidget {
  const SettingsHubScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    final AsyncValue<SettingsFeedState> feed = ref.watch(settingsFeedProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsTitle)),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: AppSpacing.panelWidth * 1.5),
          child: ListView(
            padding: const EdgeInsets.all(AppSpacing.three),
            children: <Widget>[
              Text(l10n.settingsHubSubtitle, style: AppTypography.body),
              const SizedBox(height: AppSpacing.three),
              _HubBody(feed: feed),
            ],
          ),
        ),
      ),
    );
  }
}

final class _HubBody extends ConsumerWidget {
  const _HubBody({required this.feed});

  final AsyncValue<SettingsFeedState> feed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    final Widget? status = buildSettingsStatus(context, ref, feed);
    if (status != null) {
      return status;
    }

    final SettingsFeedState? state = feed.value;
    if (state == null || state.settings == null) {
      // The closed kinds never render a fabricated frame (mission §7).
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        SettingsStatusLine(
          isLive: state.kind == SettingsDisplayKind.live,
          settingsVersion: state.settings!.settingsVersion,
          cachedFetchedAt: state.cachedFetchedAt,
          onRefresh: state.kind == SettingsDisplayKind.cached
              ? () => ref.read(settingsFeedProvider.notifier).refresh()
              : null,
        ),
        const SizedBox(height: AppSpacing.three),
        _SettingsEntry(
          title: l10n.settingsEntryGeneral,
          description: l10n.settingsEntryGeneralDescription,
          onTap: () => context.push(RoutePaths.settingsGeneral),
        ),
        _SettingsEntry(
          title: l10n.settingsEntryPricing,
          description: l10n.settingsEntryPricingDescription,
          onTap: () => context.push(RoutePaths.settingsPricing),
        ),
        const SizedBox(height: AppSpacing.two),
        if (state.kind == SettingsDisplayKind.cached)
          AppButton(
            label: l10n.settingsRetry,
            variant: AppButtonVariant.secondary,
            onPressed: () => ref.read(settingsFeedProvider.notifier).refresh(),
          ),
      ],
    );
  }
}

/// One settings entry card: catalogued title and description, navigated with
/// `go_router` so the guard still governs every hop (mission §6.6).
final class _SettingsEntry extends StatelessWidget {
  const _SettingsEntry({
    required this.title,
    required this.description,
    required this.onTap,
  });

  final String title;
  final String description;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.two),
      child: Material(
        color: AppColors.surfaceRaised,
        borderRadius: AppRadius.mediumBox,
        child: InkWell(
          borderRadius: AppRadius.mediumBox,
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.two),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(title, style: AppTypography.title),
                      const SizedBox(height: AppSpacing.one),
                      Text(description, style: AppTypography.body),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

