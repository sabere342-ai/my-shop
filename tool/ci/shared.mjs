/**
 * Shared helpers for the M1-S4 CI gate scripts (Master Plan §37.2 stages 1, 2,
 * 11–15, 23–24 and §37.3 gate G-6).
 *
 * Every gate in tool/ci follows the same shape: gather findings as
 * `{ file, line, rule, detail }`, print them one per line as `file:line: rule —
 * detail`, and exit 1 when there is at least one. A gate with nothing to say
 * prints a single OK line naming what it scanned, so a green run is visibly a
 * run that looked at something rather than a run that looked at nothing.
 *
 * No gate adds an npm dependency; the lockfile must stay byte-identical
 * (M1-S4 AC-8).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved from this file rather than from `cwd`. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Runs git in the repository root and returns stdout.
 *
 * @param {readonly string[]} args
 * @returns {string}
 */
export function git(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // Whole-stack diffs (the local default compares against the merge-base
    // with origin/main) exceed Node's 1 MiB default, which turns a gate
    // crash into a failed gate rather than a finding.
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** The empty tree object (SHA-1), usable as a diff base in a fresh clone. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * The commit a diff gate compares against, in resolution order:
 *
 * 1. `CI_BASE_REF` — set by the workflow to the PR base sha or the push's
 *    previous sha. All-zero shas (first push of a branch) fall through.
 * 2. `merge-base origin/main` — the default for a local run, which makes the
 *    local gate scan the whole stacked branch exactly as a PR would.
 * 3. `HEAD~1`, then the empty tree, so the gate still has a defined answer in
 *    a repository with no `origin/main`.
 *
 * @returns {string}
 */
export function resolveDiffBase() {
  const fromEnv = (process.env['CI_BASE_REF'] ?? '').trim();
  if (/^[0-9a-f]{40}$/i.test(fromEnv) && !/^0+$/i.test(fromEnv)) {
    return fromEnv.toLowerCase();
  }
  try {
    const base = git(['merge-base', 'origin/main', 'HEAD']).trim();
    if (base !== '') return base;
  } catch {
    // origin/main is absent or unrelated; fall through to the next candidate.
  }
  try {
    git(['rev-parse', '--verify', '--quiet', 'HEAD~1']);
    return 'HEAD~1';
  } catch {
    return EMPTY_TREE;
  }
}

/** Directories never worth walking, on any platform. */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.dart_tool',
  'build',
  'dist',
  'coverage',
  '.fvm',
  'out',
  '.gradle',
]);

/**
 * All files under `absRoot` matching `predicate`, as repository-relative paths
 * with `/` separators, sorted. Returns an empty list when the root does not
 * exist, which is how a gate stays armed-but-vacuous before the code it guards
 * is written (M1-S1 precedent: a gate that never runs is not a gate).
 *
 * @param {string} absRoot absolute directory
 * @param {(relPosixPath: string) => boolean} predicate
 * @returns {string[]}
 */
export function walkFiles(absRoot, predicate) {
  if (!existsSync(absRoot)) return [];
  /** @type {string[]} */
  const found = [];
  /** @type {string[]} */
  const stack = [absRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(repoRoot, abs).split(sep).join('/');
      if (predicate(rel)) found.push(rel);
    }
  }
  return found.sort();
}

/**
 * Reads a repository-relative file as UTF-8 lines (newlines stripped).
 *
 * @param {string} relPosixPath
 * @returns {string[]}
 */
export function readLines(relPosixPath) {
  // Split on either newline so a CRLF file reports the same line numbers as a
  // LF one; the platform must not change a gate's answer (§36.1 T-6).
  return readFileSync(join(repoRoot, relPosixPath), 'utf8').split(/\r?\n/);
}

/**
 * Removes comments from source text so prose that *describes* an operation
 * ("never run `DELETE FROM outbox` here") is not mistaken for the operation.
 * Heuristic by design: a `//` inside a string literal hides the rest of that
 * line, which can only *miss* a finding, never invent one — a gate errs toward
 * the direction that cannot produce a false accusation.
 *
 * @param {string} text
 * @param {'c-style' | 'sql'} dialect
 * @returns {string}
 */
export function stripComments(text, dialect) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
  if (dialect === 'sql') {
    out = out.replace(/--[^\n]*/g, (line) => ' '.repeat(line.length));
  } else {
    out = out.replace(/\/\/[^\n]*/g, (line) => ' '.repeat(line.length));
  }
  return out;
}

/**
 * Prints findings and the gate verdict, then exits.
 *
 * @param {string} gateName
 * @param {{ file: string, line: number, rule: string, detail: string }[]} findings
 * @param {string} scanned human-readable description of what was scanned
 * @returns {never}
 */
export function finish(gateName, findings, scanned) {
  if (findings.length > 0) {
    for (const finding of findings) {
      process.stdout.write(
        `${finding.file}:${finding.line}: [${gateName}] ${finding.rule} — ${finding.detail}\n`,
      );
    }
    process.stdout.write(
      `${gateName}: FAILED — ${findings.length} finding(s) in ${scanned}.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`${gateName}: OK — ${scanned}.\n`);
  process.exit(0);
}
