import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/ui/components/app_button.dart';
import 'package:my_shop_desktop/core/ui/components/app_confirm_dialog.dart';
import 'package:my_shop_desktop/core/ui/components/app_data_table.dart';
import 'package:my_shop_desktop/core/ui/components/app_dialog.dart';
import 'package:my_shop_desktop/core/ui/components/app_empty_state.dart';
import 'package:my_shop_desktop/core/ui/components/app_error_state.dart';
import 'package:my_shop_desktop/core/ui/components/app_money_field.dart';
import 'package:my_shop_desktop/core/ui/components/app_permission_gate.dart';
import 'package:my_shop_desktop/core/ui/components/app_section_header.dart';
import 'package:my_shop_desktop/core/ui/components/app_sheet.dart';
import 'package:my_shop_desktop/core/ui/components/app_snackbar.dart';
import 'package:my_shop_desktop/core/ui/components/app_text_field.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';
import 'package:my_shop_desktop/core/ui/theme/app_theme.dart';
import 'package:my_shop_desktop/l10n/app_localizations.dart';

/// Arabic RTL golden coverage for every section 6.9 component (slice S-7).
///
/// Each component is rendered through the real [AppTheme] and the committed
/// `ar` catalog so the golden records the design decision the plan fixes —
/// colour roles, the type scale and right-to-left layout — rather than a
/// default Material look. The committed Noto Sans Arabic fixture is registered
/// under [AppTypography.fontFamily]'s name, because `flutter test` loads no
/// fonts of its own.
///
/// Regenerate with `flutter test --update-goldens`.
const String _save = 'حفظ';
const String _retry = 'إعادة المحاولة';
const String _cancel = 'إلغاء';
const String _confirm = 'تأكيد';
const String _sectionTitle = 'قسم المبيعات';
const String _dialogBody = 'سيتم ترحيل هذه الحركة إلى المخزون.';
const String _emptyTitle = 'لا توجد أصناف';
const String _emptyBody = 'أضف أول صنف لتظهر القائمة هنا.';
const String _errorTitle = 'تعذّر التحميل';
const String _errorBody = 'حدث خطأ أثناء جلب البيانات.';
const String _fieldLabel = 'اسم الصنف';
const String _fieldHint = 'اكتب الاسم هنا';
const String _moneySuffix = 'ج.م';
const String _savedMessage = 'تم حفظ التغييرات';
const String _cellOne = 'أرز';
const String _cellTwo = '١٢';

void _noop() {}

Future<void> _loadFixtureFont() async {
  final Uint8List bytes = await File('test/fonts/NotoSansArabic.ttf')
      .readAsBytes();
  final FontLoader loader = FontLoader('Roboto')
    ..addFont(Future<ByteData>.value(ByteData.sublistView(bytes)));
  await loader.load();
}

Widget _frame(Widget child) {
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: AppTheme.light(),
    locale: const Locale('ar'),
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    home: Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.three),
          child: child,
        ),
      ),
    ),
  );
}

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(800, 600),
}) async {
  tester.view.devicePixelRatio = 1.0;
  tester.view.physicalSize = size;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(_frame(child));
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    await _loadFixtureFont();
  });

  testWidgets('AppButton', (WidgetTester tester) async {
    await _pump(tester, const AppButton(label: _save, onPressed: _noop));
    await expectLater(
      find.byType(AppButton),
      matchesGoldenFile('goldens/app_button.png'),
    );
  });

  testWidgets('AppTextField', (WidgetTester tester) async {
    await _pump(
      tester,
      const SizedBox(
        width: 320,
        child: AppTextField(label: _fieldLabel, hint: _fieldHint),
      ),
    );
    await expectLater(
      find.byType(AppTextField),
      matchesGoldenFile('goldens/app_text_field.png'),
    );
  });

  testWidgets('AppMoneyField', (WidgetTester tester) async {
    await _pump(
      tester,
      const SizedBox(
        width: 320,
        child: AppMoneyField(label: _fieldLabel, suffix: _moneySuffix),
      ),
    );
    await expectLater(
      find.byType(AppMoneyField),
      matchesGoldenFile('goldens/app_money_field.png'),
    );
  });

  testWidgets('AppDialog', (WidgetTester tester) async {
    await _pump(
      tester,
      const AppDialog(
        title: _sectionTitle,
        content: Text(_dialogBody),
        actions: <Widget>[AppButton(label: _save, onPressed: _noop)],
      ),
    );
    await expectLater(
      find.byType(AppDialog),
      matchesGoldenFile('goldens/app_dialog.png'),
    );
  });

  testWidgets('AppConfirmDialog', (WidgetTester tester) async {
    await _pump(
      tester,
      const AppConfirmDialog(
        title: _sectionTitle,
        message: _dialogBody,
        confirmLabel: _confirm,
        cancelLabel: _cancel,
        destructive: true,
      ),
    );
    await expectLater(
      find.byType(AppConfirmDialog),
      matchesGoldenFile('goldens/app_confirm_dialog.png'),
    );
  });

  testWidgets('AppSheet', (WidgetTester tester) async {
    await _pump(
      tester,
      const AppSheet(title: _sectionTitle, content: Text(_dialogBody)),
    );
    await expectLater(
      find.byType(AppSheet),
      matchesGoldenFile('goldens/app_sheet.png'),
    );
  });

  testWidgets('AppDataTable', (WidgetTester tester) async {
    await _pump(
      tester,
      const AppDataTable(
        columns: <String>['الصنف', 'الكمية'],
        rows: <List<String>>[
          <String>[_cellOne, _cellTwo],
          <String>['سكر', '٤'],
        ],
      ),
    );
    await expectLater(
      find.byType(AppDataTable),
      matchesGoldenFile('goldens/app_data_table.png'),
    );
  });

  testWidgets('AppEmptyState', (WidgetTester tester) async {
    await _pump(
      tester,
      const AppEmptyState(title: _emptyTitle, description: _emptyBody),
    );
    await expectLater(
      find.byType(AppEmptyState),
      matchesGoldenFile('goldens/app_empty_state.png'),
    );
  });

  testWidgets('AppErrorState', (WidgetTester tester) async {
    await _pump(
      tester,
      const AppErrorState(
        title: _errorTitle,
        description: _errorBody,
        actionLabel: _retry,
        onAction: _noop,
      ),
    );
    await expectLater(
      find.byType(AppErrorState),
      matchesGoldenFile('goldens/app_error_state.png'),
    );
  });

  testWidgets('AppSnackbar', (WidgetTester tester) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(800, 600);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_frame(const SizedBox(height: AppSpacing.six)));
    final BuildContext context = tester.element(find.byType(Scaffold));
    AppSnackbar.show(
      context,
      message: _savedMessage,
      tone: AppSnackbarTone.success,
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    await expectLater(
      find.byType(SnackBar),
      matchesGoldenFile('goldens/app_snackbar.png'),
    );
  });

  testWidgets('AppSectionHeader', (WidgetTester tester) async {
    await _pump(
      tester,
      const AppSectionHeader(
        title: _sectionTitle,
        trailing: AppButton(
          label: _save,
          onPressed: _noop,
          variant: AppButtonVariant.secondary,
        ),
      ),
    );
    await expectLater(
      find.byType(AppSectionHeader),
      matchesGoldenFile('goldens/app_section_header.png'),
    );
  });

  testWidgets('AppPermissionGate', (WidgetTester tester) async {
    await _pump(
      tester,
      const AppPermissionGate(
        hasPermission: true,
        child: AppButton(label: _save, onPressed: _noop),
      ),
    );
    await expectLater(
      find.byType(AppPermissionGate),
      matchesGoldenFile('goldens/app_permission_gate.png'),
    );
  });
}
