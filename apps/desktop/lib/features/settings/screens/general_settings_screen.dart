import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_shop_desktop/core/ui/components/app_empty_state.dart';
import 'package:my_shop_desktop/core/ui/components/app_snackbar.dart';
import 'package:my_shop_desktop/core/ui/components/app_text_field.dart';
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

/// The general settings editor (Master Plan §22.2/§22.4): organization
/// identity, currency, display and invoice behaviour, sales rules, and the
/// §22.4 offline rows.
///
/// Ordering rules this screen obeys:
///
/// - **The server row is the baseline; the draft is only offered changes**
///   (§22.3). Untouched controls render the server's values; touched ones
///   render the user's; the PUT re-sends only the touched fields.
/// - **The §22.2 permission column arranges affordances** (mission §8): a
///   field the caller's effective profile does not grant renders disabled
///   with its reason caption, and owner-exclusive rows are read-only facts —
///   only the organization's owner may write them, and the server re-checks
///   every accepted write anyway.
/// - **An offline display never offers edits** (§38.18): the cache is a
///   versioned read-only mirror, its save affordance is absent, and no
///   offline write path exists — not even a privileged one.
class GeneralSettingsScreen extends ConsumerStatefulWidget {
  const GeneralSettingsScreen({super.key});

  @override
  ConsumerState<GeneralSettingsScreen> createState() =>
      _GeneralSettingsScreenState();
}

class _GeneralSettingsScreenState extends ConsumerState<GeneralSettingsScreen> {
  final GeneralSettingsDraft _draft = GeneralSettingsDraft();

  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _footerController = TextEditingController();

  // The §22.2/§22.4 owner-exclusive read-only rows (facts on display, never
  // editable controls — see the class doc).
  final TextEditingController _graceController = TextEditingController();
  final TextEditingController _blockSizeController = TextEditingController();
  final TextEditingController _minorUnitController = TextEditingController();

  /// The `settings_version` the text fields were last filled from. A new
  /// version (a conflict reconciliation, a successful save) re-baselines the
  /// fields; while the version holds and the draft is untouched, the fields
  /// track the baseline they belong with, so a discarded draft is followed
  /// by the server's values, not by stale typed text (mission §6).
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
      // A different row is on display: a draft built against the previous
      // one starts over (§38.18 reconciliation) and never silently carries
      // old offers onto a new base.
      _baselinedVersion = settings.settingsVersion;
      if (_draft.hasChanges || _validationErrors.isNotEmpty) {
        _draft.reset();
        _validationErrors = const <SettingsDraftError>[];
        changed = true;
      }
    }
    if (!_draft.hasChanges) {
      changed = _setText(_nameController, settings.organizationName) || changed;
      changed = _setText(_footerController, settings.invoiceFooter) || changed;
      changed = _setText(
              _graceController, settings.offlineGraceDurationSeconds.toString()) ||
          changed;
      changed =
          _setText(_blockSizeController, settings.reservedBlockSize.toString()) ||
              changed;
      changed =
          _setText(_minorUnitController, settings.minorUnitExponent.toString()) ||
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
      // An affordance-layer guard: the row is hidden for these callers, so
      // reaching the save means the profile changed under them (mission §8).
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

  @override
  void dispose() {
    _nameController.dispose();
    _footerController.dispose();
    _graceController.dispose();
    _blockSizeController.dispose();
    _minorUnitController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    final AsyncValue<SettingsFeedState> feed = ref.watch(settingsFeedProvider);
    final Widget? status = buildSettingsStatus(context, ref, feed);
    if (status != null) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.settingsEntryGeneral)),
        body: Center(child: SingleChildScrollView(child: status)),
      );
    }
    final SettingsFeedState? state = feed.value;
    final OrganizationSettings? settings = state?.settings;
    if (state == null || settings == null) {
      // The closed kinds never render a fabricated editor (mission §7).
      return Scaffold(
        appBar: AppBar(title: Text(l10n.settingsEntryGeneral)),
      );
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncBaseline());

    final bool mayEdit = state.mayOfferEdits;
    final SettingsAccessResolver resolver =
        SettingsAccessResolver(state.authorization);

    // Per-field affordance: one caption rule for every disabled control —
    // owner-exclusive rows name their owner gate; the rest name the offline
    // truth (§38.18).
    String captionFor(SettingsField field) {
      final SettingsFieldAccess access = resolver.access(field);
      if (access.editable) {
        return '';
      }
      return access.ownerExclusive
          ? l10n.settingsOwnerOnlyCaption
          : l10n.settingsReadonlyOfflineCaption;
    }

    SettingsFieldAccess accessOf(SettingsField field) => resolver.access(field);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsEntryGeneral)),
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
              _section(
                context,
                l10n.settingsSectionIdentity,
                ResponsiveFieldGrid(blocks: <Widget>[
                  _block(
                    field: SettingsField.organizationName,
                    access: accessOf(SettingsField.organizationName),
                    label: l10n.settingsFieldOrganizationName,
                    caption: captionFor(SettingsField.organizationName),
                    child: AppTextField(
                      key: const Key('general-name-field'),
                      controller: _nameController,
                      enabled: mayEdit &&
                          accessOf(SettingsField.organizationName).editable,
                      errorText:
                          _validationErrors.contains(
                                  SettingsDraftError.organizationNameEmpty)
                              ? l10n.settingsFieldNameError
                              : null,
                      onChanged: (String text) => setState(() {
                        _draft.setOrganizationName(text);
                        _validationErrors = _validationErrors
                            .where((SettingsDraftError error) =>
                                error !=
                                SettingsDraftError.organizationNameEmpty)
                            .toList();
                      }),
                    ),
                  ),
                  _block(
                    field: SettingsField.currency,
                    access: accessOf(SettingsField.currency),
                    label: l10n.settingsFieldCurrency,
                    caption: captionFor(SettingsField.currency),
                    child: SettingsDropdown<CurrencyCode>(
                      key: const Key('general-currency-dropdown'),
                      value: _draft.currency ?? settings.currency,
                      items: CurrencyCode.values
                          .map<DropdownMenuItem<CurrencyCode>>(
                        (CurrencyCode code) => DropdownMenuItem<CurrencyCode>(
                          value: code,
                          child: Text(l10n.settingsCurrencyEgp),
                        ),
                      ).toList(),
                      onChanged: mayEdit &&
                              accessOf(SettingsField.currency).editable
                          ? (CurrencyCode? value) => setState(() {
                                if (value != null) {
                                  _draft.setCurrency(value);
                                }
                              })
                          : null,
                    ),
                  ),
                ]),
              ),
              _section(
                context,
                l10n.settingsSectionMoney,
                ResponsiveFieldGrid(blocks: <Widget>[
                  _block(
                    field: SettingsField.minorUnitExponent,
                    access: accessOf(SettingsField.minorUnitExponent),
                    label: l10n.settingsFieldMinorUnitExponent,
                    caption: captionFor(SettingsField.minorUnitExponent),
                    child: AppTextField(
                      key: const Key('general-minor-unit-field'),
                      controller: _minorUnitController,
                      enabled: false,
                    ),
                  ),
                  _block(
                    field: SettingsField.displayNumerals,
                    access: accessOf(SettingsField.displayNumerals),
                    label: l10n.settingsFieldDisplayNumerals,
                    caption: captionFor(SettingsField.displayNumerals),
                    child: SettingsDropdown<DisplayNumerals>(
                      key: const Key('general-numerals-dropdown'),
                      value: _draft.displayNumerals ?? settings.displayNumerals,
                      items: DisplayNumerals.values
                          .map<DropdownMenuItem<DisplayNumerals>>(
                        (DisplayNumerals value1) =>
                            DropdownMenuItem<DisplayNumerals>(
                          value: value1,
                          child: Text(value1 == DisplayNumerals.western
                              ? l10n.settingsNumeralsWestern
                              : l10n.settingsNumeralsEastern),
                        ),
                      ).toList(),
                      onChanged: mayEdit &&
                              accessOf(SettingsField.displayNumerals).editable
                          ? (DisplayNumerals? value) => setState(() {
                                if (value != null) {
                                  _draft.setDisplayNumerals(value);
                                }
                              })
                          : null,
                    ),
                  ),
                  _block(
                    field: SettingsField.roundingMode,
                    access: accessOf(SettingsField.roundingMode),
                    label: l10n.settingsFieldRoundingMode,
                    caption: captionFor(SettingsField.roundingMode),
                    child: SettingsDropdown<RoundingMode>(
                      value: settings.roundingMode,
                      items: RoundingMode.values
                          .map<DropdownMenuItem<RoundingMode>>(
                        (RoundingMode mode) => DropdownMenuItem<RoundingMode>(
                          value: mode,
                          child: Text(mode == RoundingMode.halfUp
                              ? l10n.settingsRoundingHalfUp
                              : l10n.settingsRoundingHalfEven),
                        ),
                      ).toList(),
                      // Owner-exclusive: a read-only fact in this client (see
                      // the class doc); the owner changes it through the
                      // server's own authority, not a client-side draft.
                      onChanged: null,
                    ),
                  ),
                ]),
              ),
              _section(
                context,
                l10n.settingsSectionInvoice,
                ResponsiveFieldGrid(blocks: <Widget>[
                  _block(
                    field: SettingsField.invoiceOutputDefault,
                    access: accessOf(SettingsField.invoiceOutputDefault),
                    label: l10n.settingsFieldInvoiceOutput,
                    caption: captionFor(SettingsField.invoiceOutputDefault),
                    child: SettingsDropdown<InvoiceOutputDefault>(
                      value: _draft.invoiceOutputDefault ??
                          settings.invoiceOutputDefault,
                      items: InvoiceOutputDefault.values
                          .map<DropdownMenuItem<InvoiceOutputDefault>>(
                        (InvoiceOutputDefault value1) =>
                            DropdownMenuItem<InvoiceOutputDefault>(
                          value: value1,
                          child: Text(
                            switch (value1) {
                              InvoiceOutputDefault.alwaysAsk =>
                                l10n.settingsInvoiceAlwaysAsk,
                              InvoiceOutputDefault.printAutomatically =>
                                l10n.settingsInvoicePrintAutomatically,
                              InvoiceOutputDefault.noAutomaticOutput =>
                                l10n.settingsInvoiceNoAutomaticOutput,
                            },
                          ),
                        ),
                      ).toList(),
                      onChanged: mayEdit &&
                              accessOf(SettingsField.invoiceOutputDefault)
                                  .editable
                          ? (InvoiceOutputDefault? value) => setState(() {
                                if (value != null) {
                                  _draft.setInvoiceOutputDefault(value);
                                }
                              })
                          : null,
                    ),
                  ),
                  _block(
                    field: SettingsField.invoiceShowLogo,
                    access: accessOf(SettingsField.invoiceShowLogo),
                    label: l10n.settingsFieldInvoiceShowLogo,
                    caption: captionFor(SettingsField.invoiceShowLogo),
                    child: SettingsSwitchRow(
                      title: l10n.settingsFieldInvoiceShowLogo,
                      value: _draft.invoiceShowLogo ?? settings.invoiceShowLogo,
                      onChanged: mayEdit &&
                              accessOf(SettingsField.invoiceShowLogo).editable
                          ? (bool value) =>
                              setState(() => _draft.setInvoiceShowLogo(value))
                          : null,
                    ),
                  ),
                  _block(
                    field: SettingsField.invoiceFooter,
                    access: accessOf(SettingsField.invoiceFooter),
                    label: l10n.settingsFieldInvoiceFooter,
                    caption: captionFor(SettingsField.invoiceFooter),
                    child: AppTextField(
                      controller: _footerController,
                      enabled: mayEdit &&
                          accessOf(SettingsField.invoiceFooter).editable,
                      maxLines: 3,
                      errorText:
                          _validationErrors.contains(
                                  SettingsDraftError.invoiceFooterTooLong)
                              ? l10n.settingsFieldFooterError
                              : null,
                      onChanged: (String text) => setState(() {
                        _draft.setInvoiceFooter(text);
                        _validationErrors = _validationErrors
                            .where((SettingsDraftError error) =>
                                error !=
                                SettingsDraftError.invoiceFooterTooLong)
                            .toList();
                      }),
                    ),
                  ),
                ]),
              ),
              _section(
                context,
                l10n.settingsSectionSales,
                ResponsiveFieldGrid(blocks: <Widget>[
                  _block(
                    field: SettingsField.customerRequiredOnCreditSale,
                    access: accessOf(
                        SettingsField.customerRequiredOnCreditSale),
                    label: l10n.settingsFieldCustomerRequiredOnCredit,
                    caption:
                        captionFor(SettingsField.customerRequiredOnCreditSale),
                    child: SettingsSwitchRow(
                      title: l10n.settingsFieldCustomerRequiredOnCredit,
                      value: _draft.customerRequiredOnCreditSale ??
                          settings.customerRequiredOnCreditSale,
                      onChanged: mayEdit &&
                              accessOf(SettingsField.customerRequiredOnCreditSale)
                                  .editable
                          ? (bool value) => setState(
                              () => _draft.setCustomerRequiredOnCreditSale(value))
                          : null,
                    ),
                  ),
                  _block(
                    field: SettingsField.receivablesAgingEnabled,
                    access: accessOf(SettingsField.receivablesAgingEnabled),
                    label: l10n.settingsFieldReceivablesAging,
                    caption:
                        captionFor(SettingsField.receivablesAgingEnabled),
                    child: SettingsSwitchRow(
                      title: l10n.settingsFieldReceivablesAging,
                      value: _draft.receivablesAgingEnabled ??
                          settings.receivablesAgingEnabled,
                      onChanged: mayEdit &&
                              accessOf(SettingsField.receivablesAgingEnabled)
                                  .editable
                          ? (bool value) => setState(
                              () => _draft.setReceivablesAgingEnabled(value))
                          : null,
                    ),
                  ),
                ]),
              ),
              _section(
                context,
                l10n.settingsSectionOffline,
                ResponsiveFieldGrid(blocks: <Widget>[
                  _block(
                    field: SettingsField.offlineGraceDurationSeconds,
                    access: accessOf(SettingsField.offlineGraceDurationSeconds),
                    label: l10n.settingsFieldOfflineGrace,
                    caption: captionFor(
                        SettingsField.offlineGraceDurationSeconds),
                    child: AppTextField(
                      controller: _graceController,
                      enabled: false,
                    ),
                  ),
                  _block(
                    field: SettingsField.offlineReceiptIdFormat,
                    access: accessOf(SettingsField.offlineReceiptIdFormat),
                    label: l10n.settingsFieldReceiptFormat,
                    caption: captionFor(SettingsField.offlineReceiptIdFormat),
                    child: SettingsDropdown<OfflineReceiptIdFormat>(
                      value: _draft.offlineReceiptIdFormat ??
                          settings.offlineReceiptIdFormat,
                      items: OfflineReceiptIdFormat.values
                          .map<DropdownMenuItem<OfflineReceiptIdFormat>>(
                        (OfflineReceiptIdFormat format) =>
                            DropdownMenuItem<OfflineReceiptIdFormat>(
                          value: format,
                          child: Text(l10n.settingsReceiptFormatOrgDevSeq),
                        ),
                      ).toList(),
                      onChanged: mayEdit &&
                              accessOf(SettingsField.offlineReceiptIdFormat)
                                  .editable
                          ? (OfflineReceiptIdFormat? value) => setState(() {
                                if (value != null) {
                                  _draft.setOfflineReceiptIdFormat(value);
                                }
                              })
                          : null,
                    ),
                  ),
                  _block(
                    field: SettingsField.offlineReservedNumberBlocks,
                    access: accessOf(
                        SettingsField.offlineReservedNumberBlocks),
                    label: l10n.settingsFieldOfflineReservedBlocks,
                    caption: captionFor(
                        SettingsField.offlineReservedNumberBlocks),
                    child: SettingsSwitchRow(
                      title: l10n.settingsFieldOfflineReservedBlocks,
                      value: _draft.offlineReservedNumberBlocks ??
                          settings.offlineReservedNumberBlocks,
                      onChanged: mayEdit &&
                              accessOf(SettingsField.offlineReservedNumberBlocks)
                                  .editable
                          ? (bool value) => setState(
                              () => _draft.setOfflineReservedNumberBlocks(value))
                          : null,
                    ),
                  ),
                  _block(
                    field: SettingsField.reservedBlockSize,
                    access: accessOf(SettingsField.reservedBlockSize),
                    label: l10n.settingsFieldReservedBlockSize,
                    caption: captionFor(SettingsField.reservedBlockSize),
                    child: AppTextField(
                      controller: _blockSizeController,
                      enabled: false,
                    ),
                  ),
                ]),
              ),
              _section(
                context,
                l10n.settingsFeatureFlagsHeading,
                settings.featureFlags.isEmpty
                    ? AppEmptyState(
                        title: l10n.settingsFeatureFlagsHeading,
                        description: l10n.settingsFeatureFlagsEmpty,
                      )
                    : SettingsFieldBlock(
                        label: l10n.settingsFeatureFlagsHeading,
                        caption: captionFor(SettingsField.featureFlags),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            for (final FeatureFlagState flag
                                in settings.featureFlags)
                              Text(
                                l10n.settingsFeatureFlagRow(
                                  flag.key,
                                  flag.enabled
                                      ? l10n.settingsFeatureFlagOn
                                      : l10n.settingsFeatureFlagOff,
                                ),
                                style: AppTypography.caption,
                              ),
                          ],
                        ),
                      ),
              ),
              SettingsEditorActions(
                unsavedCount: _draft.changedFieldCount,
                busy: _busy,
                enabled:
                    mayEdit && resolver.mayEditArea(SettingsEditingArea.general),
                onSave: (BuildContext context) => _save(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _section(
    BuildContext context,
    String title,
    Widget content,
  ) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.four),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(title, style: AppTypography.title),
          const SizedBox(height: AppSpacing.two),
          content,
        ],
      ),
    );
  }

  /// One field block: label, §22.2 owner badge, control, reason caption.
  Widget _block({
    required SettingsField field,
    required SettingsFieldAccess access,
    required String label,
    required String caption,
    required Widget child,
  }) {
    return SettingsFieldBlock(
      label: label,
      caption: caption.isEmpty ? null : caption,
      ownerExclusive: access.ownerExclusive,
      child: child,
    );
  }
}
