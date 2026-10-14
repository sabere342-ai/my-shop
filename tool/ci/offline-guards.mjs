/**
 * §37.2 stages 23–24 — offline-path guards, the mechanical half of M1b's
 * offline invariants (§38.12.1), declared here because the pipeline is this
 * slice's deliverable and later slices must inherit a red build rather than
 * discover a missing check.
 *
 * Stage 23 — **outbox deletion is the outbox module's job.** Any call that
 * deletes outbox rows (`delete`, `deleteWhere`, `deleteAll`, `clear`, or a raw
 * `DELETE FROM …outbox`) outside `lib/core/offline/outbox/**` is a finding:
 * post-dispatch cleanup is a single owned path, and a second one is how an
 * outbox row gets dropped before the server acknowledged it.
 *
 * Stage 24 — **remote applies write through one door.** Inside
 * `lib/core/offline/`, a local database write outside
 * `lib/core/offline/apply/apply_remote_without_outbox.dart` is a finding.
 * Five exemptions are declared: the outbox module (the sanctioned write path
 * for *local* mutations, §38.8), migration DDL directories, the guard
 * entry file itself, build-generated `*.g.dart` companions, and the
 * offline-grace store (`lib/core/offline/grace/offline_grace_store.dart`, added
 * by M1b-S8). Generated files are committed only so a fresh clone compiles;
 * their content belongs to the generator, a hand edit would be erased by
 * regeneration, and the patterns below steer authored code — so a finding there
 * could never be fixed by an author and would only train the gate to be
 * ignored.
 *
 * The grace-store exemption is narrow and declared with its reason: §38.12.1's
 * loop threat is a write made *in response to a remote change*, and the grace
 * store writes only device-local session state (the signed grace record, the
 * clock high-water, the tamper flag) — never remote-origin data, never an
 * enqueued mutation. It is one named file, not a directory, so every other file
 * under `grace/` is still held to the single-door rule.
 *
 * Heuristic form, declared: the write patterns are Drift-shaped (`into(`,
 * `update(x).replace(`, `insert(`, `put(`, `customStatement(`, raw
 * INSERT/UPDATE/DELETE). T-O7 (§43.2) owns the behavioural proof of these
 * invariants at M1b; this guard is the early structural tripwire, and the M1b
 * slices may sharpen its patterns — never delete them.
 *
 * Vacuous until `lib/core/offline/` exists; the status line says armed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { finish, repoRoot, stripComments, walkFiles } from './shared.mjs';

const LIB = join(repoRoot, 'apps', 'desktop', 'lib');
const OFFLINE = join(repoRoot, 'apps', 'desktop', 'lib', 'core', 'offline');

const APPLY_ENTRY = 'lib/core/offline/apply/apply_remote_without_outbox.dart';

/** Stage 24: the one declared non-apply local-write door (M1b-S8 grace store). */
const GRACE_STORE = 'lib/core/offline/grace/offline_grace_store.dart';

/** Stage 23: any deletion of outbox rows outside the outbox module. */
const OUTBOX_DELETE_RULES = [
  { name: 'outbox-delete-path', re: /\b\w*outbox\w*\s*\.\s*(?:delete|deleteWhere|deleteAll|clear)\s*\(/gi },
  { name: 'outbox-delete-path', re: /\b(?:delete|deleteWhere|deleteAll)\s*\(\s*[^)]*\boutbox/gi },
  { name: 'outbox-delete-path', re: /\bDELETE\s+FROM\s+\w*outbox/gi },
];

/** Stage 24: local database writes inside the offline module. */
const LOCAL_WRITE_RULES = [
  { name: 'local-write-outside-apply', re: /\binto\s*\(/g },
  { name: 'local-write-outside-apply', re: /\b(?:insert|put)\s*\(/g },
  { name: 'local-write-outside-apply', re: /\bupdate\s*\(\s*\w+\s*\)\s*\.\s*(?:replace|write)\s*\(/g },
  { name: 'local-write-outside-apply', re: /\b(?:customStatement|runCustom)\s*\(/g },
  { name: 'local-write-outside-apply', re: /\b(?:delete|deleteWhere)\s*\(/g },
  { name: 'local-write-outside-apply', re: /\bINSERT\s+INTO\s+\w+/gi },
  { name: 'local-write-outside-apply', re: /\bUPDATE\s+\w+\s+SET\b/gi },
  { name: 'local-write-outside-apply', re: /\bDELETE\s+FROM\s+\w+/gi },
];

const findings = [];
const dartFiles = walkFiles(LIB, (path) => path.endsWith('.dart'));
let generatedCount = 0;

for (const rel of dartFiles) {
  const relFromLib = rel.replace(/^apps\/desktop\/lib\//, '');
  if (relFromLib.endsWith('.g.dart')) {
    generatedCount += 1;
    continue;
  }
  const text = stripComments(readFileSync(join(repoRoot, rel), 'utf8'), 'c-style');
  const isOffline = relFromLib.startsWith('core/offline/');
  const isOutbox = relFromLib.startsWith('core/offline/outbox/');
  const isMigration = relFromLib.includes('/migrations/');
  const isApplyEntry = relFromLib === APPLY_ENTRY.replace(/^lib\//, '');
  const isGraceStore = relFromLib === GRACE_STORE.replace(/^lib\//, '');

  /** @param {string} rule @param {string} detail */
  const add = (rule, detail, index) => {
    findings.push({
      file: rel,
      line: text.slice(0, index).split('\n').length,
      rule,
      detail,
    });
  };

  if (!isOutbox) {
    for (const rule of OUTBOX_DELETE_RULES) {
      for (const match of text.matchAll(rule.re)) {
        add(rule.name, 'outbox row deletion outside lib/core/offline/outbox (stage 23)', match.index ?? 0);
      }
    }
  }

  if (isOffline && !isOutbox && !isMigration && !isApplyEntry && !isGraceStore) {
    for (const rule of LOCAL_WRITE_RULES) {
      for (const match of text.matchAll(rule.re)) {
        add(rule.name, 'local write outside the applyRemoteWithoutOutbox door (stage 24)', match.index ?? 0);
      }
    }
  }
}

const generatedNote = generatedCount > 0 ? `; ${generatedCount} generated *.g.dart exempt` : '';
const status =
  dartFiles.length === 0
    ? 'no dart source yet — armed'
    : `${dartFiles.length} dart file(s)${generatedNote}; offline module ${walkFiles(OFFLINE, () => true).length > 0 ? 'present' : 'not yet present (armed)'}`;

finish('offline-guards', findings, `${status} (§37.2 stages 23–24)`);
