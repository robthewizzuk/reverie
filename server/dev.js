// The Claude route inside `npm run dev`: POST /api/turn runs server/turn.js in the Vite dev server, with the key
// read from .env.local (or the shell). Nothing here reaches the page's bundle. GET /api/video runs server/video.js.
//
// REVERIE_FAKE=1 answers with a scripted Claude instead (tests/fake.js): no key, no network. The smoke test uses it.
import { Readable } from 'node:stream';
import { handleTurn } from './turn.js';
import { handleVideo } from './video.js';
import { fakeTurn, fakeVideo } from '../tests/fake.js';

export function reverieApi(env) {
  return {
    name: 'reverie-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if ((req.url || '').startsWith('/api/video')) {
          const request = new Request('http://localhost' + req.url);
          const response = env.REVERIE_FAKE === '1' ? fakeVideo(request) : await handleVideo(request, env);
          res.statusCode = response.status; response.headers.forEach((v, k) => res.setHeader(k, v));
          return res.end(await response.text());
        }
        if (!(req.url || '').startsWith('/api/turn')) return next();
        const ac = new AbortController();
        res.on('close', () => { if (!res.writableEnded) ac.abort(); });
        const chunks = []; for await (const c of req) chunks.push(c);
        const request = new Request('http://localhost' + req.url, { method: req.method, headers: { 'content-type': 'application/json' }, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined, signal: ac.signal });
        const response = env.REVERIE_FAKE === '1' ? await fakeTurn(request) : await handleTurn(request, env);
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        if (!response.body) return res.end();
        Readable.fromWeb(response.body).on('error', () => res.end()).pipe(res);
      });
    },
  };
}
