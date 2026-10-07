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
}
