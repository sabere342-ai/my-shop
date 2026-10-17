/**
 * §37.2 stage 11 — import boundary, Master Plan §6.3.
 *
 * Two rules, both structural:
 *
 * - `domain` must not import `package:flutter*` or `dart:ui`: the domain layer
 *   is pure Dart so the business rules can run in a test VM without an engine
 *   (§6.3's "domain ╳ flutter FORBIDDEN").
 * - `domain` must not import `data` (any `.../data/...` module): domain defines
 *   ports, data implements them, and the dependency arrow must not reverse
 *   (§6.3's "domain ╳ data FORBIDDEN").
 *
 * Files qualify as domain by living under a `domain/` path segment. Relative
 * imports are resolved against the importing file; `package:` imports other
 * than the two rules above are left to this rule's siblings.
 *
 * Vacuous until feature slices create `lib/features/<feature>/domain/`, which
 * is expected: the gate is armed and says so rather than passing silently.
 */

import { existsSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { finish, readLines, repoRoot, walkFiles } from './shared.mjs';

const LIB = join(repoRoot, 'apps', 'desktop', 'lib');

const findings = [];
const files = walkFiles(LIB, (path) => path.endsWith('.dart'));

let scannedDomainFiles = 0;

for (const rel of files) {
  if (!/(^|\/)domain\//.test(rel)) continue;
  scannedDomainFiles += 1;
  const lines = readLines(rel);

  lines.forEach((raw, index) => {
    const importMatch = /^\s*import\s+'([^']+)'/.exec(raw);
    if (importMatch === null || importMatch[1] === undefined) return;
    const spec = importMatch[1];
    const lineNo = index + 1;

    if (spec.startsWith('package:flutter/') || spec.startsWith('package:flutter_localizations/')) {
      findings.push({
        file: rel,
        line: lineNo,
        rule: 'domain-vs-flutter',
        detail: 'domain must be pure Dart; import of a Flutter package is forbidden (§6.3)',
      });
      return;
    }
    if (spec === 'dart:ui') {
      findings.push({
        file: rel,
        line: lineNo,
        rule: 'domain-vs-flutter',
        detail: 'dart:ui is the Flutter engine; domain must not reach it (§6.3)',
      });
      return;
    }

    // Where does a relative import land?
    let landed = '';
    if (spec.startsWith('../') || spec.startsWith('./')) {
      landed = normalize(join(dirname(rel), spec)).split(sep).join('/');
      if (!landed.endsWith('.dart')) landed += '.dart';
      if (!existsSync(resolve(repoRoot, landed))) landed = '';
    } else if (spec.includes('/data/')) {
      landed = spec;
    }

    if (/(^|\/)data\//.test(landed)) {
      findings.push({
        file: rel,
        line: lineNo,
        rule: 'domain-vs-data',
        detail: `domain importing data (${landed}) reverses the dependency arrow (§6.3)`,
      });
    }
  });
}

const status =
  scannedDomainFiles === 0
    ? `no lib/**/domain/ files yet — gate armed, ${files.length} dart file(s) outside domain scanned for structure`
    : `${scannedDomainFiles} domain file(s) checked out of ${files.length} dart file(s)`;

finish('import-boundary', findings, `${status} (§37.2 stage 11 / §6.3)`);
