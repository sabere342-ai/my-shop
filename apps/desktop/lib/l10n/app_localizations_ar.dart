// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class AppLocalizationsAr extends AppLocalizations {
  AppLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get appTitle => 'My Shop';

  @override
  String get shellTitle => 'مساحة العمل';

  @override
  String get shellBody => 'اختر مكان العمل من القائمة.';

  @override
  String get shellOpenSettings => 'الإعدادات';

  @override
  String get notFoundTitle => 'الصفحة غير موجودة';

  @override
  String get notFoundBody => 'ربما حُذف الرابط أو تغيّر.';

  @override
  String get backToHome => 'العودة إلى البداية';

  @override
  String get authSignInTitle => 'تسجيل الدخول';

  @override
  String get authEmailLabel => 'البريد الإلكتروني';

  @override
  String get authPasswordLabel => 'كلمة السر';

  @override
  String get authSignInAction => 'تسجيل الدخول';

  @override
  String get authInvalidCredentials =>
      'البريد الإلكتروني أو كلمة السر غير صحيحة.';

  @override
  String get authRateLimited =>
      'ثمة محاولات كثيرة؛ انتظر قليلًا ثم أعد المحاولة.';

  @override
  String get authRefused => 'رفض الخادم الطلب؛ راجع البيانات وأعد المحاولة.';

  @override
  String get authWithheld =>
      'لم يصل رد من الخادم؛ تحقق من الاتصال وأعد المحاولة.';

  @override
  String get authChooseOrganizationTitle => 'اختيار جهة العمل';

  @override
  String get authChooseOrganizationBody =>
      'حسابك مرتبط بأكثر من جهة؛ اختر جهة العمل التي سيعمل عليها هذا الجهاز.';

  @override
  String get authSessionMissing => 'لا توجد جلسة نشطة؛ سُجِّلت الخروج.';

  @override
  String get shellGraceActive =>
      'الأذونات المخزّنة على هذا الجهاز سارية؛ التعديل يعمل دون اتصال.';

  @override
  String get shellGraceReadOnly =>
      'يمكن القراءة دون اتصال؛ التعديل يتوقف حتى اتصال جديد بالخادم.';

  @override
  String get shellGraceUnavailable => 'لم تُقرأ حالة الجلسة المحلية بعد.';

  @override
  String get settingsTitle => 'الإعدادات';

  @override
  String get settingsHubSubtitle =>
      'إعدادات جهة العمل، وسياسات التسعير والخصم لديها.';

  @override
  String get settingsEntryGeneral => 'الإعدادات العامة';

  @override
  String get settingsEntryGeneralDescription =>
      'هوية جهة العمل، العملة، الفواتير، والمبيعات.';

  @override
  String get settingsEntryPricing => 'التسعير والخصومات';

  @override
  String get settingsEntryPricingDescription =>
      'نمط التسعير وسقوف الخصم وبوابة الموافقات.';

  @override
  String get settingsSourceLive => 'بيانات مباشرة من الخادم.';

  @override
  String get settingsSourceCached => 'نسخة مخزّنة للقراءة فقط.';

  @override
  String settingsVersionLive(int version) {
    return 'إصدار الإعدادات: $version';
  }

  @override
  String settingsCachedLine(int version, String time) {
    return 'إصدار مخزّن: $version — آخر مزامنة: $time';
  }

  @override
  String get settingsOfflineBanner =>
      'لا يوجد اتصال بالخادم؛ تُعرض إعدادات مخزّنة، والتعديل متوقف.';

  @override
  String get settingsOfflineNoCache =>
      'لا توجد نسخة مخزّنة من الإعدادات؛ الاتصال مرة واحدة أولًا يحمّلها.';

  @override
  String get settingsCacheCorrupted =>
      'النسخة المخزّنة تالفة ورُفضت؛ الاتصال بالخادم سيبدّلها.';

  @override
  String get settingsLoadError => 'تعذر تحميل الإعدادات.';

  @override
  String get settingsLoading => 'جارٍ تحميل الإعدادات…';

  @override
  String get settingsDeniedTitle => 'لا تملك صلاحية عرض الإعدادات';

  @override
  String get settingsDeniedBody =>
      'أجاب الخادم: صلاحية «settings.view» غير موجودة في صلاحياتك الفعلية هنا.';

  @override
  String get settingsRetry => 'إعادة المحاولة';

  @override
  String get settingsSaved => 'حُفظت الإعدادات على الخادم.';

  @override
  String get settingsSaveWithheld =>
      'لم يصل جواب الخادم؛ لم تُحفظ التغييرات. التغييرات ما زالت في الحقول.';

  @override
  String get settingsSaveRefused =>
      'رفض الخادم التغييرات؛ راجع القيم وحاول ثانية.';

  @override
  String get settingsSaveValidationError => 'أصلح الحقول المعلَّمة ثم احفظ.';

  @override
  String get settingsSavePermissionDenied => 'لا تملك صلاحية تعديل هذه الحقول.';

  @override
  String get settingsOwnerOnly => 'للمالك فقط';

  @override
  String get settingsOwnerOnlyCaption => 'يضبطها مالك الجهة فقط.';

  @override
  String settingsUnsavedLine(int count) {
    return 'تغييرات غير محفوظة: $count';
  }

  @override
  String get settingsSaveAction => 'حفظ';

  @override
  String get settingsCancelAction => 'إلغاء';

  @override
  String get settingsReloadAction => 'إعادة تحميل القيم';

  @override
  String get settingsKeepDraftAction => 'أبقِ مسودتي';

  @override
  String get settingsDiscardDraftAction => 'تجاهل مسودتي';

  @override
  String get settingsConfirmMaterialTitle => 'تأكيد تغيير السياسة';

  @override
  String get settingsConfirmMaterialBody =>
      'هذا تغيير في سياسة التسعير أو الخصم؛ يأخذ مفعوله على قرارات الخادم القادمة. حفظ؟';

  @override
  String get settingsConflictTitle => 'تغيّرت الإعدادات على الخادم';

  @override
  String get settingsConflictBody =>
      'إصدار الإعدادات تغيّر أثناء تحريرك. أعد التحميل لعرض القيم الموثوقة؛ مسودتك لا تُفقد.';

  @override
  String get settingsSectionIdentity => 'هوية جهة العمل';

  @override
  String get settingsSectionMoney => 'العملة والعرض';

  @override
  String get settingsSectionInvoice => 'الفواتير';

  @override
  String get settingsSectionSales => 'المبيعات';

  @override
  String get settingsSectionOffline => 'الإعدادات دون اتصال';

  @override
  String get settingsFieldOrganizationName => 'اسم جهة العمل';

  @override
  String get settingsFieldCurrency => 'العملة';

  @override
  String get settingsCurrencyEgp => 'جنيه مصري (EGP)';

  @override
  String get settingsFieldDisplayNumerals => 'عرض الأرقام';

  @override
  String get settingsNumeralsWestern => 'أرقام غربية';

  @override
  String get settingsNumeralsEastern => 'أرقام شرق عربية';

  @override
  String get settingsFieldInvoiceOutput => 'إخراج الفاتورة الافتراضي';

  @override
  String get settingsInvoiceAlwaysAsk => 'اسأل دائمًا';

  @override
  String get settingsInvoicePrintAutomatically => 'طباعة تلقائية';

  @override
  String get settingsInvoiceNoAutomaticOutput => 'بلا إخراج تلقائي';

  @override
  String get settingsFieldInvoiceFooter => 'تذييل الفاتورة';

  @override
  String get settingsFieldInvoiceShowLogo => 'إظهار شعار جهة العمل';

  @override
  String get settingsFieldCustomerRequiredOnCredit =>
      'إلزام العميل في البيع الآجل';

  @override
  String get settingsFieldReceivablesAging => 'تقارير عمر الذمم';

  @override
  String get settingsFieldOfflineGrace => 'مدة نافذة العمل دون اتصال (ثانية)';

  @override
  String get settingsFieldReceiptFormat => 'شكل رقم إيصال الجهاز';

  @override
  String get settingsReceiptFormatOrgDevSeq => 'جهة-جهاز-تسلسل';

  @override
  String get settingsFieldOfflineReservedBlocks => 'كتل أرقام محجوزة دون اتصال';

  @override
  String get settingsFieldReservedBlockSize => 'حجم الكتلة المحجوزة';

  @override
  String get settingsFieldMinorUnitExponent => 'منازل العملة الصغرى';

  @override
  String get settingsFieldRoundingMode => 'قاعدة التقريب';

  @override
  String get settingsRoundingHalfUp => 'النصف لأعلى (HALF_UP)';

  @override
  String get settingsRoundingHalfEven => 'النصف إلى الزوجي (HALF_EVEN)';

  @override
  String get settingsFeatureFlagsHeading => 'أعلام الميزات';

  @override
  String get settingsFeatureFlagsEmpty => 'لا توجد أعلام معرّفة في هذه النسخة.';

  @override
  String settingsFeatureFlagRow(Object key, Object state) {
    return '$key — $state';
  }

  @override
  String get settingsFeatureFlagOn => 'مُفعّل';

  @override
  String get settingsFeatureFlagOff => 'معطّل';

  @override
  String get settingsFieldNameError => 'الاسم مطلوب ولا يكون فراغًا.';

  @override
  String get settingsFieldFooterError =>
      'التذييل أطول من الحد المسموح (2000 حرف).';

  @override
  String get settingsFieldPricingMode => 'نمط التسعير';

  @override
  String get settingsModeFixedName => 'سعر ثابت (FIXED)';

  @override
  String get settingsModeFixedDescription =>
      'سعر البيع المعلن حاكم؛ لا تنخفض الأسعار إلا بصلاحية تجاوز خاضعة للخادم.';

  @override
  String get settingsModeVariableName => 'سعر حر (VARIABLE)';

  @override
  String get settingsModeVariableDescription =>
      'يُدخل السعر يدويًا؛ البيع تحت التكلفة مسموح ومشار إليه في التقارير.';

  @override
  String get settingsModeFixedWithDiscountName =>
      'سعر ثابت مع خصم (FIXED_WITH_DISCOUNT)';

  @override
  String get settingsModeFixedWithDiscountDescription =>
      'السعر الأساسي ثابت؛ يُشتق السعر النهائي من الخصم ضمن سقوف السياسة وبوابة الموافقات.';

  @override
  String get settingsSectionDiscountPolicy => 'سياسة الخصم';

  @override
  String get settingsDiscountModeCaption =>
      'تُطبَّق هذه السياسة في نمط «سعر ثابت مع خصم»، ويتحقق منها الخادم في كل قرار.';

  @override
  String get settingsFieldMaxDiscountPercentage => 'أقصى نسبة خصم (%)';

  @override
  String get settingsFieldMaxDiscountAmount => 'أقصى مقدار خصم (أصغر وحدة)';

  @override
  String get settingsFieldApprovalThreshold =>
      'حد الموافقة على الخصم (أصغر وحدة)';

  @override
  String get settingsApprovalThresholdClearCaption =>
      'امسح الحد (لا موافقات مطلوبة)';

  @override
  String get settingsApprovalThresholdEmptyCaption =>
      'بلا حد؛ لا تُطلب موافقات.';

  @override
  String get settingsFieldSalespersonAllowed => 'يحق للبائع تطبيق الخصومات';

  @override
  String get settingsFieldBlockBelowCost => 'منع الخصم تحت سعر التكلفة';

  @override
  String get settingsPercentageError =>
      'قيمة نسبة غير صالحة (0—100 بفاصلتين أقصى).';

  @override
  String get settingsAmountError => 'قيمة مقدار غير صالحة (عدد صحيح موجب).';

  @override
  String get settingsAmountRangeError => 'المقدار خارج الحدود المسموحة.';

  @override
  String get settingsReadonlyOfflineCaption =>
      'غير متاح للتعديل دون اتصال؛ الخادم هو صاحب القرار.';
}
