import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:my_shop_desktop/app/router/route_paths.dart';
import 'package:my_shop_desktop/core/auth/app_session_notifier.dart';
import 'package:my_shop_desktop/core/offline/grace/offline_grace_service.dart';
import 'package:my_shop_desktop/core/ui/components/app_button.dart';
import 'package:my_shop_desktop/core/ui/components/app_empty_state.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';
import 'package:my_shop_desktop/core/ui/theme/app_typography.dart';
import 'package:my_shop_desktop/l10n/app_localizations.dart';

/// The authenticated workspace shell (Master Plan section 6.6).
///
/// It is registered at `RoutePaths.home` and currently renders the section
/// 6.2 promise honestly: the frame, the chrome and the catalogued copy of a
/// shell, with no fabricated business screens. The one status it carries is
/// the section 38.31 offline-grace line: **calm** by construction — one
/// caption when the session's authorization facts are cached locally, a
/// plain read-only sentence when they are not, and no line at all when there
/// is no grace session to describe.
class ShellScreen extends ConsumerWidget {
  const ShellScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    final AsyncValue<OfflineGraceStatus> grace = ref.watch(appGraceStatusProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.appTitle)),
      body: Column(
        children: <Widget>[
          if (grace.asData?.value case final OfflineGraceStatus status?)
            _GraceLine(status: status),
          if (grace.hasError) Text(l10n.shellGraceUnavailable),
          Expanded(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.three),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    AppEmptyState(title: l10n.shellTitle, description: l10n.shellBody),
                    const SizedBox(height: AppSpacing.two),
                    AppButton(
                      label: l10n.shellOpenSettings,
                      onPressed: () => context.go(RoutePaths.settings),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The single calm line (section 38.31). It never asks for attention: no
/// colour of its own beyond the theme's secondary, no icon, no action.
class _GraceLine extends StatelessWidget {
  const _GraceLine({required this.status});

  final OfflineGraceStatus status;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    if (!status.hasSession) {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.one),
      child: Text(
        status.isReadOnlyForMutations
            ? l10n.shellGraceReadOnly
            : l10n.shellGraceActive,
        style: AppTypography.caption.copyWith(
          color: Theme.of(context).colorScheme.secondary,
        ),
        textAlign: TextAlign.center,
      ),
    );
  }
}
