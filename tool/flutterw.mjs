/**
 * My Shop — pinned Flutter SDK runner.
 *
 * Master Plan R-5: the host carries more than one Flutter SDK and the one on PATH is
 * over a year stale. `.tool-versions` records the SDK this repository is verified
 * against; this runner executes that SDK against `apps/desktop`, the monorepo's single
 * Flutter package (Master Plan section 6.2 - one codebase targeting Windows and Android).
 *
 * It selects an SDK. It never installs, upgrades, or deletes one, and it never mutates
 * PATH globally or writes to the user or system environment. Installing or upgrading a
 * host SDK is a global machine change and is outside repository scope.
 *
 * Usage:
 *   node tool/flutterw.mjs analyze --fatal-infos
 *   node tool/flutterw.mjs test
 *   node tool/flutterw.mjs doctor
 *
 * Shell equivalent, for environments that prefer it: `tool/flutterw`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePinnedSdk } from './pinned-sdk.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  process.stderr.write(`flutterw: ${message}\n`);
  process.exit(1);
}

function resolveAppDir() {
  const override = process.env['MY_SHOP_FLUTTER_APP_DIR'];
  const appDir = override !== undefined && override !== '' ? override : join(repoRoot, 'apps', 'desktop');
  if (!existsSync(join(appDir, 'pubspec.yaml'))) {
    fail(`no pubspec.yaml in ${appDir}`);
  }
  return appDir;
}

/**
 * Builds the child environment with the pinned SDK's own bin and bundled Dart ahead of
 * the inherited PATH. Scoping this to the child process is the entire point: the
 * wrapper selects an SDK for one invocation and leaves the host environment untouched.
 *
 * @param {string} sdkRoot
 */
function childEnvironment(sdkRoot) {
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const inherited = process.env['PATH'] ?? '';
  return {
    ...process.env,
    PATH: [join(sdkRoot, 'bin'), join(sdkRoot, 'bin', 'cache', 'dart-sdk', 'bin'), inherited]
      .filter((part) => part.length > 0)
      .join(delimiter),
  };
}

const resolved = resolvePinnedSdk();
if (resolved === undefined) {
  fail(
    'no Flutter SDK matching the pin was found.\n' +
      '  Point MY_SHOP_FLUTTER_ROOT at an existing install, or correct .tool-versions\n' +
      '  if the pin itself is wrong. Installing a host SDK is a global machine change\n' +
      '  and is outside repository scope.',
  );
}

if (resolved.pinMismatch === true) {
  fail(
    `SDK pin mismatch: .tool-versions expects ${String(resolved.pin)} but ${resolved.root} reports ` +
      `${String(resolved.sdk['flutterVersion'])}.\n` +
      '  Refusing to run. This is R-5 surfacing as a hard failure rather than a warning.',
  );
}

const isWindows = process.platform === 'win32';
const result = spawnSync(resolved.executable, process.argv.slice(2), {
  stdio: 'inherit',
  cwd: resolveAppDir(),
  env: childEnvironment(resolved.root),
  // The Windows entry point is a .bat, which needs cmd.exe. Verbatim arguments hand
  // the command line over as written rather than re-quoting it.
  shell: isWindows,
  windowsVerbatimArguments: isWindows,
});

if (result.error !== undefined) {
  fail(`could not execute ${resolved.executable}: ${result.error.message}`);
}

process.exit(result.status ?? 1);