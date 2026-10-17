/**
 * §37.2 stage 14 — design-system gate, Master Plan §6.9.
 *
 * Colour and type are decided in `lib/core/ui` (theme tokens) and nowhere
 * else. Outside that directory, `apps/desktop/lib` must not contain:
 *
 * - `Colors.*` / `Color(0x…)` — a raw colour that bypasses the palette;
 * - `fontSize:` — a raw size that bypasses the type scale.
 *
 * `lib/core/ui/**` is exempt because that is where the tokens are defined.
 *
 * The rule set is the mechanical form of §6.9's "no colours or font sizes
 * outside core/ui"; it is deliberately small enough that every hit is a real
 * design-system bypass rather than a style opinion.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { finish, repoRoot, walkFiles } from './shared.mjs';

const LIB = join(repoRoot, 'apps', 'desktop', 'lib');

const RULES = [
  { name: 'raw-colour', re: /\bColors\.\w+/g, why: 'use a theme colour token (§6.9)' },
  { name: 'raw-colour-literal', re: /\bColor\s*\(\s*0x/g, why: 'use a theme colour token (§6.9)' },
  { name: 'raw-font-size', re: /\bfontSize\s*:/g, why: 'use a type-scale token (§6.9)' },
];

const findings = [];
const dartFiles = walkFiles(LIB, (path) => path.endsWith('.dart') && !/(^|\/)core\/ui\//.test(path));

for (const rel of dartFiles) {
  const text = readFileSync(join(repoRoot, rel), 'utf8');
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.re)) {
      const line = text.slice(0, match.index ?? 0).split('\n').length;
      findings.push({
        file: rel,
        line,
        rule: rule.name,
        detail: `${rule.why}; only lib/core/ui may define the primitive`,
      });
    }
  }
}

finish(
  'design-system-check',
  findings,
  `${dartFiles.length} dart file(s) outside lib/core/ui (§37.2 stage 14 / §6.9)`,
);
