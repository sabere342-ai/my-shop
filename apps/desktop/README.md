# My Shop — Flutter client.

Arabic-first point-of-sale and back-office application for Windows and Android.

This directory is `apps/desktop/` in the monorepo locked in by Master Plan §6.2.
The name is historical: one Flutter codebase targets **both** Windows and Android,
so the directory name does not describe the platform.

## Status

M1-S1 — monorepo skeleton. The project builds, analyses, and tests empty.
`lib/main.dart` is an intentional placeholder: routing (`go_router`, §6.6), state
(Riverpod, §6.4), the design system (`core/ui`, §6.9), and Arabic localization
(§6.8) arrive with their wiring in M1-S5. Nothing here is stubbed to look finished.

## Toolchain

The SDK is pinned at the repository root. Never rely on whatever `flutter` happens
to be on `PATH` — R-5 records that a stale SDK was found there.

```bash
../../tool/flutterw doctor        # runs the pinned SDK
../../tool/flutterw analyze --fatal-infos
../../tool/flutterw test
```

## Layout, as fixed by §6.2

```
lib/
  app/            bootstrap, router, theme wiring, DI root
  core/           api, auth, barcode, money, models, settings, ui, offline/…
  features/       one folder per bounded feature, each with data/ domain/ presentation/
test/
integration_test/
```

These directories appear as features land. They are not created empty: Master Plan
§12 forbids building capabilities ahead of their slice.

## Conventions that are enforced, not documented

| Rule | Where it is enforced |
|---|---|
| `domain` never imports `data` or Flutter | CI stage 11 (§37.2) |
| Zero hardcoded user-visible strings | CI stage 13 (§6.8) |
| No raw colours or font sizes outside `core/ui` | CI stage 14 (§6.9) |
| No banned accounting term in a sales-reachable route | CI stage 12 (§2.2) |
| Directionality from the locale, never a manual wrapper | Lint + review (§6.8) |
| `flutter analyze --fatal-infos` clean | CI stage 8 (§37.2) |