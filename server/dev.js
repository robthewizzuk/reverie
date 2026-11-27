// The Claude route inside `npm run dev`: POST /api/turn runs server/turn.js in the Vite dev server, with the key
// read from .env.local (or the shell). Nothing here reaches the page's bundle.
//
// REVERIE_FAKE=1 answers with a scripted Claude instead (tests/fake.js): no key, no network. The smoke test uses it.
// /api/helpers* (Reverie's background helpers, server/helpers.js) runs here too, faked the same way (tests/fake-helpers.js).
import { Readable } from 'node:stream';
import { handleTurn } from './turn.js';
import { fakeTurn } from '../tests/fake.js';
import { handleHelpers } from './helpers.js';
import { fakeHelpers } from '../tests/fake-helpers.js';

export function reverieApi(env) {
  return {
    name: 'reverie-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const helpers = (req.url || '').startsWith('/api/helpers');
        if (!(req.url || '').startsWith('/api/turn') && !helpers) return next();
        const ac = new AbortController();
        res.on('close', () => { if (!res.writableEnded) ac.abort(); });
        const chunks = []; for await (const c of req) chunks.push(c);
        const request = new Request('http://localhost' + req.url, { method: req.method, headers: { 'content-type': 'application/json' }, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined, signal: ac.signal });
        const response = helpers ? (env.REVERIE_FAKE === '1' ? await fakeHelpers(request) : await handleHelpers(request, env))
          : env.REVERIE_FAKE === '1' ? await fakeTurn(request) : await handleTurn(request, env);
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        if (!response.body) return res.end();
        Readable.fromWeb(response.body).on('error', () => res.end()).pipe(res);
      });
    },
  };
}
