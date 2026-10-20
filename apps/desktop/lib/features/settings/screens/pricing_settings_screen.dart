import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_shop_desktop/core/ui/components/app_button.dart';
import 'package:my_shop_desktop/core/ui/components/app_confirm_dialog.dart';
import 'package:my_shop_desktop/core/ui/components/app_money_field.dart';
import 'package:my_shop_desktop/core/ui/components/app_snackbar.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';
import 'package:my_shop_desktop/core/ui/theme/app_typography.dart';
import 'package:my_shop_desktop/features/settings/models/organization_settings.dart';
import 'package:my_shop_desktop/features/settings/models/settings_draft.dart';
import 'package:my_shop_desktop/features/settings/screens/settings_scaffold.dart';
import 'package:my_shop_desktop/features/settings/settings_composition.dart';
import 'package:my_shop_desktop/features/settings/settings_gates.dart';
import 'package:my_shop_desktop/features/settings/widgets/responsive_field_grid.dart';
import 'package:my_shop_desktop/features/settings/widgets/settings_status_line.dart';
import 'package:my_shop_desktop/l10n/app_localizations.dart';

/// The pricing & discount editor (Master Plan §17, §18): the three §17
/// pricing modes and the §18 typed discount policy.
///
/// The discount policy is a **material change**: before a PUT that would
/// carry any of the §18 fields leaves the client, the editor asks for an
/// explicit confirmation — the §18 ceiling governs the server's discount
/// decisions, so an accidental save is a pricing decision (§30), not a
/// formality. The §18 percentage stays exact integer hundredths end to end
/// (`PricingPolicyDraft`), and no float ever chooses validity.
///
/// The same affordance rules as the general editor apply (mission §8, §38.18):
/// `pricing.policy.edit` gates the controls, owner rows and offline displays
/// read back, and the server re-checks every offered write.
class PricingSettingsScreen extends ConsumerStatefulWidget {
  const PricingSettingsScreen({super.key});

  @override
  ConsumerState<PricingSettingsScreen> createState() =>
      _PricingSettingsScreenState();
}

class _PricingSettingsScreenState extends ConsumerState<PricingSettingsScreen> {
  final PricingPolicyDraft _draft = PricingPolicyDraft();

  final TextEditingController _percentageController = TextEditingController();
  final TextEditingController _amountController = TextEditingController();
  final TextEditingController _thresholdController = TextEditingController();

  int? _baselinedVersion;
  List<SettingsDraftError> _validationErrors = const <SettingsDraftError>[];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncBaseline());
  }

  void _syncBaseline() {
    final OrganizationSettings? settings =
        ref.read(settingsFeedProvider).value?.settings;
    if (settings == null) {
      return;
    }
    bool changed = false;
    if (_baselinedVersion != settings.settingsVersion) {
      _baselinedVersion = settings.settingsVersion;
      if (_draft.hasChanges || _validationErrors.isNotEmpty) {
        _draft.reset();
        _validationErrors = const <SettingsDraftError>[];
        changed = true;
      }
    }
    if (!_draft.hasChanges) {
      changed = _setText(
              _percentageController, settings.maxDiscountPercentageText) ||
          changed;
      changed =
          _setText(_amountController, settings.maxDiscountAmountMinorText) ||
              changed;
      changed = _setText(
              _thresholdController,
              settings.discountApprovalThresholdText ?? '') ||
          changed;
    }
    if (changed && mounted) {
      setState(() {});
    }
  }

  bool _setText(TextEditingController controller, String text) {
    if (controller.text == text) {
      return false;
    }
    controller.text = text;
    return true;
  }

  void _resetDraft() {
    setState(() {
      _draft.reset();
      _validationErrors = const <SettingsDraftError>[];
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncBaseline());
  }

  Future<void> _save() async {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    final SettingsFeedState? state = ref.read(settingsFeedProvider).value;
    final OrganizationSettings? settings = state?.settings;
    if (state == null || settings == null || _busy) {
      return;
    }
    if (!state.canSave) {
      AppSnackbar.show(
        context,
        message: l10n.settingsSavePermissionDenied,
        tone: AppSnackbarTone.error,
      );
      return;
    }
    if (!_draft.hasChanges) {
      return;
    }
    setState(() => _validationErrors = _draft.validate());
    if (_validationErrors.isNotEmpty) {
      AppSnackbar.show(
        context,
        message: l10n.settingsSaveValidationError,
        tone: AppSnackbarTone.error,
      );
      return;
    }
    // The §18 policy is material: an explicit Yes precedes the PUT (§30).
    final bool confirmed = await AppConfirmDialog.show(
      context: context,
      dialog: AppConfirmDialog(
        title: l10n.settingsConfirmMaterialTitle,
        message: l10n.settingsConfirmMaterialBody,
        confirmLabel: l10n.settingsSaveAction,
        cancelLabel: l10n.settingsCancelAction,
      ),
    );
    if (!confirmed) {
      return;
    }
    if (!mounted) {
      return;
    }
    setState(() => _busy = true);
    await SettingsSaveFlow(
      ref: ref,
      onSaved: _resetDraft,
      onDiscarded: _resetDraft,
    ).run(context, _draft.requestBody(settings.settingsVersion));
    if (mounted) {
      setState(() => _busy = false);
    }
  }

  void _clearThreshold() {
    _thresholdController.clear();
    setState(() {
      _draft.setThresholdText('');
      _discard(SettingsDraftError.amountInvalid);
      _discard(SettingsDraftError.amountOutOfRange);
    });
  }

  void _discard(SettingsDraftError error) {
    _validationErrors =
        _validationErrors.where((SettingsDraftError value) => value != error).toList();
  }

  @override
  void dispose() {
    _percentageController.dispose();
    _amountController.dispose();
    _thresholdController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    final AsyncValue<SettingsFeedState> feed = ref.watch(settingsFeedProvider);
    final Widget? status = buildSettingsStatus(context, ref, feed);
    if (status != null) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.settingsEntryPricing)),
        body: Center(child: SingleChildScrollView(child: status)),
      );
    }
    final SettingsFeedState? state = feed.value;
    final OrganizationSettings? settings = state?.settings;
    if (state == null || settings == null) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.settingsEntryPricing)),
      );
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncBaseline());

    final bool mayEdit = state.mayOfferEdits;
    final SettingsAccessResolver resolver =
        SettingsAccessResolver(state.authorization);

    SettingsFieldAccess accessOf(SettingsField field) => resolver.access(field);
    bool editable(SettingsField field) =>
        mayEdit && accessOf(field).editable && state.canSave;
    String captionFor(SettingsField field) {
      final SettingsFieldAccess access = accessOf(field);
      if (access.editable) {
        return '';
      }
      return access.ownerExclusive
          ? l10n.settingsOwnerOnlyCaption
          : l10n.settingsReadonlyOfflineCaption;
    }

    final PricingMode effectiveMode = _draft.pricingMode ?? settings.pricingMode;
    final String? effectiveThreshold = _draft.thresholdCleared
        ? ''
        : (_draft.thresholdText ?? settings.discountApprovalThresholdText);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsEntryPricing)),
      body: Center(
        child: ConstrainedBox(
          constraints:
              const BoxConstraints(maxWidth: AppSpacing.panelWidth * 2),
          child: ListView(
            padding: const EdgeInsets.all(AppSpacing.three),
            children: <Widget>[
              SettingsStatusLine(
                isLive: state.kind == SettingsDisplayKind.live,
                settingsVersion: settings.settingsVersion,
                cachedFetchedAt: state.cachedFetchedAt,
              ),
              const SizedBox(height: AppSpacing.four),
              // The §17 mode selector: three explained choices, a material
              // decision like the policy beneath it.
              SettingsFieldBlock(
                label: l10n.settingsFieldPricingMode,
                caption: captionFor(SettingsField.pricingMode),
                child: RadioGroup<PricingMode>(
                  groupValue: effectiveMode,
                  // The group's change handler is the required registry sink;
                  // the per-tile `enabled` flag still renders the disabled
                  // affordance (mission §8: disabled, not hidden).
                  onChanged: (PricingMode? value) {
                    if (value != null && editable(SettingsField.pricingMode)) {
                      setState(() => _draft.setPricingMode(value));
                    }
                  },
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      for (final PricingMode mode in PricingMode.values)
                        RadioListTile<PricingMode>(
                          key: Key('pricing-mode-${mode.wire}'),
                          value: mode,
                          enabled: editable(SettingsField.pricingMode),
                          title: Text(_modeName(context, mode)),
                          subtitle: Text(_modeDescription(context, mode)),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.four),
              // The §18 policy section: its caption names where the policy
              // applies and that the server verifies every write.
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.one),
                child: Text(
                  l10n.settingsSectionDiscountPolicy,
                  style: AppTypography.title,
                ),
              ),
              Text(l10n.settingsDiscountModeCaption,
                  style: AppTypography.caption),
              const SizedBox(height: AppSpacing.two),
              ResponsiveFieldGrid(blocks: <Widget>[
                SettingsFieldBlock(
                  label: l10n.settingsFieldMaxDiscountPercentage,
                  caption: captionFor(SettingsField.maxDiscountPercentage),
                  child: AppMoneyField(
                    key: const Key('pricing-percentage-field'),
                    controller: _percentageController,
                    enabled: editable(SettingsField.maxDiscountPercentage),
                    errorText: _validationErrors
                            .contains(SettingsDraftError.percentageInvalid)
                        ? l10n.settingsPercentageError
                        : null,
                    onChanged: (String text) => setState(() {
                      _draft.setPercentageText(text);
                      _discard(SettingsDraftError.percentageInvalid);
                    }),
                  ),
                ),
                SettingsFieldBlock(
                  label: l10n.settingsFieldMaxDiscountAmount,
                  caption: captionFor(SettingsField.maxDiscountAmountMinor),
                  child: AppMoneyField(
                    key: const Key('pricing-amount-field'),
                    controller: _amountController,
                    enabled: editable(SettingsField.maxDiscountAmountMinor),
                    errorText: _validationErrors
                            .contains(SettingsDraftError.amountInvalid)
                        ? l10n.settingsAmountError
                        : _validationErrors.contains(
                                SettingsDraftError.amountOutOfRange)
                            ? l10n.settingsAmountRangeError
                            : null,
                    onChanged: (String text) => setState(() {
                      _draft.setMaxAmountText(text);
                      _discard(SettingsDraftError.amountInvalid);
                      _discard(SettingsDraftError.amountOutOfRange);
                    }),
                  ),
                ),
              ]),
              const SizedBox(height: AppSpacing.two),
              SettingsFieldBlock(
                label: l10n.settingsFieldApprovalThreshold,
                caption: captionFor(
                    SettingsField.discountApprovalThresholdMinor),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    AppMoneyField(
                      key: const Key('pricing-threshold-field'),
                      controller: _thresholdController,
                      enabled: editable(
                          SettingsField.discountApprovalThresholdMinor),
                      errorText: _validationErrors
                              .contains(SettingsDraftError.amountInvalid)
                          ? l10n.settingsAmountError
                          : null,
                      onChanged: (String text) => setState(() {
                        _draft.setThresholdText(text);
                        _discard(SettingsDraftError.amountInvalid);
                      }),
                    ),
                    // The §22.2 nullable decision surfaced: an empty field is
                    // "the gate is off", not an unedited value; clearing is an
                    // explicit user act that crosses as a JSON null (§22.3).
                    if (editable(SettingsField.discountApprovalThresholdMinor))
                      Padding(
                        padding: const EdgeInsets.only(top: AppSpacing.one),
                        child: AppButton(
                          key: const Key('pricing-threshold-clear'),
                          label: l10n.settingsApprovalThresholdClearCaption,
                          variant: AppButtonVariant.secondary,
                          onPressed: _clearThreshold,
                        ),
                      ),
                    if ((effectiveThreshold ?? '').isEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: AppSpacing.one),
                        child: Text(
                          l10n.settingsApprovalThresholdEmptyCaption,
                          style: AppTypography.caption,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.two),
              ResponsiveFieldGrid(blocks: <Widget>[
                SettingsSwitchRow(
                  title: l10n.settingsFieldSalespersonAllowed,
                  value: _draft.salespersonAllowed ??
                      settings.discountAllowedForSalesperson,
                  onChanged: editable(
                          SettingsField.discountAllowedForSalesperson)
                      ? (bool value) =>
                          setState(() => _draft.setSalespersonAllowed(value))
                      : null,
                ),
                SettingsSwitchRow(
                  title: l10n.settingsFieldBlockBelowCost,
                  value: _draft.blockBelowCost ?? settings.blockDiscountBelowCost,
                  onChanged: editable(SettingsField.blockDiscountBelowCost)
                      ? (bool value) =>
                          setState(() => _draft.setBlockBelowCost(value))
                      : null,
                ),
              ]),
              SettingsEditorActions(
                unsavedCount: _draft.changedFieldCount,
                busy: _busy,
                enabled: mayEdit &&
                    resolver.mayEditArea(SettingsEditingArea.pricingPolicy),
                onSave: (BuildContext context) => _save(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// The catalogued names/descriptions of the three §17 modes (their switch
  /// to the wire vocabulary happens in the [PricingPolicyDraft]).
  String _modeName(BuildContext context, PricingMode mode) => switch (mode) {
        PricingMode.fixed =>
          AppLocalizations.of(context)!.settingsModeFixedName,
        PricingMode.variable =>
          AppLocalizations.of(context)!.settingsModeVariableName,
        PricingMode.fixedWithDiscount =>
          AppLocalizations.of(context)!.settingsModeFixedWithDiscountName,
      };

  String _modeDescription(BuildContext context, PricingMode mode) =>
      switch (mode) {
        PricingMode.fixed =>
          AppLocalizations.of(context)!.settingsModeFixedDescription,
        PricingMode.variable =>
          AppLocalizations.of(context)!.settingsModeVariableDescription,
        PricingMode.fixedWithDiscount =>
          AppLocalizations.of(context)!.settingsModeFixedWithDiscountDescription,
      };
}
