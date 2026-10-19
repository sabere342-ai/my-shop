import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_shop_desktop/core/api/api_failure.dart';
import 'package:my_shop_desktop/core/auth/app_session_notifier.dart';
import 'package:my_shop_desktop/core/auth/auth_session.dart';
import 'package:my_shop_desktop/core/ui/components/app_button.dart';
import 'package:my_shop_desktop/core/ui/components/app_text_field.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';
import 'package:my_shop_desktop/core/ui/theme/app_typography.dart';
import 'package:my_shop_desktop/l10n/app_localizations.dart';

/// The sign-in screen (Master Plan section 6.6, section 10, section 6.8).
///
/// It collects credentials and hands them to the session controller; nothing
/// here classifies the server's answer alone — every refusal and every
/// withheld attempt arrives through [SignInResult] and is surfaced from the
/// client's own closed messages (section 34.3, no swallowed verdict, no
/// invented verdict). Success rendering happens on redirection: the guard
/// sends a session with exactly one verified membership to the shell and one
/// with several to organization setup (section 6.6).
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();

  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit(AppLocalizations l10n) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final SignInResult result = await ref
        .read(appSessionProvider.notifier)
        .signIn(email: _emailController.text.trim(), password: _passwordController.text);
    if (!mounted) {
      return;
    }
    setState(() {
      _busy = false;
      _error = _messageFor(result, l10n);
    });
  }

  /// Maps one [SignInResult] into at most one catalogued message (§34.3).
  String? _messageFor(SignInResult result, AppLocalizations l10n) {
    switch (result.kind) {
      case SignInResultKind.success:
        return null;
      case SignInResultKind.withheld:
        return l10n.authWithheld;
      case SignInResultKind.refused:
        final Object? failure = result.failure;
        if (failure is ApiFailure) {
          return switch (failure.code) {
            ApiErrorCode.unauthenticated ||
            ApiErrorCode.tokenExpired ||
            ApiErrorCode.tokenStale ||
            ApiErrorCode.validationFailed => l10n.authInvalidCredentials,
            ApiErrorCode.rateLimited => l10n.authRateLimited,
            _ => l10n.authRefused,
          };
        }
        return l10n.authRefused;
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    ref.watch(appSessionProvider);

    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.three),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 360),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text(l10n.appTitle, style: AppTypography.title),
                const SizedBox(height: AppSpacing.one),
                Text(l10n.authSignInTitle, style: AppTypography.caption),
                const SizedBox(height: AppSpacing.three),
                AppTextField(
                  label: l10n.authEmailLabel,
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  enabled: !_busy,
                ),
                const SizedBox(height: AppSpacing.two),
                AppTextField(
                  label: l10n.authPasswordLabel,
                  controller: _passwordController,
                  obscureText: true,
                  enabled: !_busy,
                ),
                const SizedBox(height: AppSpacing.one),
                if (_error != null)
                  Text(
                    _error!,
                    style: AppTypography.body.copyWith(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                const SizedBox(height: AppSpacing.two),
                AppButton(
                  label: l10n.authSignInAction,
                  busy: _busy,
                  onPressed: _busy ? null : () => _submit(l10n),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
