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
  String get shellTitle => 'الأساس الجاهز';

  @override
  String get shellBody => 'لا توجد شاشات عمل في هذه النسخة.';

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
}
