import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_ar.dart';
import 'app_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations? of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations);
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ar'),
    Locale('en'),
  ];

  /// No description provided for @appTitle.
  ///
  /// In ar, this message translates to:
  /// **'My Shop'**
  String get appTitle;

  /// No description provided for @shellTitle.
  ///
  /// In ar, this message translates to:
  /// **'مساحة العمل'**
  String get shellTitle;

  /// No description provided for @shellBody.
  ///
  /// In ar, this message translates to:
  /// **'اختر مكان العمل من القائمة.'**
  String get shellBody;

  /// No description provided for @shellOpenSettings.
  ///
  /// In ar, this message translates to:
  /// **'الإعدادات'**
  String get shellOpenSettings;

  /// No description provided for @notFoundTitle.
  ///
  /// In ar, this message translates to:
  /// **'الصفحة غير موجودة'**
  String get notFoundTitle;

  /// No description provided for @notFoundBody.
  ///
  /// In ar, this message translates to:
  /// **'ربما حُذف الرابط أو تغيّر.'**
  String get notFoundBody;

  /// No description provided for @backToHome.
  ///
  /// In ar, this message translates to:
  /// **'العودة إلى البداية'**
  String get backToHome;

  /// No description provided for @authSignInTitle.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الدخول'**
  String get authSignInTitle;

  /// No description provided for @authEmailLabel.
  ///
  /// In ar, this message translates to:
  /// **'البريد الإلكتروني'**
  String get authEmailLabel;

  /// No description provided for @authPasswordLabel.
  ///
  /// In ar, this message translates to:
  /// **'كلمة السر'**
  String get authPasswordLabel;

  /// No description provided for @authSignInAction.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الدخول'**
  String get authSignInAction;

  /// No description provided for @authInvalidCredentials.
  ///
  /// In ar, this message translates to:
  /// **'البريد الإلكتروني أو كلمة السر غير صحيحة.'**
  String get authInvalidCredentials;

  /// No description provided for @authRateLimited.
  ///
  /// In ar, this message translates to:
  /// **'ثمة محاولات كثيرة؛ انتظر قليلًا ثم أعد المحاولة.'**
  String get authRateLimited;

  /// No description provided for @authRefused.
  ///
  /// In ar, this message translates to:
  /// **'رفض الخادم الطلب؛ راجع البيانات وأعد المحاولة.'**
  String get authRefused;

  /// No description provided for @authWithheld.
  ///
  /// In ar, this message translates to:
  /// **'لم يصل رد من الخادم؛ تحقق من الاتصال وأعد المحاولة.'**
  String get authWithheld;

  /// No description provided for @authChooseOrganizationTitle.
  ///
  /// In ar, this message translates to:
  /// **'اختيار جهة العمل'**
  String get authChooseOrganizationTitle;

  /// No description provided for @authChooseOrganizationBody.
  ///
  /// In ar, this message translates to:
  /// **'حسابك مرتبط بأكثر من جهة؛ اختر جهة العمل التي سيعمل عليها هذا الجهاز.'**
  String get authChooseOrganizationBody;

  /// No description provided for @authSessionMissing.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد جلسة نشطة؛ سُجِّلت الخروج.'**
  String get authSessionMissing;

  /// No description provided for @shellGraceActive.
  ///
  /// In ar, this message translates to:
  /// **'الأذونات المخزّنة على هذا الجهاز سارية؛ التعديل يعمل دون اتصال.'**
  String get shellGraceActive;

  /// No description provided for @shellGraceReadOnly.
  ///
  /// In ar, this message translates to:
  /// **'يمكن القراءة دون اتصال؛ التعديل يتوقف حتى اتصال جديد بالخادم.'**
  String get shellGraceReadOnly;

  /// No description provided for @shellGraceUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'لم تُقرأ حالة الجلسة المحلية بعد.'**
  String get shellGraceUnavailable;

  /// No description provided for @settingsTitle.
  ///
  /// In ar, this message translates to:
  /// **'الإعدادات'**
  String get settingsTitle;

  /// No description provided for @settingsHubSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'إعدادات جهة العمل، وسياسات التسعير والخصم لديها.'**
  String get settingsHubSubtitle;

  /// No description provided for @settingsEntryGeneral.
  ///
  /// In ar, this message translates to:
  /// **'الإعدادات العامة'**
  String get settingsEntryGeneral;

  /// No description provided for @settingsEntryGeneralDescription.
  ///
  /// In ar, this message translates to:
  /// **'هوية جهة العمل، العملة، الفواتير، والمبيعات.'**
  String get settingsEntryGeneralDescription;

  /// No description provided for @settingsEntryPricing.
  ///
  /// In ar, this message translates to:
  /// **'التسعير والخصومات'**
  String get settingsEntryPricing;

  /// No description provided for @settingsEntryPricingDescription.
  ///
  /// In ar, this message translates to:
  /// **'نمط التسعير وسقوف الخصم وبوابة الموافقات.'**
  String get settingsEntryPricingDescription;

  /// No description provided for @settingsSourceLive.
  ///
  /// In ar, this message translates to:
  /// **'بيانات مباشرة من الخادم.'**
  String get settingsSourceLive;

  /// No description provided for @settingsSourceCached.
  ///
  /// In ar, this message translates to:
  /// **'نسخة مخزّنة للقراءة فقط.'**
  String get settingsSourceCached;

  /// No description provided for @settingsVersionLive.
  ///
  /// In ar, this message translates to:
  /// **'إصدار الإعدادات: {version}'**
  String settingsVersionLive(int version);

  /// No description provided for @settingsCachedLine.
  ///
  /// In ar, this message translates to:
  /// **'إصدار مخزّن: {version} — آخر مزامنة: {time}'**
  String settingsCachedLine(int version, String time);

  /// No description provided for @settingsOfflineBanner.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد اتصال بالخادم؛ تُعرض إعدادات مخزّنة، والتعديل متوقف.'**
  String get settingsOfflineBanner;

  /// No description provided for @settingsOfflineNoCache.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد نسخة مخزّنة من الإعدادات؛ الاتصال مرة واحدة أولًا يحمّلها.'**
  String get settingsOfflineNoCache;

  /// No description provided for @settingsCacheCorrupted.
  ///
  /// In ar, this message translates to:
  /// **'النسخة المخزّنة تالفة ورُفضت؛ الاتصال بالخادم سيبدّلها.'**
  String get settingsCacheCorrupted;

  /// No description provided for @settingsLoadError.
  ///
  /// In ar, this message translates to:
  /// **'تعذر تحميل الإعدادات.'**
  String get settingsLoadError;

  /// No description provided for @settingsLoading.
  ///
  /// In ar, this message translates to:
  /// **'جارٍ تحميل الإعدادات…'**
  String get settingsLoading;

  /// No description provided for @settingsDeniedTitle.
  ///
  /// In ar, this message translates to:
  /// **'لا تملك صلاحية عرض الإعدادات'**
  String get settingsDeniedTitle;

  /// No description provided for @settingsDeniedBody.
  ///
  /// In ar, this message translates to:
  /// **'أجاب الخادم: صلاحية «settings.view» غير موجودة في صلاحياتك الفعلية هنا.'**
  String get settingsDeniedBody;

  /// No description provided for @settingsRetry.
  ///
  /// In ar, this message translates to:
  /// **'إعادة المحاولة'**
  String get settingsRetry;

  /// No description provided for @settingsSaved.
  ///
  /// In ar, this message translates to:
  /// **'حُفظت الإعدادات على الخادم.'**
  String get settingsSaved;

  /// No description provided for @settingsSaveWithheld.
  ///
  /// In ar, this message translates to:
  /// **'لم يصل جواب الخادم؛ لم تُحفظ التغييرات. التغييرات ما زالت في الحقول.'**
  String get settingsSaveWithheld;

  /// No description provided for @settingsSaveRefused.
  ///
  /// In ar, this message translates to:
  /// **'رفض الخادم التغييرات؛ راجع القيم وحاول ثانية.'**
  String get settingsSaveRefused;

  /// No description provided for @settingsSaveValidationError.
  ///
  /// In ar, this message translates to:
  /// **'أصلح الحقول المعلَّمة ثم احفظ.'**
  String get settingsSaveValidationError;

  /// No description provided for @settingsSavePermissionDenied.
  ///
  /// In ar, this message translates to:
  /// **'لا تملك صلاحية تعديل هذه الحقول.'**
  String get settingsSavePermissionDenied;

  /// No description provided for @settingsOwnerOnly.
  ///
  /// In ar, this message translates to:
  /// **'للمالك فقط'**
  String get settingsOwnerOnly;

  /// No description provided for @settingsOwnerOnlyCaption.
  ///
  /// In ar, this message translates to:
  /// **'يضبطها مالك الجهة فقط.'**
  String get settingsOwnerOnlyCaption;

  /// No description provided for @settingsUnsavedLine.
  ///
  /// In ar, this message translates to:
  /// **'تغييرات غير محفوظة: {count}'**
  String settingsUnsavedLine(int count);

  /// No description provided for @settingsSaveAction.
  ///
  /// In ar, this message translates to:
  /// **'حفظ'**
  String get settingsSaveAction;

  /// No description provided for @settingsCancelAction.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء'**
  String get settingsCancelAction;

  /// No description provided for @settingsReloadAction.
  ///
  /// In ar, this message translates to:
  /// **'إعادة تحميل القيم'**
  String get settingsReloadAction;

  /// No description provided for @settingsKeepDraftAction.
  ///
  /// In ar, this message translates to:
  /// **'أبقِ مسودتي'**
  String get settingsKeepDraftAction;

  /// No description provided for @settingsDiscardDraftAction.
  ///
  /// In ar, this message translates to:
  /// **'تجاهل مسودتي'**
  String get settingsDiscardDraftAction;

  /// No description provided for @settingsConfirmMaterialTitle.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد تغيير السياسة'**
  String get settingsConfirmMaterialTitle;

  /// No description provided for @settingsConfirmMaterialBody.
  ///
  /// In ar, this message translates to:
  /// **'هذا تغيير في سياسة التسعير أو الخصم؛ يأخذ مفعوله على قرارات الخادم القادمة. حفظ؟'**
  String get settingsConfirmMaterialBody;

  /// No description provided for @settingsConflictTitle.
  ///
  /// In ar, this message translates to:
  /// **'تغيّرت الإعدادات على الخادم'**
  String get settingsConflictTitle;

  /// No description provided for @settingsConflictBody.
  ///
  /// In ar, this message translates to:
  /// **'إصدار الإعدادات تغيّر أثناء تحريرك. أعد التحميل لعرض القيم الموثوقة؛ مسودتك لا تُفقد.'**
  String get settingsConflictBody;

  /// No description provided for @settingsSectionIdentity.
  ///
  /// In ar, this message translates to:
  /// **'هوية جهة العمل'**
  String get settingsSectionIdentity;

  /// No description provided for @settingsSectionMoney.
  ///
  /// In ar, this message translates to:
  /// **'العملة والعرض'**
  String get settingsSectionMoney;

  /// No description provided for @settingsSectionInvoice.
  ///
  /// In ar, this message translates to:
  /// **'الفواتير'**
  String get settingsSectionInvoice;

  /// No description provided for @settingsSectionSales.
  ///
  /// In ar, this message translates to:
  /// **'المبيعات'**
  String get settingsSectionSales;

  /// No description provided for @settingsSectionOffline.
  ///
  /// In ar, this message translates to:
  /// **'الإعدادات دون اتصال'**
  String get settingsSectionOffline;

  /// No description provided for @settingsFieldOrganizationName.
  ///
  /// In ar, this message translates to:
  /// **'اسم جهة العمل'**
  String get settingsFieldOrganizationName;

  /// No description provided for @settingsFieldCurrency.
  ///
  /// In ar, this message translates to:
  /// **'العملة'**
  String get settingsFieldCurrency;

  /// No description provided for @settingsCurrencyEgp.
  ///
  /// In ar, this message translates to:
  /// **'جنيه مصري (EGP)'**
  String get settingsCurrencyEgp;

  /// No description provided for @settingsFieldDisplayNumerals.
  ///
  /// In ar, this message translates to:
  /// **'عرض الأرقام'**
  String get settingsFieldDisplayNumerals;

  /// No description provided for @settingsNumeralsWestern.
  ///
  /// In ar, this message translates to:
  /// **'أرقام غربية'**
  String get settingsNumeralsWestern;

  /// No description provided for @settingsNumeralsEastern.
  ///
  /// In ar, this message translates to:
  /// **'أرقام شرق عربية'**
  String get settingsNumeralsEastern;

  /// No description provided for @settingsFieldInvoiceOutput.
  ///
  /// In ar, this message translates to:
  /// **'إخراج الفاتورة الافتراضي'**
  String get settingsFieldInvoiceOutput;

  /// No description provided for @settingsInvoiceAlwaysAsk.
  ///
  /// In ar, this message translates to:
  /// **'اسأل دائمًا'**
  String get settingsInvoiceAlwaysAsk;

  /// No description provided for @settingsInvoicePrintAutomatically.
  ///
  /// In ar, this message translates to:
  /// **'طباعة تلقائية'**
  String get settingsInvoicePrintAutomatically;

  /// No description provided for @settingsInvoiceNoAutomaticOutput.
  ///
  /// In ar, this message translates to:
  /// **'بلا إخراج تلقائي'**
  String get settingsInvoiceNoAutomaticOutput;

  /// No description provided for @settingsFieldInvoiceFooter.
  ///
  /// In ar, this message translates to:
  /// **'تذييل الفاتورة'**
  String get settingsFieldInvoiceFooter;

  /// No description provided for @settingsFieldInvoiceShowLogo.
  ///
  /// In ar, this message translates to:
  /// **'إظهار شعار جهة العمل'**
  String get settingsFieldInvoiceShowLogo;

  /// No description provided for @settingsFieldCustomerRequiredOnCredit.
  ///
  /// In ar, this message translates to:
  /// **'إلزام العميل في البيع الآجل'**
  String get settingsFieldCustomerRequiredOnCredit;

  /// No description provided for @settingsFieldReceivablesAging.
  ///
  /// In ar, this message translates to:
  /// **'تقارير عمر الذمم'**
  String get settingsFieldReceivablesAging;

  /// No description provided for @settingsFieldOfflineGrace.
  ///
  /// In ar, this message translates to:
  /// **'مدة نافذة العمل دون اتصال (ثانية)'**
  String get settingsFieldOfflineGrace;

  /// No description provided for @settingsFieldReceiptFormat.
  ///
  /// In ar, this message translates to:
  /// **'شكل رقم إيصال الجهاز'**
  String get settingsFieldReceiptFormat;

  /// No description provided for @settingsReceiptFormatOrgDevSeq.
  ///
  /// In ar, this message translates to:
  /// **'جهة-جهاز-تسلسل'**
  String get settingsReceiptFormatOrgDevSeq;

  /// No description provided for @settingsFieldOfflineReservedBlocks.
  ///
  /// In ar, this message translates to:
  /// **'كتل أرقام محجوزة دون اتصال'**
  String get settingsFieldOfflineReservedBlocks;

  /// No description provided for @settingsFieldReservedBlockSize.
  ///
  /// In ar, this message translates to:
  /// **'حجم الكتلة المحجوزة'**
  String get settingsFieldReservedBlockSize;

  /// No description provided for @settingsFieldMinorUnitExponent.
  ///
  /// In ar, this message translates to:
  /// **'منازل العملة الصغرى'**
  String get settingsFieldMinorUnitExponent;

  /// No description provided for @settingsFieldRoundingMode.
  ///
  /// In ar, this message translates to:
  /// **'قاعدة التقريب'**
  String get settingsFieldRoundingMode;

  /// No description provided for @settingsRoundingHalfUp.
  ///
  /// In ar, this message translates to:
  /// **'النصف لأعلى (HALF_UP)'**
  String get settingsRoundingHalfUp;

  /// No description provided for @settingsRoundingHalfEven.
  ///
  /// In ar, this message translates to:
  /// **'النصف إلى الزوجي (HALF_EVEN)'**
  String get settingsRoundingHalfEven;

  /// No description provided for @settingsFeatureFlagsHeading.
  ///
  /// In ar, this message translates to:
  /// **'أعلام الميزات'**
  String get settingsFeatureFlagsHeading;

  /// No description provided for @settingsFeatureFlagsEmpty.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد أعلام معرّفة في هذه النسخة.'**
  String get settingsFeatureFlagsEmpty;

  /// No description provided for @settingsFeatureFlagRow.
  ///
  /// In ar, this message translates to:
  /// **'{key} — {state}'**
  String settingsFeatureFlagRow(Object key, Object state);

  /// No description provided for @settingsFeatureFlagOn.
  ///
  /// In ar, this message translates to:
  /// **'مُفعّل'**
  String get settingsFeatureFlagOn;

  /// No description provided for @settingsFeatureFlagOff.
  ///
  /// In ar, this message translates to:
  /// **'معطّل'**
  String get settingsFeatureFlagOff;

  /// No description provided for @settingsFieldNameError.
  ///
  /// In ar, this message translates to:
  /// **'الاسم مطلوب ولا يكون فراغًا.'**
  String get settingsFieldNameError;

  /// No description provided for @settingsFieldFooterError.
  ///
  /// In ar, this message translates to:
  /// **'التذييل أطول من الحد المسموح (2000 حرف).'**
  String get settingsFieldFooterError;

  /// No description provided for @settingsFieldPricingMode.
  ///
  /// In ar, this message translates to:
  /// **'نمط التسعير'**
  String get settingsFieldPricingMode;

  /// No description provided for @settingsModeFixedName.
  ///
  /// In ar, this message translates to:
  /// **'سعر ثابت (FIXED)'**
  String get settingsModeFixedName;

  /// No description provided for @settingsModeFixedDescription.
  ///
  /// In ar, this message translates to:
  /// **'سعر البيع المعلن حاكم؛ لا تنخفض الأسعار إلا بصلاحية تجاوز خاضعة للخادم.'**
  String get settingsModeFixedDescription;

  /// No description provided for @settingsModeVariableName.
  ///
  /// In ar, this message translates to:
  /// **'سعر حر (VARIABLE)'**
  String get settingsModeVariableName;

  /// No description provided for @settingsModeVariableDescription.
  ///
  /// In ar, this message translates to:
  /// **'يُدخل السعر يدويًا؛ البيع تحت التكلفة مسموح ومشار إليه في التقارير.'**
  String get settingsModeVariableDescription;

  /// No description provided for @settingsModeFixedWithDiscountName.
  ///
  /// In ar, this message translates to:
  /// **'سعر ثابت مع خصم (FIXED_WITH_DISCOUNT)'**
  String get settingsModeFixedWithDiscountName;

  /// No description provided for @settingsModeFixedWithDiscountDescription.
  ///
  /// In ar, this message translates to:
  /// **'السعر الأساسي ثابت؛ يُشتق السعر النهائي من الخصم ضمن سقوف السياسة وبوابة الموافقات.'**
  String get settingsModeFixedWithDiscountDescription;

  /// No description provided for @settingsSectionDiscountPolicy.
  ///
  /// In ar, this message translates to:
  /// **'سياسة الخصم'**
  String get settingsSectionDiscountPolicy;

  /// No description provided for @settingsDiscountModeCaption.
  ///
  /// In ar, this message translates to:
  /// **'تُطبَّق هذه السياسة في نمط «سعر ثابت مع خصم»، ويتحقق منها الخادم في كل قرار.'**
  String get settingsDiscountModeCaption;

  /// No description provided for @settingsFieldMaxDiscountPercentage.
  ///
  /// In ar, this message translates to:
  /// **'أقصى نسبة خصم (%)'**
  String get settingsFieldMaxDiscountPercentage;

  /// No description provided for @settingsFieldMaxDiscountAmount.
  ///
  /// In ar, this message translates to:
  /// **'أقصى مقدار خصم (أصغر وحدة)'**
  String get settingsFieldMaxDiscountAmount;

  /// No description provided for @settingsFieldApprovalThreshold.
  ///
  /// In ar, this message translates to:
  /// **'حد الموافقة على الخصم (أصغر وحدة)'**
  String get settingsFieldApprovalThreshold;

  /// No description provided for @settingsApprovalThresholdClearCaption.
  ///
  /// In ar, this message translates to:
  /// **'امسح الحد (لا موافقات مطلوبة)'**
  String get settingsApprovalThresholdClearCaption;

  /// No description provided for @settingsApprovalThresholdEmptyCaption.
  ///
  /// In ar, this message translates to:
  /// **'بلا حد؛ لا تُطلب موافقات.'**
  String get settingsApprovalThresholdEmptyCaption;

  /// No description provided for @settingsFieldSalespersonAllowed.
  ///
  /// In ar, this message translates to:
  /// **'يحق للبائع تطبيق الخصومات'**
  String get settingsFieldSalespersonAllowed;

  /// No description provided for @settingsFieldBlockBelowCost.
  ///
  /// In ar, this message translates to:
  /// **'منع الخصم تحت سعر التكلفة'**
  String get settingsFieldBlockBelowCost;

  /// No description provided for @settingsPercentageError.
  ///
  /// In ar, this message translates to:
  /// **'قيمة نسبة غير صالحة (0—100 بفاصلتين أقصى).'**
  String get settingsPercentageError;

  /// No description provided for @settingsAmountError.
  ///
  /// In ar, this message translates to:
  /// **'قيمة مقدار غير صالحة (عدد صحيح موجب).'**
  String get settingsAmountError;

  /// No description provided for @settingsAmountRangeError.
  ///
  /// In ar, this message translates to:
  /// **'المقدار خارج الحدود المسموحة.'**
  String get settingsAmountRangeError;

  /// No description provided for @settingsReadonlyOfflineCaption.
  ///
  /// In ar, this message translates to:
  /// **'غير متاح للتعديل دون اتصال؛ الخادم هو صاحب القرار.'**
  String get settingsReadonlyOfflineCaption;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['ar', 'en'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ar':
      return AppLocalizationsAr();
    case 'en':
      return AppLocalizationsEn();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
