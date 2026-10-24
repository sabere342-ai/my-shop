/// The shared chrome of the settings surfaces (M3-S4).
///
/// The pieces the hub, the general editor, and the pricing editor reuse: the
/// feed-state switch (loading, denied, and failures render exactly as their
/// closed kinds state — never a fabricated row), and the save row with the
/// unsaved-changes indicator (mission §5).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_shop_desktop/core/api/api_failure.dart';
import 'package:my_shop_desktop/core/ui/components/app_button.dart';
import 'package:my_shop_desktop/core/ui/components/app_error_state.dart';
import 'package:my_shop_desktop/core/ui/components/app_snackbar.dart';
import 'package:my_shop_desktop/core/ui/theme/app_colors.dart';
import 'package:my_shop_desktop/core/ui/theme/app_radius.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';
import 'package:my_shop_desktop/core/ui/theme/app_typography.dart';
import 'package:my_shop_desktop/features/settings/settings_composition.dart';
import 'package:my_shop_desktop/features/settings/data/settings_repository.dart';
import 'package:my_shop_desktop/l10n/app_localizations.dart';

/// Builds the status surface for [feed]'s non-editor kinds (loading, denied,
/// load-failures, and whole-`AsyncValue` errors); `null` means the state is
/// live or cached data and the caller renders its editor.
Widget? buildSettingsStatus(
  BuildContext context,
  WidgetRef ref,
  AsyncValue<SettingsFeedState> feed,
) {
  final AppLocalizations l10n = AppLocalizations.of(context)!;

  if (feed.isLoading) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const CircularProgressIndicator(),
          const SizedBox(height: AppSpacing.two),
          Text(l10n.settingsLoading, style: AppTypography.caption),
        ],
      ),
    );
  }

  if (feed is AsyncError) {
    return AppErrorState(
      title: l10n.settingsLoadError,
      description: l10n.settingsLoadError,
      actionLabel: l10n.settingsRetry,
      onAction: () => ref.read(settingsFeedProvider.notifier).refresh(),
    );
  }

  final SettingsFeedState? state = feed.value;
  if (state == null) {
    return null;
  }

  switch (state.kind) {
    case SettingsDisplayKind.loading:
      return const Center(child: CircularProgressIndicator());
    case SettingsDisplayKind.denied:
      return AppErrorState(
        title: l10n.settingsDeniedTitle,
        description: l10n.settingsDeniedBody,
      );
    case SettingsDisplayKind.loadFailed:
      return AppErrorState(
        title: l10n.settingsLoadError,
        description: _loadFailureBody(state, l10n),
        actionLabel: l10n.settingsRetry,
        onAction: () => ref.read(settingsFeedProvider.notifier).refresh(),
      );
    case SettingsDisplayKind.live:
    case SettingsDisplayKind.cached:
      return null;
  }
}

/// The honest failure body: a corrupt cache names itself; a withheld
/// attempt names the missing cache; anything else is the load failure.
String _loadFailureBody(SettingsFeedState state, AppLocalizations l10n) {
  if (state.cacheCorruptionReason != null) {
    return l10n.settingsCacheCorrupted;
  }
  final ApiFailure? loadFailure = state.loadFailure;
  if (loadFailure != null) {
    // The transport's refusal (`httpStatus == null`) is the §38.11
    // withheld attempt: the honest copy names the missing cache and the
    // first-connection requirement (mission §7's missing-cache scenario).
    if (loadFailure.httpStatus == null) {
      return l10n.settingsOfflineNoCache;
    }
  }
  return l10n.settingsLoadError;
}

/// The bottom editor row: the unsaved-changes indicator on the start and the
/// save affordance on the end. Hidden entirely while edits are not offered
/// (mission §5: no fake controls — a cached display shows no save button at
/// all).
class SettingsEditorActions extends StatelessWidget {
  const SettingsEditorActions({
    required this.unsavedCount,
    required this.onSave,
    required this.busy,
    required this.enabled,
    super.key,
  });

  /// The draft's touched-field count; zero means the row shows no indicator.
  final int unsavedCount;

  final void Function(BuildContext context) onSave;
  final bool busy;

  /// `false` hides the row entirely (the offline / unpermitted presentation).
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    if (!enabled) {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(0, AppSpacing.one, 0, AppSpacing.three),
      child: Row(
        children: <Widget>[
          if (unsavedCount > 0)
            Expanded(
              child: Text(
                l10n.settingsUnsavedLine(unsavedCount),
                style: AppTypography.caption.copyWith(
                  color: Theme.of(context).colorScheme.primary,
                ),
              ),
            )
          else
            const Spacer(),
          AppButton(
            label: l10n.settingsSaveAction,
            onPressed: busy ? null : () => onSave(context),
            busy: busy,
          ),
        ],
      ),
    );
  }
}

/// What the user chose when a §38.18 conflict interrupted the save.
enum SettingsConflictResolution { keepDraft, discardDraft }

/// The one save interaction every settings editor runs (§22.3, mission §6):
/// the PUT attempt through the feed controller, then the outcome's exact
/// reaction —
///
/// - **saved** → the success banner, and the caller's draft machinery resets;
/// - **conflict** → the reconciliation dialog. The caller's draft is never
///   touched by the dialog itself: *keep* closes the dialog with the draft
///   intact and reloads the authoritative row underneath it; *discard*
///   returns a discard signal the caller translates (clear fields, reload);
/// - **withheld** → the honest no-server-answer message; nothing pretend-saves;
/// - **refused** → the server's refusal copy, draft intact for correction.
final class SettingsSaveFlow {
  const SettingsSaveFlow({
    required this.ref,
    required this.onSaved,
    required this.onDiscarded,
  });

  final WidgetRef ref;

  /// Runs when the server accepted the write (reset the draft).
  final VoidCallback onSaved;

  /// Runs when the user chose "discard my draft" in the conflict dialog.
  final VoidCallback onDiscarded;

  Future<void> run(BuildContext context, Map<String, Object?> body) async {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    final SettingsSaveOutcome outcome = await ref
        .read(settingsFeedProvider.notifier)
        .save(body);
    if (!context.mounted) {
      return;
    }
    switch (outcome) {
      case SettingsSaved():
        AppSnackbar.show(
          context,
          message: l10n.settingsSaved,
          tone: AppSnackbarTone.success,
        );
        onSaved();
      case SettingsSaveConflict():
        await _reconcileConflict(context, l10n);
      case SettingsSaveWithheld():
        AppSnackbar.show(
          context,
          message: l10n.settingsSaveWithheld,
          tone: AppSnackbarTone.error,
        );
      case SettingsSaveRefused():
        AppSnackbar.show(
          context,
          message: l10n.settingsSaveRefused,
          tone: AppSnackbarTone.error,
        );
    }
  }

  Future<void> _reconcileConflict(
    BuildContext context,
    AppLocalizations l10n,
  ) async {
    final SettingsConflictResolution? resolution =
        await showDialog<SettingsConflictResolution>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(l10n.settingsConflictTitle),
        content: Text(l10n.settingsConflictBody),
        actions: <Widget>[
          AppButton(
            label: l10n.settingsDiscardDraftAction,
            onPressed: () => Navigator.of(dialogContext)
                .pop(SettingsConflictResolution.discardDraft),
            variant: AppButtonVariant.danger,
          ),
          AppButton(
            label: l10n.settingsKeepDraftAction,
            onPressed: () => Navigator.of(dialogContext)
                .pop(SettingsConflictResolution.keepDraft),
            variant: AppButtonVariant.secondary,
          ),
        ],
        actionsAlignment: MainAxisAlignment.end,
      ),
    );
    if (!context.mounted) {
      return;
    }
    // The displayed row is stale after a conflict either way; the reload
    // carries the server's canonical version under (or without) the draft —
    // the draft controllers are the caller's and are never touched here.
    final SettingsConflictResolution chosen =
        resolution ?? SettingsConflictResolution.keepDraft;
    if (chosen == SettingsConflictResolution.discardDraft) {
      onDiscarded();
    }
    await ref.read(settingsFeedProvider.notifier).reload();
  }
}

/// One settings field's chrome: the catalogued label, the owner-only badge
/// the §22.2 owner-exclusive rows carry, the control, and the optional
/// reason caption (dispatcher for owner-only / read-only / threshold
/// explanations — every string from the catalog, §6.8).
class SettingsFieldBlock extends StatelessWidget {
  const SettingsFieldBlock({
    required this.label,
    required this.child,
    this.caption,
    this.ownerExclusive = false,
    this.labelTrailing,
    super.key,
  });

  /// The catalogued field name.
  final String label;

  /// The control (field, switch, radio group…).
  final Widget child;

  /// The catalogued caption below the control, if any.
  final String? caption;

  /// Paints the §22.2 owner-exclusive badge beside the label.
  final bool ownerExclusive;

  /// Optional catalogued text at the row's end (a value display, a count).
  final String? labelTrailing;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: Text(label, style: AppTypography.label),
            ),
            if (ownerExclusive)
              Text(
                l10n.settingsOwnerOnly,
                style: AppTypography.caption.copyWith(
                  color: Theme.of(context).colorScheme.primary,
                ),
              ),
            if (labelTrailing != null)
              Text(labelTrailing!, style: AppTypography.caption),
          ],
        ),
        const SizedBox(height: AppSpacing.one),
        child,
        if (caption != null) ...<Widget>[
          const SizedBox(height: AppSpacing.one),
          Text(caption!, style: AppTypography.caption),
        ],
      ],
    );
  }
}

/// The settings surfaces' one dropdown (§6.9: one control shape). The label
/// stays on the block; `onChanged == null` renders the disabled tone.
class SettingsDropdown<T> extends StatelessWidget {
  const SettingsDropdown({
    required this.value,
    required this.items,
    required this.onChanged,
    super.key,
  });

  final T value;
  final List<DropdownMenuItem<T>> items;

  /// `null` disables the control (the unpermitted / offline presentation).
  final ValueChanged<T?>? onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<T>(
      // The value crosses as the field's initial one; the ValueKey forces the
      // form field's internal state to restart whenever the effective value
      // changes (draft set or reset), so the display never lags the model.
      key: ValueKey<T>(value),
      initialValue: value,
      items: items,
      onChanged: onChanged,
      isDense: true,
      decoration: const InputDecoration(
        filled: true,
        fillColor: AppColors.surfaceRaised,
        contentPadding: EdgeInsets.symmetric(
          horizontal: AppSpacing.two,
          vertical: AppSpacing.one,
        ),
        border: OutlineInputBorder(borderRadius: AppRadius.mediumBox),
        enabledBorder: OutlineInputBorder(
          borderRadius: AppRadius.mediumBox,
          borderSide: BorderSide(color: AppColors.outline),
        ),
        disabledBorder: OutlineInputBorder(
          borderRadius: AppRadius.mediumBox,
          borderSide: BorderSide(color: AppColors.outline),
        ),
      ),
    );
  }
}

/// The settings surfaces' one switch row: block label + switch on the row's
/// end (mirrors under Arabic by construction).
class SettingsSwitchRow extends StatelessWidget {
  const SettingsSwitchRow({
    required this.title,
    required this.value,
    required this.onChanged,
    super.key,
  });

  final String title;

  /// Current state: the draft's offered value, else the server row's.
  final bool value;

  /// `null` disables the control (the unpermitted / offline presentation).
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Expanded(child: Text(title, style: AppTypography.body)),
        Switch(value: value, onChanged: onChanged),
      ],
    );
  }
}
