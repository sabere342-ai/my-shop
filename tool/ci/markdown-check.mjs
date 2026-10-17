/**
 * §37.2 stage 2 — markdown lint and repository-internal link check, with zero
 * npm dependencies (M1-S4 S-3: `package-lock.json` must stay byte-identical).
 *
 * Rules, over every git-tracked `*.md` file:
 *
 * - R1 no trailing whitespace (a diff that drags whitespace into a document is
 *   a diff that will fight every future formatter);
 * - R2 no tab indentation;
 * - R3 ATX headings are `#`…`######` followed by a space or the line end —
 *   `#no-space` and `#######` are not headings and render as text;
 * - R4 every relative link and image resolves to a path that exists inside the
 *   repository, and every `#anchor` (including `file.md#anchor`) resolves to a
 *   heading slug in the target file. `http(s)://`, `mailto:` and bare external
 *   targets are out of scope: this gate needs no network and must not need one.
 *
 * Fenced code blocks are excluded from R1–R4: shell examples legitimately
 * contain `#comment` lines and trailing-space demonstrations.
 *
 * The anchor algorithm follows GitHub's: lowercase, markdown formatting
 * stripped, punctuation removed, whitespace to hyphens, duplicates suffixed
 * `-1`, `-2`, … exactly as the renderer does.
 */

import { existsSync } from 'node:fs';
import { dirname, normalize, resolve, sep } from 'node:path';
import { finish, git, readLines, repoRoot } from './shared.mjs';

const findings = [];

/** @param {string} file @param {number} line @param {string} rule @param {string} detail */
function flag(file, line, rule, detail) {
  findings.push({ file, line, rule, detail });
}

/** Slugs every heading in a file to GitHub's anchor algorithm. */
function headingAnchors(lines) {
  /** @type {Map<string, number>} slug -> occurrences beyond the first */
  const seen = new Map();
  /** @type {Set<string>} */
  const anchors = new Set();
  let inFence = false;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading === null) continue;
    let text = heading[1] ?? '';
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    text = text.replace(/[`*_~]/g, '');
    let slug = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-');
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    if (count > 0) slug = `${slug}-${count}`;
    anchors.add(slug);
  }
  return anchors;
}

const tracked = git(['ls-files', '*.md', ':!:*.mdx'])
  .split('\n')
  .filter((path) => path !== '');

/** Anchor cache so a file linked from many places is slugged once. */
const anchorCache = new Map();

/** @returns {Set<string> | undefined} anchors when the target is a tracked markdown file */
function anchorsOf(relMarkdownPath) {
  if (anchorCache.has(relMarkdownPath)) return anchorCache.get(relMarkdownPath);
  const abs = resolve(repoRoot, normalize(relMarkdownPath));
  if (!abs.startsWith(repoRoot + sep) || !existsSync(abs)) return undefined;
  const anchors = headingAnchors(readLines(relMarkdownPath));
  anchorCache.set(relMarkdownPath, anchors);
  return anchors;
}

/** Splits `path#anchor` and decides whether the target is external. */
function checkTarget(mdFile, target, lineNo) {
  let link = target;
  if (link.startsWith('<') && link.endsWith('>')) link = link.slice(1, -1);
  if (link === '') return;
  if (/^(https?:|mailto:|tel:)/i.test(link)) return;

  const hash = link.indexOf('#');
  const pathPart = hash === -1 ? link : link.slice(0, hash);
  const anchor = hash === -1 ? '' : decodeURIComponent(link.slice(hash + 1));

  if (pathPart === '') {
    // Same-file anchor.
    const anchors = anchorsOf(mdFile);
    if (anchors !== undefined && anchor !== '' && !anchors.has(anchor.toLowerCase())) {
      flag(mdFile, lineNo, 'dead-anchor', `#${anchor} matches no heading in this file`);
    }
    return;
  }

  const baseDir = dirname(mdFile);
  const relTarget = baseDir === '.' ? pathPart : `${baseDir}/${pathPart}`;
  const normalized = normalize(relTarget).split(sep).join('/');

  if (normalized.startsWith('..')) {
    flag(mdFile, lineNo, 'link-out-of-repository', `target ${pathPart} escapes the repository`);
    return;
  }
  if (!existsSync(resolve(repoRoot, normalized))) {
    flag(mdFile, lineNo, 'dead-link', `target ${pathPart} does not exist`);
    return;
  }
  if (anchor !== '' && normalized.toLowerCase().endsWith('.md')) {
    const anchors = anchorsOf(normalized);
    if (anchors !== undefined && !anchors.has(anchor.toLowerCase())) {
      flag(mdFile, lineNo, 'dead-anchor', `${pathPart}#${anchor} matches no heading in its target`);
    }
  }
}

for (const mdFile of tracked) {
  const lines = readLines(mdFile);
  let inFence = false;

  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.replace(/\r$/, '');

    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    if (/[ \t]+$/.test(line)) {
      flag(mdFile, lineNo, 'trailing-whitespace', 'line ends in whitespace');
    }
    if (/^\t/.test(line)) {
      flag(mdFile, lineNo, 'tab-indentation', 'line starts with a tab');
    }
    if (/^#{1,6}(?![#\s])/.test(line)) {
      flag(mdFile, lineNo, 'heading-form', 'ATX heading needs a space after the hashes');
    }
    if (/^#{7,}/.test(line)) {
      flag(mdFile, lineNo, 'heading-form', 'heading level deeper than six');
    }

    // Every link target, however deeply bracketed: `[![img](src)](href)`
    // yields both `src` and `href` from the closing-bracket shape alone, so a
    // badge wrapper cannot hide a dead outer link.
    const targets = [...line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]);
    // Reference definitions: `[label]: target`.
    const refDef = /^\s*\[[^\]]+\]:\s*(\S+)/.exec(line);
    if (refDef !== null && refDef[1] !== undefined) targets.push(refDef[1]);
    for (const target of targets) checkTarget(mdFile, target, lineNo);
  });

  if (inFence) {
    flag(mdFile, lines.length, 'unclosed-fence', 'fenced code block is never closed');
  }
}

finish(
  'markdown-check',
  findings,
  `${tracked.length} tracked markdown file(s) (§37.2 stage 2)`,
);
