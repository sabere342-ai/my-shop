/**
 * M2-S1 hardening (finding F-1) — a TypeScript architectural regression test.
 *
 * §39.3 D-1 fixes the dependency direction between the two contexts this slice
 * introduces: `identity` and `tenancy` are independent, and neither depends on
 * the other. The bootstrap command must compose both, so its orchestration
 * lives in the neutral composition root `common/bootstrap/`, which imports
 * `identity` and `tenancy` — never the reverse.
 *
 * Dart already has a structural gate (`tool/ci/import-boundary.mjs`); the
 * TypeScript tree had none, which is how the original `tenancy → identity` edge
 * (§39.2's stated cycle, §39.3's forbidden direction) survived review. This
 * suite is that gate: it reads the real source files and fails if the edge
 * reappears, so the rule is enforced by a machine and not by a comment.
 *
 * The scan is over production sources (`*.ts`, excluding `*.spec.ts`), because
 * the concern is what ships, not what a test may arrange.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const COMMON_ROOT = path.resolve(__dirname, '..');

/** One statement of the layering: files in `dir` may not import from any `forbidden` context. */
interface ImportRule {
  readonly dir: string;
  readonly forbidden: readonly string[];
}

const RULES: readonly ImportRule[] = [
  // D-1, the finding this test closes: tenancy never reaches into identity…
  { dir: 'tenancy', forbidden: ['identity', 'bootstrap'] },
  // …and identity never reaches into tenancy. `bootstrap` is the neutral
  // composition root both would otherwise be tempted to import.
  { dir: 'identity', forbidden: ['tenancy', 'bootstrap'] },
];

/** Every non-spec TypeScript file under `root`, recursively. */
function productionSources(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...productionSources(absolute));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      found.push(absolute);
    }
  }
  return found;
}

/** The module specifiers a file imports, from `from '…'` and dynamic `import('…')`. */
function importedSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const staticImport = /\bfrom\s+['"]([^'"]+)['"]/g;
  const dynamicImport = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const pattern of [staticImport, dynamicImport]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1] !== undefined) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/** The context directory a relative specifier resolves into, or `null` for a package import. */
function targetContext(
  specifier: string,
  importingFile: string,
): { readonly context: string; readonly resolved: string } | null {
  if (!specifier.startsWith('.')) return null; // a package (e.g. `@prisma/client`) is not a context edge
  const resolved = path.resolve(path.dirname(importingFile), specifier);
  const relative = path.relative(COMMON_ROOT, resolved);
  if (relative.startsWith('..')) return null; // outside `common/` (e.g. `../config`)
  const [context] = relative.split(path.sep);
  return context === undefined ? null : { context, resolved };
}

describe('common/ architectural import boundaries (D-1)', () => {
  const sources = productionSources(COMMON_ROOT);

  it('scans the two contexts it constrains (a guard against a silently empty scan)', () => {
    const contexts = new Set(sources.map((file) => path.relative(COMMON_ROOT, file).split(path.sep)[0]));
    for (const { dir } of RULES) {
      expect(contexts.has(dir)).toBe(true);
    }
  });

  it('keeps every context independent of the ones it must not depend on', () => {
    const violations: string[] = [];

    for (const file of sources) {
      const relative = path.relative(COMMON_ROOT, file).split(path.sep);
      const owner = relative[0];
      if (owner === undefined) continue;
      const rule = RULES.find((candidate) => candidate.dir === owner);
      if (rule === undefined) continue;

      const source = readFileSync(file, 'utf8');
      for (const specifier of importedSpecifiers(source)) {
        const target = targetContext(specifier, file);
        if (target === null) continue;
        if (rule.forbidden.includes(target.context)) {
          violations.push(`${owner} -> ${target.context}: ${specifier} (${path.relative(COMMON_ROOT, file)})`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
