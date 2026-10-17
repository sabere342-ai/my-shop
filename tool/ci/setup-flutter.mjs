/**
 * CI bootstrap for the pinned Flutter SDK (Master Plan §42.2 R-5, M1-S4).
 *
 * The repository pins Flutter in `.tool-versions`; `tool/pinned-sdk.mjs`
 * resolves that pin without touching PATH. This script makes the same
 * resolution work on a fresh CI runner:
 *
 * 1. Ensure a checkout of the pinned tag exists at `$HOME/flutter-<pin>`
 *    (or at `MY_SHOP_FLUTTER_ROOT` when the runner already carries one).
 *    The directory name is versioned so `actions/cache` can key off
 *    `flutter-*` and a changed pin cannot silently reuse the old SDK.
 * 2. Export `MY_SHOP_FLUTTER_ROOT` to `$GITHUB_ENV` so every later step —
 *    including `tool/flutterw.mjs` invocations — resolves the same install.
 * 3. Run the pin verification, which also warms the SDK (its first
 *    `--version --machine` downloads the bundled Dart SDK). A framework
 *    version that differs from the pin fails the job here rather than five
 *    minutes into a build.
 *
 * No global install, no PATH mutation: the script selects an SDK, exactly as
 * `pinned-sdk.mjs` documents.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePinnedSdk, flutterExecutable, candidateRoots } from '../pinned-sdk.mjs';
import { repoRoot } from './shared.mjs';

function flutterPin() {
  const text = readFileSync(join(repoRoot, '.tool-versions'), 'utf8');
  const line = text.split(/\r?\n/).find((raw) => raw.trim().startsWith('flutter '));
  if (line === undefined) throw new Error('.tool-versions has no flutter pin');
  return line.trim().split(/\s+/)[1];
}

const pin = flutterPin();
const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
if (home === '') throw new Error('neither HOME nor USERPROFILE is set');
const root = process.env['MY_SHOP_FLUTTER_ROOT'] ?? join(home, `flutter-${pin}`);

if (flutterExecutable(root) === undefined) {
  process.stdout.write(`setup-flutter: cloning flutter/flutter ${pin} into ${root}\n`);
  const clone = spawnSync(
    'git',
    ['clone', '--depth', '1', '--branch', pin, 'https://github.com/flutter/flutter.git', root],
    { stdio: 'inherit', windowsHide: true },
  );
  if (clone.status !== 0) {
    process.stderr.write('setup-flutter: clone failed\n');
    process.exit(clone.status ?? 1);
  }
}

// Point the resolver at this install first; it then verifies the framework
// version against the pin and warms the bundled Dart SDK.
process.env['MY_SHOP_FLUTTER_ROOT'] = root;
if (process.env['GITHUB_ENV'] !== undefined) {
  appendFileSync(process.env['GITHUB_ENV'], `MY_SHOP_FLUTTER_ROOT=${root}\n`);
}

const resolved = resolvePinnedSdk();
if (resolved === undefined) {
  process.stderr.write(`setup-flutter: no SDK at ${root} matches the pin ${pin}\n`);
  process.stderr.write(`setup-flutter: searched ${candidateRoots(pin).join(', ')}\n`);
  process.exit(1);
}
if (resolved.pinMismatch === true) {
  process.stderr.write(
    `setup-flutter: SDK at ${resolved.root} reports a framework version that is not ${pin}\n`,
  );
  process.exit(1);
}

process.stdout.write(`setup-flutter: ready — ${resolved.root} (framework ${pin})\n`);
