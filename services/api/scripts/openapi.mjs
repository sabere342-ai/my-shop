#!/usr/bin/env node
/**
 * OpenAPI document CLI — Master Plan §7.1 and ADR-001 (slice M1-S6).
 *
 * Emits the OpenAPI document for the real application module graph to `<file>`
 * as pretty-deterministic JSON. The document is generated from NestJS decorators
 * (never maintained by hand), committed at `packages/contracts/openapi.json`,
 * and byte-checked against by the M1-S6 drift gate (G-7, stage 16).
 *
 * Generation is headless: it boots the module graph, opens no port, and depends on
 * no database (the builder removes the database URLs and forces logging silent — see
 * `services/api/src/common/openapi/openapi.ts`). Run `npm run build` first so
 * `dist/` is current.
 *
 * Usage:
 *   node scripts/openapi.mjs --out <file>
 */

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { openapiDocument } = require('../dist/common/openapi/openapi.js');

/** Synchronous so the message always reaches the pipe before `process.exit`. */
function out(message) {
  process.stdout.write(message);
}

/** Synchronous so the failure always reaches the pipe before `process.exit`. */
function fail(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

async function main() {
  const outArg = process.argv.indexOf('--out');
  if (outArg === -1 || process.argv[outArg + 1] === undefined) {
    fail('usage: node scripts/openapi.mjs --out <file>');
    return;
  }

  const outFile = resolve(process.cwd(), process.argv[outArg + 1]);

  try {
    const document = await openapiDocument();
    const json = JSON.stringify(document);
    writeFileSync(outFile, json, 'utf8');
    out(`wrote ${outFile} (${Buffer.byteLength(json)} bytes)\n`);
    process.exit(0);
  } catch (error) {
    fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
  }
}

void main();