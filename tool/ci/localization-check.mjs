/**
 * §37.2 stage 13 — localization and bidirectional gates, Master Plan §6.8.
 *
 * Two mechanical halves:
 *
 * **A. No hardcoded user-facing text.** `Text('…')` and the user-visible named
 * arguments (`title`, `label`, `labelText`, `hintText`, `tooltip`,
 * `semanticLabel`, `message`, `content`, `helperText`, `errorText`,
 * `buttonText`) must not receive a string literal in `apps/desktop/lib`.
 * Everything the user reads arrives from the ARB catalogs (M1-S5).
 *
 * **B. No physical-direction assumptions** inside `lib/core/ui` and
 * `lib/features`: `Alignment.centerLeft/centerRight`, `EdgeInsets.left/right`,
 * `EdgeInsets.only(left:, right:)`, `EdgeInsets.fromSTEB`,
 * `BorderRadius.horizontal(left:, right:)`, and manual `Directionality(`
 * wrappers are all LTR thinking that breaks Arabic. §6.8 requires logical
 * alternatives (`start`/`end`, `AlignmentDirectional`, `EdgeInsetsDirectional`).
 *
 * Scope note (declared): the bidi half covers `core/ui` and `features/` — the
 * surfaces §6.8 names — not `lib/main.dart`, which is a composition root.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { finish, repoRoot, walkFiles } from './shared.mjs';

const LIB = join(repoRoot, 'apps', 'desktop', 'lib');

/** Section A: literal text in a user-visible position. */
const TEXT_RULES = [
  { name: 'hardcoded-text', re: /\bText\s*\(\s*(?:r?)(['"])[^'"]+\1/g },
  {
    name: 'hardcoded-text-argument',
    re: /\b(?:title|label|labelText|hintText|tooltip|semanticLabel|semanticsLabel|message|content|helperText|errorText|buttonText)\s*:\s*(?:r?)(['"])[^'"]+\1/g,
  },
];

/** Section B: physical-direction primitives in UI trees. */
const BIDI_RULES = [
  { name: 'physical-alignment', re: /\bAlignment\.(?:centerLeft|centerRight)\b/g },
  { name: 'physical-edge-inset', re: /\bEdgeInsets\.(?:left|right)\b/g },
  { name: 'physical-edge-inset', re: /\bEdgeInsets\.fromSTEB\s*\(/g },
  {
    name: 'physical-edge-only',
    re: /\bEdgeInsets\.only\s*\((?:[^()]|\([^()]*\))*\bleft\s*:/g,
  },
  {
    name: 'physical-edge-only',
    re: /\bEdgeInsets\.only\s*\((?:[^()]|\([^()]*\))*\bright\s*:/g,
  },
  {
    name: 'physical-border-radius',
    re: /\bBorderRadius\.horizontal\s*\((?:[^()]|\([^()]*\))*\b(?:left|right)\s*:/g,
  },
  { name: 'manual-directionality', re: /\bDirectionality\s*\(/g },
];

const findings = [];
const dartFiles = walkFiles(LIB, (path) => path.endsWith('.dart'));

/** @param {string} text @param {number} index */
function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

for (const rel of dartFiles) {
  const text = readFileSync(join(repoRoot, rel), 'utf8');
  const inCoreUiOrFeatures = /(^|\/)(core\/ui|features)\//.test(rel);

  for (const rule of TEXT_RULES) {
    for (const match of text.matchAll(rule.re)) {
      findings.push({
        file: rel,
        line: lineAt(text, match.index ?? 0),
        rule: rule.name,
        detail: 'string literal in user-visible position; use the ARB catalog (§6.8)',
      });
    }
  }
  if (!inCoreUiOrFeatures) continue;
  for (const rule of BIDI_RULES) {
    for (const match of text.matchAll(rule.re)) {
      findings.push({
        file: rel,
        line: lineAt(text, match.index ?? 0),
        rule: rule.name,
        detail: 'physical-direction primitive; Arabic-first UI needs logical start/end (§6.8)',
      });
    }
  }
}

finish(
  'localization-check',
  findings,
  `${dartFiles.length} dart file(s) under apps/desktop/lib (§37.2 stage 13 / §6.8)`,
);
