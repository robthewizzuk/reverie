// The Claude routes inside `npm run dev`: POST /api/turn runs server/turn.js (and /api/recap server/recap.js) in the Vite dev server, with the key
// read from .env.local (or the shell). Nothing here reaches the page's bundle.
//
// REVERIE_FAKE=1 answers with a scripted Claude instead (tests/fake.js): no key, no network. The smoke test uses it.
import { Readable } from 'node:stream';
import { handleTurn } from './turn.js';
import { handleRecap } from './recap.js';
import { fakeTurn, fakeRecap } from '../tests/fake.js';

export function reverieApi(env) {
  return {
    name: 'reverie-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const recap = (req.url || '').startsWith('/api/recap');
        if (!recap && !(req.url || '').startsWith('/api/turn')) return next();
        const ac = new AbortController();
        res.on('close', () => { if (!res.writableEnded) ac.abort(); });
        const chunks = []; for await (const c of req) chunks.push(c);
        const request = new Request('http://localhost' + req.url, { method: req.method, headers: { 'content-type': 'application/json' }, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined, signal: ac.signal });
        const response = env.REVERIE_FAKE === '1' ? await (recap ? fakeRecap : fakeTurn)(request) : await (recap ? handleRecap : handleTurn)(request, env);
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        if (!response.body) return res.end();
        Readable.fromWeb(response.body).on('error', () => res.end()).pipe(res);
      });
    },
  };
}
