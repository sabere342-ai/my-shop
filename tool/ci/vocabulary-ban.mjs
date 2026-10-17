/**
 * §37.2 stage 12 — vocabulary ban, Master Plan §2.2.
 *
 * The product speaks Arabic first and adopts the owner's terms, not the
 * legacy system's English nouns. Inside the sales, purchasing, and customers
 * features (Dart source and any `.arb`/`.json` catalog beside them), these
 * terms are findings wherever they appear in a string literal:
 *
 *   English:  journal, entries, debit, credit, ledger, accounts
 *   Arabic:   قيد، قيود، مدين، دائن، دفتر، حسابات
 *
 * Arabic is matched by substring because Arabic script has no reliable word
 * boundary in regular expressions; the six stems are distinctive enough that a
 * substring match is the honest form of the rule rather than a loosened one.
 *
 * Non-string occurrences (identifiers, comments) are out of scope for this
 * mechanical pass — §2.2's rule is about text the user or translator reads.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { finish, repoRoot, walkFiles } from './shared.mjs';

const FEATURE_ROOTS = ['sales', 'purchasing', 'customers'].map((feature) =>
  join(repoRoot, 'apps', 'desktop', 'lib', 'features', feature),
);

const ENGLISH = /\b(journal|entries|debit|credit|ledger|accounts)\b/i;
const ARABIC = ['قيد', 'قيود', 'مدين', 'دائن', 'دفتر', 'حسابات'];

/** Dart single- and double-quoted literals with their line numbers. */
function dartStrings(text) {
  /** @type {{ value: string, line: number }[]} */
  const out = [];
  const re = /(['"])((?:\\.|(?!\1).)*)\1/g;
  for (const match of text.matchAll(re)) {
    if (match[2] === undefined || match[2] === '') continue;
    const line = text.slice(0, match.index ?? 0).split('\n').length;
    out.push({ value: match[2], line });
  }
  return out;
}

/** Every string value in a parsed `.arb`/`.json` document. */
function jsonStrings(value, out = []) {
  if (typeof value === 'string') {
    if (value !== '') out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) jsonStrings(item, out);
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) jsonStrings(item, out);
  }
  return out;
}

const findings = [];
let scannedFiles = 0;

for (const root of FEATURE_ROOTS) {
  if (!existsSync(root)) continue;
  const files = walkFiles(root, (path) => /\.(dart|arb|json)$/.test(path));
  scannedFiles += files.length;

  for (const rel of files) {
    const abs = join(repoRoot, rel);
    const raw = readFileSync(abs, 'utf8');
    /** @type {{ value: string, line: number }[]} */
    let literals;
    if (rel.endsWith('.dart')) {
      literals = dartStrings(raw);
    } else {
      try {
        literals = jsonStrings(JSON.parse(raw)).map((value) => ({ value, line: 1 }));
      } catch {
        findings.push({
          file: rel,
          line: 1,
          rule: 'unreadable-catalog',
          detail: 'file extension says catalog but the JSON does not parse',
        });
        continue;
      }
    }

    for (const literal of literals) {
      if (ENGLISH.test(literal.value)) {
        findings.push({
          file: rel,
          line: literal.line,
          rule: 'banned-term-en',
          detail: 'string literal carries an §2.2-banned English term',
        });
      }
      const arabic = ARABIC.find((stem) => literal.value.includes(stem));
      if (arabic !== undefined) {
        findings.push({
          file: rel,
          line: literal.line,
          rule: 'banned-term-ar',
          detail: `string literal carries the §2.2-banned stem "${arabic}"`,
        });
      }
    }
  }
}

const status =
  scannedFiles === 0
    ? 'features sales/purchasing/customers not present yet — gate armed (0 files)'
    : `${scannedFiles} file(s) in the three gated features scanned`;

finish('vocabulary-ban', findings, `${status} (§37.2 stage 12 / §2.2)`);
