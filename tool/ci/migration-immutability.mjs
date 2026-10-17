/**
 * §37.3 gate G-6 — migration immutability (Master Plan §35.1 forward-only
 * discipline, M1-S4 S-5).
 *
 * Once a migration has been committed it is never rewritten. Three checks,
 * because three different escape hatches exist:
 *
 * 1. **Working tree vs HEAD** — an uncommitted or staged edit, deletion, or
 *    rename under `services/api/prisma/migrations/` fails immediately. This is
 *    the local fast path and the one a developer sees first.
 * 2. **Content vs first commit** — a migration whose current bytes differ from
 *    the bytes of the commit that introduced it has been rewritten *somewhere*
 *    in history (amend, rebase, a "small fix" on an earlier slice), even if
 *    the working tree is clean. This is the check a CI run needs, because the
 *    damage is already committed by then.
 * 3. **Deletion vs history** — a migration path that some commit added but the
 *    working tree no longer contains has been removed. Forward-only means
 *    forward.
 *
 * New migrations (status `A` against the diff base, never seen before) are the
 * legitimate case and pass all three.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { finish, git, repoRoot } from './shared.mjs';

const MIGRATIONS = 'services/api/prisma/migrations';
const findings = [];

// --- 1. working tree vs HEAD ------------------------------------------------

const status = git(['diff', '--name-status', 'HEAD', '--', MIGRATIONS]);
/** Files already reported by check 1, so one bad migration yields one finding. */
const flagged = new Set();
for (const row of status.split('\n')) {
  if (row.trim() === '') continue;
  const [code, ...paths] = row.split('\t');
  if (code === undefined || code.startsWith('A')) continue; // additions are the point
  const path = paths[paths.length - 1] ?? '(unknown)';
  flagged.add(path);
  findings.push({
    file: path,
    line: 1,
    rule: 'migration-uncommitted-change',
    detail: `git reports status ${code} against HEAD for a migration (G-6)`,
  });
}

// --- 2 + 3. history walk ----------------------------------------------------

/** Every migration path ever added in history. */
const everAdded = git([
  'log',
  '--diff-filter=A',
  '--format=--%H',
  '--name-only',
  '--',
  MIGRATIONS,
])
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('--'));

for (const rel of new Set(everAdded)) {
  if (flagged.has(rel)) continue;
  const abs = join(repoRoot, rel);

  // 3. deleted (or renamed away) from the tree entirely.
  if (!existsSync(abs)) {
    findings.push({
      file: rel,
      line: 1,
      rule: 'migration-deleted',
      detail: 'a migration that history added no longer exists (forward-only, §35.1)',
    });
    continue;
  }

  // 2. bytes differ from the commit that introduced it. `git log --diff-filter=A`
  // returns newest-first, so the last entry is the introducing commit.
  const intro = git(['log', '--diff-filter=A', '--format=%H', '--', rel])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const introducingCommit = intro[intro.length - 1];
  if (introducingCommit === undefined) continue;

  const introducedBlob = git(['rev-parse', `${introducingCommit}:${rel}`]).trim();
  const currentBlob = git(['hash-object', rel]).trim();
  if (introducedBlob !== currentBlob) {
    findings.push({
      file: rel,
      line: 1,
      rule: 'migration-rewritten',
      detail: `bytes differ from the introducing commit ${introducingCommit.slice(0, 12)} (G-6)`,
    });
  }
}

finish(
  'migration-immutability',
  findings,
  findings.length === 0
    ? `${new Set(everAdded).size} migration path(s) in history, none rewritten (§37.3 G-6)`
    : `${new Set(everAdded).size} migration path(s) in history (§37.3 G-6)`,
);
