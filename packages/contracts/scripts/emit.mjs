#!/usr/bin/env node
/**
 * Render the committed TS contract module from an OpenAPI document.
 *
 * Kept deliberately thin: parse the document, run the pure emitter, format with
 * the repository's prettier rules resolved against the real committed target path
 * (never against this file's own location), write the bytes. Deterministic
 * output is the whole point — CI compares these bytes with a fresh generation.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const inputPath = arg('in');
const outputPath = arg('out');
const configPath = arg('config');

if (!inputPath || !outputPath || !configPath) {
  process.stderr.write('usage: emit.mjs --in <openapi.json> --out <schemas.ts> --config <real target ts path>\n');
  process.exit(2);
}

const { emit } = require(resolve(here, '../dist/codegen/emit.js'));
const document = JSON.parse(readFileSync(inputPath, 'utf8'));

const source = emit(document);
const loaded = await resolveConfig(configPath);
const formatted = await format(source, { ...(loaded ?? {}), parser: 'typescript' });

writeFileSync(outputPath, formatted);
process.stdout.write(`wrote ${outputPath}\n`);
process.exit(0);