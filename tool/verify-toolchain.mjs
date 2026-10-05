/**
 * My Shop — toolchain verification.
 *
 * Confirms that the Node, Dart, and Flutter versions actually in use match
 * `.tool-versions`. This is the guard that makes the R-5 pin load-bearing rather
 * than decorative: a contributor on a stale SDK fails here instead of silently
 * building V1 on a 2024 toolchain.
 *
 * Master Plan §42.2 R-5 records that the host carried a Flutter SDK over a year old.
 * Node-based rather than shell-based on purpose: this host has three bash flavours
 * (WSL, Git Bash, and none on a bare PATH), and a check that passes in one of them
 * and silently skips in the others is not a check.
 *
 * Exits non-zero on any mismatch.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePinnedSdk } from './pinned-sdk.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pinFile = join(repoRoot, '.tool-versions');

/** @type {Map<string, string>} */
const pins = new Map();

function loadPins() {
  if (!existsSync(pinFile)) {
    fail(`missing ${pinFile}`);
    return false;
  }
  for (const rawLine of readFileSync(pinFile, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const [tool, version] = line.split(/\s+/);
    if (tool !== undefined && version !== undefined) {
      pins.set(tool, version);
    }
  }
  return true;
}

function fail(message) {
  process.stderr.write(`verify-toolchain: ${message}\n`);
  process.exit(1);
}

loadPins();

const results = [];

/**
 * @param {string} tool
 * @param {() => string} probe
 */
function check(tool, probe) {
  const expected = pins.get(tool);
  if (expected === undefined) {
    results.push({ tool, expected: undefined, actual: undefined, state: 'unpinned' });
    return;
  }
  let actual;
  try {
    actual = probe(tool, []).trim();
  } catch {
    actual = undefined;
  }
  if (actual === undefined || actual.length === 0) {
    results.push({ tool, expected, actual: undefined, state: 'missing' });
    return;
  }
  results.push({ tool, expected, actual, state: actual === expected ? 'ok' : 'mismatch' });
}

function run(command, args) {
  // No shell: every command here is an executable Node already knows how to spawn
  // directly (node itself, npm through its .cmd shim). Routing through cmd.exe
  // would require quoting paths and is how the Flutter probe broke earlier.
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
}

// --- Node: the process running this script ---
check('nodejs', () => process.versions.node);

// --- npm ---
try {
  const npmVersion = run('npm', ['--version']).trim();
  results.push({ tool: 'npm', expected: undefined, actual: npmVersion, state: 'ok' });
} catch {
  results.push({ tool: 'npm', expected: undefined, actual: undefined, state: 'missing' });
}

// --- Flutter and Dart, resolved through the pinned selector ---
//
// resolvePinnedSdk is imported rather than shelled out to: spawning a second Node
// process to read two fields of a JSON document adds quoting hazards and no
// information.
let pinnedSdk;
try {
  pinnedSdk = resolvePinnedSdk();
} catch (error) {
  pinnedSdk = undefined;
  process.stderr.write(`verify-toolchain: could not resolve the pinned SDK: ${error.message}\n`);
}

if (pinnedSdk === undefined) {
  results.push({ tool: 'flutter', expected: pins.get('flutter'), actual: undefined, state: 'missing' });
  results.push({ tool: 'dart', expected: pins.get('dart'), actual: undefined, state: 'missing' });
} else {
  if (pinnedSdk.pinMismatch === true) {
    process.stderr.write(
      `verify-toolchain: ${pinnedSdk.root} reports ${String(pinnedSdk.sdk['frameworkVersion'])} ` +
        `but .tool-versions pins ${String(pinnedSdk.pin)}.\n`,
    );
  }
  check('flutter', () => String(pinnedSdk.sdk['frameworkVersion'] ?? ''));
  check('dart', () => String(pinnedSdk.sdk['dartSdkVersion'] ?? ''));
}

// --- Report ---
process.stdout.write('My Shop toolchain verification\n');
process.stdout.write(`  pin file: ${pinFile}\n\n`);

let failures = 0;
for (const result of results) {
  const width = 8;
  if (result.state === 'ok') {
    process.stdout.write(`ok    ${result.tool.padEnd(width)} ${result.actual ?? ''}\n`);
    continue;
  }
  failures += 1;
  const expected = result.expected ?? '(no pin)';
  if (result.state === 'unpinned') {
    process.stdout.write(`warn  ${result.tool.padEnd(width)} no pin in .tool-versions\n`);
  } else if (result.state === 'missing') {
    process.stdout.write(`FAIL  ${result.tool.padEnd(width)} expected ${expected.padEnd(width)} not found\n`);
  } else {
    process.stdout.write(
      `FAIL  ${result.tool.padEnd(width)} expected ${expected.padEnd(width)} found ${result.actual ?? ''}\n`,
    );
  }
}

process.stdout.write('\n');

if (failures > 0) {
  process.stdout.write(`RESULT: FAIL - ${failures} mismatch(es).\n\n`);
  process.stdout.write('Master Plan R-5: do not build V1 on a stale SDK. Either select the pinned\n');
  process.stdout.write('SDK (tool/flutterw, or MY_SHOP_FLUTTER_ROOT) or correct .tool-versions if\n');
  process.stdout.write('the pin itself is wrong.\n');
  process.exit(1);
}

process.stdout.write('RESULT: PASS - every active toolchain matches the pin.\n');