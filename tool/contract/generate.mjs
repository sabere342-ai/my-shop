#!/usr/bin/env node
/**
 * Contract generation and drift gate (Master Plan §7.1 G-7, §40.4 M1-S6).
 *
 * Regenerates both committed contract artifacts into a temp directory and
 * compares bytes with what is committed:
 *
 *   - packages/contracts/openapi.json            (from the decorated backend)
 *   - packages/contracts/src/generated/schemas.ts (pure TypeScript emitter)
 *
 * `--check` (the `contracts:check` script) exits 1 on any difference — that is
 * the CI drift gate. Without `--check` (`contracts:generate`) it rewrites the
 * drifted artifacts, which is the only sanctioned way the files change.
 *
 * Requires the workspaces to be built (`npm run build`): the OpenAPI builder is
 * loaded from the api package's dist output, the emitter from contracts dist.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OPENAPI_TARGET = join(repoRoot, 'packages', 'contracts', 'openapi.json');
const SCHEMAS_TARGET = join(repoRoot, 'packages', 'contracts', 'src', 'generated', 'schemas.ts');
const check = process.argv.includes('--check');

const apiDistOpenapi = join(repoRoot, 'services', 'api', 'dist', 'common', 'openapi', 'openapi.js');
const contractsDistEmit = join(repoRoot, 'packages', 'contracts', 'dist', 'codegen', 'emit.js');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
}

function stateOf(target, generated) {
  if (!existsSync(target)) {
    return 'missing';
  }
  if (!readFileSync(target).equals(readFileSync(generated))) {
    return 'drifted';
  }
  return 'in sync';
}

if (!existsSync(apiDistOpenapi)) {
  fail('api dist is missing; run `npm run build` before the contract gate');
}
if (!existsSync(contractsDistEmit)) {
  fail('contracts dist is missing; run `npm run build` before the contract gate');
}

const temp = mkdtempSync(join(tmpdir(), 'my-shop-contract-'));
const tempOpenapi = join(temp, 'openapi.json');
const tempSchemas = join(temp, 'schemas.ts');

try {
  run([
    join(repoRoot, 'services', 'api', 'scripts', 'openapi.mjs'),
    '--out',
    tempOpenapi,
  ]);
  run([
    join(repoRoot, 'packages', 'contracts', 'scripts', 'emit.mjs'),
    '--in',
    tempOpenapi,
    '--out',
    tempSchemas,
    '--config',
    SCHEMAS_TARGET,
  ]);

  const artifacts = [
    { label: 'openapi.json', target: OPENAPI_TARGET, generated: tempOpenapi },
    { label: 'schemas.ts', target: SCHEMAS_TARGET, generated: tempSchemas },
  ];

  const findings = artifacts.flatMap(({ label, target, generated }) => {
    const state = stateOf(target, generated);
    return state === 'in sync' ? [] : [{ label, state }];
  });

  if (check) {
    if (findings.length > 0) {
      const lines = findings
        .map(({ label, state }) => `  ${label}: ${state}`)
        .join('\n');
      fail(`contract drift detected:\n${lines}`);
    }
    process.stdout.write('contracts are in sync\n');
    process.exit(0);
  }

  for (const { label, target, generated } of artifacts) {
    const state = stateOf(target, generated);
    if (state !== 'in sync') {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(generated, target);
      process.stdout.write(`regenerated ${label} (${state})\n`);
    } else {
      process.stdout.write(`unchanged ${label}\n`);
    }
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}