import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_shop_desktop/core/auth/app_session_notifier.dart';
import 'package:my_shop_desktop/core/auth/auth_session.dart';
import 'package:my_shop_desktop/core/ui/components/app_empty_state.dart';
import 'package:my_shop_desktop/core/ui/theme/app_spacing.dart';
import 'package:my_shop_desktop/l10n/app_localizations.dart';

/// The organization-setup screen (Master Plan section 6.6, section 9.3).
///
/// It is where the router sends a signed-in session whose verified membership
/// list carries more than one organization. The choices rendered here come
/// **from the session, which filled them from `GET /auth/me`** (section 9.3:
/// server-derived ids, never a client-typed id), and choosing one hands the
/// id back to the controller, which re-checks it against the memberships
/// before it binds. The id itself is the only server-supplied label at this
/// stage; a human-readable name lives on a later business surface, not here.
class OrganizationSetupScreen extends ConsumerStatefulWidget {
  const OrganizationSetupScreen({super.key});

  @override
  ConsumerState<OrganizationSetupScreen> createState() =>
      _OrganizationSetupScreenState();
}

class _OrganizationSetupScreenState
    extends ConsumerState<OrganizationSetupScreen> {
  String? _choosing;

  Future<void> _choose(String organizationId) async {
    final AuthSession? session = ref.read(appSessionProvider).session;
    if (session == null || _choosing != null) {
      return;
    }
    setState(() {
      _choosing = organizationId;
    });
    await ref
        .read(appSessionProvider.notifier)
        .chooseOrganization(session: session, organizationId: organizationId);
    if (!mounted) {
      return;
    }
    // A success is rendered by the guard's redirect (section 6.6). A refusal
    // that *ended* the session also renders itself — at sign-in. Only a
    // refusal that leaves the session standing needs its row un-busied.
    if (ref.read(appSessionProvider).phase == SessionPhase.signedIn) {
      setState(() {
        _choosing = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context)!;
    final AuthSession? session = ref.watch(appSessionProvider).session;
    final List<String> organizations = session?.organizations ?? const <String>[];

    return Scaffold(
      appBar: AppBar(title: Text(l10n.authChooseOrganizationTitle)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.three),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: organizations.isEmpty
                ? AppEmptyState(
                    title: l10n.authChooseOrganizationTitle,
                    description: l10n.authSessionMissing,
                  )
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      Text(l10n.authChooseOrganizationBody),
                      const SizedBox(height: AppSpacing.two),
                      for (final String organizationId in organizations)
                        ListTile(
                          key: ValueKey<String>(organizationId),
                          title: Text(organizationId),
                          enabled: _choosing == null,
                          onTap: () => _choose(organizationId),
                        ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}
