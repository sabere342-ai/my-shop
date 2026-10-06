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
 * Three exemptions are declared: the outbox module (the sanctioned write path
 * for *local* mutations, §38.8), migration DDL directories, and the guard
 * entry file itself.
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

for (const rel of dartFiles) {
  const text = stripComments(readFileSync(join(repoRoot, rel), 'utf8'), 'c-style');
  const relFromLib = rel.replace(/^apps\/desktop\/lib\//, '');
  const isOffline = relFromLib.startsWith('core/offline/');
  const isOutbox = relFromLib.startsWith('core/offline/outbox/');
  const isMigration = relFromLib.includes('/migrations/');
  const isApplyEntry = relFromLib === APPLY_ENTRY.replace(/^lib\//, '');

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

  if (isOffline && !isOutbox && !isMigration && !isApplyEntry) {
    for (const rule of LOCAL_WRITE_RULES) {
      for (const match of text.matchAll(rule.re)) {
        add(rule.name, 'local write outside the applyRemoteWithoutOutbox door (stage 24)', match.index ?? 0);
      }
    }
  }
}

const status =
  dartFiles.length === 0
    ? 'no dart source yet — armed'
    : `${dartFiles.length} dart file(s); offline module ${walkFiles(OFFLINE, () => true).length > 0 ? 'present' : 'not yet present (armed)'}`;

finish('offline-guards', findings, `${status} (§37.2 stages 23–24)`);
