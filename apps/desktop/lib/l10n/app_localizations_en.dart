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

  @override
  String get authSignInTitle => 'Sign in';

  @override
  String get authEmailLabel => 'Email';

  @override
  String get authPasswordLabel => 'Password';

  @override
  String get authSignInAction => 'Sign in';

  @override
  String get authInvalidCredentials => 'The email or password is not correct.';

  @override
  String get authRateLimited =>
      'Too many attempts; wait a little and try again.';

  @override
  String get authRefused =>
      'The server refused the request; review the details and try again.';

  @override
  String get authWithheld =>
      'No answer came from the server; check the connection and try again.';

  @override
  String get authChooseOrganizationTitle => 'Choose your workspace';

  @override
  String get authChooseOrganizationBody =>
      'Your account belongs to more than one organization; choose the one this device works in.';

  @override
  String get authSessionMissing => 'There is no active session; sign in again.';

  @override
  String get shellGraceActive =>
      'The permissions cached on this device are valid; editing works offline.';

  @override
  String get shellGraceReadOnly =>
      'Reading works offline; editing pauses until a new connection.';

  @override
  String get shellGraceUnavailable =>
      'The local session status has not been read yet.';
}
