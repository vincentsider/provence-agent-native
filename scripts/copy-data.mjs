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

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = process.env.DATA_DIR || path.join(root, 'data-out');
const target = path.join(root, 'public', 'data');

if (!existsSync(path.join(source, 'manifest.json'))) {
  console.warn(`[copy-data] no manifest at ${source}; building without a catalogue`);
  process.exit(0);
}

// Stage ONLY what the manifest references, into a clean target: stale
// content-hashed artefacts from earlier builds must never ship.
import('node:fs').then(({ rmSync, readFileSync }) => {
  const manifest = JSON.parse(readFileSync(path.join(source, 'manifest.json'), 'utf-8'));
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const file of ['manifest.json', manifest.files.catalog, manifest.files.vocab]) {
    cpSync(path.join(source, file), path.join(target, file));
  }
  console.log(`[copy-data] staged ${manifest.files.catalog} + ${manifest.files.vocab} -> public/data`);
});
