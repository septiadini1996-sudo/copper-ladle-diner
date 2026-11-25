// The Copper Ladle — hand-in program (Node 22, standard library only).
//
// The game itself is the static game/ folder beside this file: plain HTML, CSS and ES modules
// that a desktop browser plays fully offline. This program hands the entry in the way the
// grader expects: it copies game/ and screenshots/ into the output directory and writes
// dossier.json there with the vendored make.fun library (vendor/makefun-game.ts, the kit's
// copy, unchanged). Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The caps passed to buildDossier are the scorer's own: at most 4 screenshots of at most
// 256 KiB each, at most 993 files and 48 MiB under game/, no game/ path over 1000 bytes,
// and the dossier's source text capped at 160 KiB.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(out, 'dossier.json'), dossier);
console.log(`dossier.json written: ${dossier.length} bytes`);
