// Reverie's page, built on the Game Scroll engine (the engine/ submodule). The engine's own Vite plugins are
// borrowed for what its kits need (trees drawn in code, the physics engine's .wasm files); the Claude route
// (server/dev.js) runs in the dev server only, with the key read from .env.local or the shell.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { rapierWasmFiles } from './engine/vite.config.js';
import { reverieApi } from './server/dev.js';

// Server-side settings (ANTHROPIC_API_KEY, REVERIE_*): from .env.local, then the shell. Never given to the page:
// only VITE_ names reach the bundle, and none of these is one.
function serverEnv() {
  const env = {};
  for (const f of ['.env', '.env.local']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !m[1].startsWith('VITE_')) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  for (const k of ['ANTHROPIC_API_KEY', 'REVERIE_QUICK_MODEL', 'REVERIE_DEEP_MODEL', 'REVERIE_FAKE', 'REVERIE_FAKE_HELPER_MS', 'REVERIE_HELPER_AGENT_ID', 'REVERIE_HELPER_ENV_ID']) if (process.env[k]) env[k] = process.env[k];
  return env;
}

// The engine's tree kit (EZ-Tree) from its source, with its picture files swapped for the engine's own drawn in code
// (as engine/vite.config.js ezTreeInCode does, with the engine's paths).
function ezTreeInCode() {
  const lib = resolve('engine/node_modules/@dgreenheck/ez-tree/src/lib');
  return {
    name: 'ez-tree-in-code', enforce: 'pre',
    resolveId(id, importer) {
      if (id === 'ez-tree/lib') return resolve(lib, 'index.js');
      if (importer && importer.replace(/\\/g, '/').includes('@dgreenheck/ez-tree/src/lib') && /(^|\/)textures(\.js)?$/.test(id)) return resolve('engine/src/kit/models/tree-textures.js');
      return null;
    },
  };
}

// The engine downloads its voice (Phonon, about 48 MB once) and listening models from the Game Scroll games host.
process.env.VITE_GAMES_URL ??= 'https://assets.game-scroll.com';

export default {
  base: './',
  plugins: [ezTreeInCode(), rapierWasmFiles(), reverieApi(serverEnv())],
  server: { fs: { allow: ['.'] } },
  build: { target: 'es2022' },
  worker: { format: 'es' },
};
