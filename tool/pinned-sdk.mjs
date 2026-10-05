/**
 * Reports the pinned Flutter SDK's version fields as JSON.
 *
 * Master Plan R-5: the host carries more than one Flutter SDK and the one on PATH is
 * over a year stale. `.tool-versions` records the SDK the repository is verified
 * against; this module resolves that pin to an install and reports what is actually
 * there, so tool/verify-toolchain.mjs can compare the two without shelling through a
 * bash flavour that may or may not exist.
 *
 * It selects an SDK. It never installs, upgrades, deletes, or mutates PATH globally.
 *
 * Usage:
 *   node tool/pinned-sdk.mjs                 # full report as JSON
 *   node tool/pinned-sdk.mjs --field name    # one field, bare value
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readPins() {
  const pinFile = join(repoRoot, '.tool-versions');
  if (!existsSync(pinFile)) {
    throw new Error(`missing ${pinFile}`);
  }
  /** @type {Record<string, string>} */
  const pins = {};
  for (const rawLine of readFileSync(pinFile, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const [tool, version] = line.split(/\s+/);
    if (tool !== undefined && version !== undefined) {
      pins[tool] = version;
    }
  }
  return pins;
}

/**
 * Candidate install locations, in resolution order.
 *
 * Git Bash on Windows mounts the system drive at /c; WSL mounts it at /mnt/c. Both
 * spellings are offered so the same file works under either, plus the conventional
 * Windows and macOS locations.
 *
 * @param {string} version
 * @returns {string[]}
 */
export function candidateRoots(version) {
  const candidates = [];
  if (process.env['MY_SHOP_FLUTTER_ROOT'] !== undefined && process.env['MY_SHOP_FLUTTER_ROOT'] !== '') {
    candidates.push(process.env['MY_SHOP_FLUTTER_ROOT']);
  }
  const localAppData = process.env['LOCALAPPDATA'];
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  candidates.push(
    `C:/src/flutter-${version}`,
    `/c/src/flutter-${version}`,
    `/mnt/c/src/flutter-${version}`,
    ...(localAppData !== undefined ? [`${localAppData}/flutter-${version}`] : []),
    ...(home !== '' ? [`${home}/flutter-${version}`] : []),
    join(repoRoot, '.fvm', 'flutter_sdk'),
  );
  return candidates;
}

/**
 * Locates the Flutter executable inside a candidate root.
 *
 * @param {string} root
 * @returns {string | undefined}
 */
export function flutterExecutable(root) {
  if (process.platform === 'win32') {
    const bat = join(root, 'bin', 'flutter.bat');
    return existsSync(bat) ? bat : undefined;
  }
  const sh = join(root, 'bin', 'flutter');
  return existsSync(sh) ? sh : undefined;
}

/** @returns {{root: string, executable: string, sdk: Record<string, unknown>} | undefined} */
export function resolvePinnedSdk() {
  const pins = readPins();
  const version = pins['flutter'];
  if (version === undefined) {
    throw new Error('no flutter pin in .tool-versions');
  }

  for (const root of candidateRoots(version)) {
    const executable = flutterExecutable(root);
    if (executable === undefined) continue;
    // Running `--version --machine` is the only way to read the framework and Dart
    // versions from an SDK without trusting the directory name.
    //
    // On Windows the entry point is a .bat, which Node cannot spawn directly
    // (EINVAL since Node 18.20.2 / 20.12.2 for security reasons). It is invoked
    // through cmd.exe instead.
    const output =
      process.platform === 'win32'
        ? execFileSync(
            process.env['COMSPEC'] ?? 'cmd.exe',
            ['/d', '/c', `"${executable}" --version --machine`],
            {
              encoding: 'utf8',
              cwd: repoRoot,
              stdio: ['ignore', 'pipe', 'ignore'],
              // Node's default Windows argument quoting mangles a quoted .bat path
              // enough that cmd.exe reports it as an unrecognised command.
              // Verbatim arguments hand the string to cmd.exe as written.
              windowsVerbatimArguments: true,
            },
          )
        : execFileSync(executable, ['--version', '--machine'], {
            encoding: 'utf8',
            cwd: repoRoot,
            stdio: ['ignore', 'pipe', 'ignore'],
          });
    const sdk = JSON.parse(output);
    if (sdk['frameworkVersion'] !== version) {
      // Found a different SDK at that path. Reporting it is more useful than
      // searching on, because it names the actual discrepancy.
      return { root, executable, sdk, pin: version, pinMismatch: true };
    }
    return { root, executable, sdk, pin: version };
  }
  return undefined;
}

// --- CLI entry ---
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const resolved = resolvePinnedSdk();
  const fieldIndex = process.argv.indexOf('--field');
  if (resolved === undefined) {
    process.stderr.write('pinned-sdk: no Flutter SDK matching the pin was found.\n');
    process.stderr.write(`pinned-sdk: searched:\n`);
    for (const root of candidateRoots(readPins()['flutter'] ?? '?')) {
      process.stderr.write(`  ${root}\n`);
    }
    process.stderr.write(
      'pinned-sdk: installing a host SDK is a global machine change and is outside\n' +
        'pinned-sdk: repository scope. Point MY_SHOP_FLUTTER_ROOT at an existing install.\n',
    );
    process.exit(1);
  }

  if (fieldIndex !== -1) {
    const field = process.argv[fieldIndex + 1];
    const value = field === undefined ? undefined : resolved.sdk[field];
    if (value === undefined) {
      process.stderr.write(`pinned-sdk: unknown field ${String(field)}\n`);
      process.exit(1);
    }
    process.stdout.write(`${String(value)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ root: resolved.root, ...resolved.sdk }, null, 2)}\n`);
  }
}