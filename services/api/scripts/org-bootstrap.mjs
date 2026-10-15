#!/usr/bin/env node
/**
 * §10.4 operator command shim — Master Plan §40.6, slice M2-S1.
 *
 * `npm run bootstrap:org -- --bootstrap-key <key> --name <name> --owner-email <email>`
 *
 * Everything meaningful lives in `src/common/tenancy/bootstrap-cli.ts`, which
 * is compiled to `dist/` and is what the acceptance suite drives directly. This
 * file has one job: load the built module, forward `process.argv` and the
 * environment, and exit with the code the command decided.
 *
 * It is deliberately trivial. A shim that parsed arguments too would be a
 * second, divergent implementation of the same contract — and the contract
 * (exit codes 0/1/2/3, one JSON line, no credential ever printed) is exactly
 * what the suites assert on the real implementation.
 *
 * `npm run bootstrap:org` runs `prebootstrap:org` first, which builds the API,
 * so the `dist` copy is never stale in the supported workflow.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const apiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cliPath = path.join(apiRoot, 'dist', 'common', 'tenancy', 'bootstrap-cli.js');

/** @type {import('../dist/common/tenancy/bootstrap-cli.js')} */
let cli;
try {
  const loaded = await import(pathToFileURL(cliPath).href);
  // A CommonJS build reaches an ESM importer either as named bindings (the
  // lexer sees the assignments) or under `default`; accept both rather than
  // depend on one interop detail of the current Node version.
  cli = loaded.runBootstrapCli === undefined ? loaded.default : loaded;
} catch (error) {
  process.stderr.write(
    `the API is not built (${error.code ?? 'load failed'}); run "npm run build" first — ` +
      `"npm run bootstrap:org" does it automatically through prebootstrap:org\n`,
  );
  process.exit(2);
}

if (typeof cli?.runBootstrapCli !== 'function') {
  process.stderr.write('the built bootstrap command is missing its entry point; run "npm run build"\n');
  process.exit(2);
}

const code = await cli.runBootstrapCli(process.argv.slice(2), process.env, {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});

process.exit(code);
