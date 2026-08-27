/**
 * Build step: stage the catalogue artefacts into public/data.
 *
 * Source order:
 *  1. DATA_DIR env var (CI drops artefacts there)
 *  2. ./data-out (local ingest output)
 *
 * Both public/data and data-out are gitignored: the catalogue never enters
 * the repository (spec 13.2). A missing catalogue is a WARNING, not a build
 * failure: the app renders its unavailable state and the tools answer with a
 * typed catalogue_unavailable error.
 */

import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = process.env.DATA_DIR || path.join(root, 'data-out');
const target = path.join(root, 'public', 'data');

if (!existsSync(path.join(source, 'manifest.json'))) {
  console.warn(`[copy-data] no manifest at ${source}; building without a catalogue`);
  process.exit(0);
}

mkdirSync(target, { recursive: true });
for (const file of readdirSync(source)) {
  if (!file.endsWith('.json')) continue;
  cpSync(path.join(source, file), path.join(target, file));
}
console.log(`[copy-data] staged ${source} -> public/data`);
