// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'My Shop';

  @override
  String get shellTitle => 'Foundation ready';

  @override
  String get shellBody => 'No business screens in this build.';

  @override
  String get notFoundTitle => 'Page not found';

  @override
  String get notFoundBody => 'The link may have been removed or changed.';

  @override
  String get backToHome => 'Back to start';
}
