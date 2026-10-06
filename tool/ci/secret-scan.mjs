/**
 * §37.2 stage 1 — secret scan over the added lines of the current diff.
 *
 * Two independent surfaces are checked:
 *
 * - **Paths.** A tracked `.env` (anything but the committed templates), a
 *   private key, or a keystores added by the diff is a finding on its own,
 *   whatever the content says.
 * - **Content.** Every line the diff adds is matched against credential-shaped
 *   patterns: key blocks, provider token formats, JWTs, connection strings with
 *   inline passwords, and credential assignments. The pattern set mirrors the
 *   redaction guard in `test-setup.base.ts` (§13.6, §38.28.3) plus the provider
 *   formats that guard never sees because they would not be printed by a test.
 *
 * Placeholders are not findings. A `<...>` value, the named test fixtures, and
 * the committed template conventions are allowed by an explicit, itemised
 * allowlist — never by a rule that skips a whole file or directory, which would
 * turn the scan into decoration.
 *
 * The diff base is `CI_BASE_REF` in CI and `merge-base origin/main` locally
 * (see shared.mjs), so a local run scans exactly the branch a PR would show.
 */

import { git, finish, resolveDiffBase } from './shared.mjs';

const base = resolveDiffBase();

/** Path shapes that are findings when the diff adds them, templates excluded. */
const SECRET_PATH_RULES = [
  {
    rule: 'tracked-env-file',
    test: (path) =>
      /(^|\/)\.env(\.[^/]+)?$/.test(path) &&
      !/(^|\/)\.env\.(example|sample|template)$/.test(path),
  },
  {
    rule: 'private-key-file',
    test: (path) =>
      /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/.test(path) ||
      /\.(pem|p12|pfx|jks|keystore)$/.test(path),
  },
  {
    rule: 'ssh-directory',
    test: (path) => /(^|\/)\.ssh\//.test(path),
  },
];

/**
 * Content patterns. `capture: true` rules pass their first capture group
 * through `allowedValue` before the line becomes a finding.
 *
 * @type {{ name: string, re: RegExp, capture?: boolean }[]}
 */
const SECRET_CONTENT_RULES = [
  { name: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'github-fine-grained-pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: 'npm-token', re: /\bnpm_[A-Za-z0-9]{30,}\b/ },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'slack-webhook', re: /https:\/\/hooks\.slack\.com\/services\// },
  {
    name: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  },
  { name: 'bearer-credential', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/ },
  { name: 'basic-credential', re: /\bBasic\s+[A-Za-z0-9+/]{20,}={0,2}/ },
  {
    name: 'connection-string-password',
    re: /\bpostgres(?:ql)?:\/\/([^\s'"<>]+:[^\s'"<>@]+)@/,
    capture: true,
  },
  {
    name: 'credential-assignment',
    re: /\b(?:password|passwd|secret|api[_-]?key|private[_-]?key|signing[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token)\b\s*(?:[:=])\s*["']([^"']{6,})["']/i,
    capture: true,
  },
  {
    name: 'sql-password-literal',
    re: /\bPASSWORD\s+'([^']{6,})'/i,
    capture: true,
  },
];

/**
 * Values that may look credential-shaped without being a committed secret.
 *
 * Two sources, each allowed by name rather than by a broad rule:
 *
 * - anything using the repository's `<...>` placeholder convention
 *   (`.env.example`, `roles.sql`, M1-S3's secret-manager references);
 * - the exact fixture passwords the predecessor suites already assert on
 *   (`app:old-password`, `app:do-not-log-that`, `hunter2`, …). They cannot be
 *   renamed from this slice (`allowed_paths`), and the stack-to-main PR will
 *   scan them, so they are listed here one value at a time. For a
 *   connection string only the password segment is matched against this set,
 *   so `postgresql://app:<anything-new>@host` still fails.
 *
 * @param {string} value userinfo (`user:pass`), assignment value, or SQL literal
 * @returns {boolean}
 */
const ALLOWED_FIXTURE_VALUES = new Set([
  'pass',
  'password',
  'secret',
  'hunter2',
  'old-password',
  'new-password',
  'do-not-log-this',
  'do-not-log-that',
  'do not serialise me',
]);

function allowedValue(value) {
  if (/<[^>]+>/.test(value)) return true;
  const passwordPart = value.includes(':') ? value.slice(value.indexOf(':') + 1) : value;
  return ALLOWED_FIXTURE_VALUES.has(value) || ALLOWED_FIXTURE_VALUES.has(passwordPart);
}

/** Extracts the first capture group, or the whole match when there is none. */
function matchedValue(match) {
  return match[1] ?? match[0];
}

// --- Path findings ----------------------------------------------------------

const pathResult = git(['diff', '--name-status', base]);
/** @type {{ file: string, line: number, rule: string, detail: string }[]} */
const findings = [];

for (const row of pathResult.split('\n')) {
  if (row.trim() === '') continue;
  const [status, ...paths] = row.split('\t');
  // Renames list old then new; only the new path can introduce a secret file,
  // but a rename *into* a secret path is exactly the shape worth catching.
  const candidate = paths[paths.length - 1];
  if (candidate === undefined || status === undefined) continue;
  for (const rule of SECRET_PATH_RULES) {
    if (rule.test(candidate)) {
      findings.push({
        file: candidate,
        line: 1,
        rule: rule.rule,
        detail: `diff status ${status} adds a path the repository must never track`,
      });
    }
  }
}

// --- Content findings -------------------------------------------------------

const patch = git(['diff', '--unified=0', base]);
let currentFile = '(unknown)';
let newLine = 0;

for (const line of patch.split('\n')) {
  if (line.startsWith('+++ ')) {
    currentFile = line.slice(4).replace(/^b\//, '');
    continue;
  }
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (hunk !== null) {
    newLine = Number(hunk[1]);
    continue;
  }
  if (line.startsWith('@@ ')) continue;
  if (line.startsWith('+') && !line.startsWith('+++')) {
    const text = line.slice(1);
    for (const rule of SECRET_CONTENT_RULES) {
      const match = rule.re.exec(text);
      if (match === null) continue;
      if (rule.capture === true && allowedValue(matchedValue(match))) continue;
      // The matched text is deliberately not printed: a gate that echoes the
      // credential it just found puts the credential in the CI log (§13.6).
      findings.push({
        file: currentFile,
        line: newLine,
        rule: rule.name,
        detail: `added line matches ${rule.name}`,
      });
    }
    newLine += 1;
    continue;
  }
  if (!line.startsWith('-') && !line.startsWith('\\')) {
    newLine += 1;
  }
}

finish(
  'secret-scan',
  findings,
  `diff since ${(base === 'HEAD~1' ? base : base.slice(0, 12))} (§37.2 stage 1)`,
);
