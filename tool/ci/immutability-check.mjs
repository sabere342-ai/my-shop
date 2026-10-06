/**
 * §37.2 stage 15 — journal immutability, Master Plan §31.1.
 *
 * The journal (double-entry ledger) is append-only: rows are created and never
 * changed. This gate scans the backend source and the Prisma surface for any
 * statement that could rewrite or remove a journal row:
 *
 * - Prisma delegates: `journal.update/upsert/delete/deleteMany/updateMany…(`
 *   on any of the journal model names;
 * - raw SQL: `UPDATE journal…`, `DELETE FROM journal…` (inserts are the
 *   legitimate append and are not findings).
 *
 * Comments and identifiers that merely mention the word are not matched: the
 * patterns require an actual write shape. Journal code does not exist until
 * M2, so today the gate is armed and vacuous — it says so instead of passing
 * silently, and M2 inherits it as an inherited gate, not a new one.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { finish, repoRoot, stripComments, walkFiles } from './shared.mjs';

const JOURNAL_MODELS = String.raw`journal(?:s|Entries|Entry|_entries|_entry)?`;
const RULES = [
  {
    name: 'journal-mutation-prisma',
    why: 'Prisma write to a journal model contradicts append-only (§31.1)',
    re: new RegExp(
      `\\b${JOURNAL_MODELS}\\s*\\.\\s*(?:update|upsert|delete|deleteMany|updateMany|updateManyAndReturn)\\s*\\(`,
      'gi',
    ),
  },
  {
    name: 'journal-mutation-sql',
    why: 'SQL UPDATE/DELETE against a journal table contradicts append-only (§31.1)',
    re: new RegExp(
      `\\b(?:UPDATE\\s+|DELETE\\s+FROM\\s+)(?:"?\`?\\w+"?\`?\\.)?"?\`?${JOURNAL_MODELS}\\b`,
      'gi',
    ),
  },
];

const findings = [];
const files = walkFiles(join(repoRoot, 'services', 'api'), (path) =>
  /\.(ts|mjs|js|sql)$/.test(path),
);

for (const rel of files) {
  const dialect = rel.endsWith('.sql') ? 'sql' : 'c-style';
  const text = stripComments(readFileSync(join(repoRoot, rel), 'utf8'), dialect);
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.re)) {
      const line = text.slice(0, match.index ?? 0).split('\n').length;
      findings.push({ file: rel, line, rule: rule.name, detail: rule.why });
    }
  }
}

finish(
  'immutability-check',
  findings,
  `${files.length} backend file(s) (§37.2 stage 15 / §31.1)`,
);
