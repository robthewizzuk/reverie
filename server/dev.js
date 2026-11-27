// The Claude route inside `npm run dev`: POST /api/turn runs server/turn.js in the Vite dev server, with the key
// read from .env.local (or the shell). /api/google/* runs server/google.js the same way (Gmail and the calendar, with
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from .env.local). Nothing here reaches the page's bundle.
//
// REVERIE_FAKE=1 answers with a scripted Claude instead (tests/fake.js): no key, no network. The smoke test uses it.
// With no Google client set, it also signs in to a pretend Google (tests/fake-google.js), with a calendar and an inbox.
import { Readable } from 'node:stream';
import { handleTurn } from './turn.js';
import { handleGoogle } from './google.js';
import { fakeTurn } from '../tests/fake.js';
import { fakeGoogle } from '../tests/fake-google.js';

export function reverieApi(env) {
  const fake = env.REVERIE_FAKE === '1' && !env.GOOGLE_CLIENT_ID ? fakeGoogle() : null;
  const googleEnv = fake ? { ...env, GOOGLE_CLIENT_ID: 'fake', GOOGLE_CLIENT_SECRET: 'fake-secret' } : env;
  return {
    name: 'reverie-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url || '', google = path.startsWith('/api/google/');
        if (!path.startsWith('/api/turn') && !google) return next();
        const ac = new AbortController();
        res.on('close', () => { if (!res.writableEnded) ac.abort(); });
        const chunks = []; for await (const c of req) chunks.push(c);
        // (the address as the browser sees it, so Google's sign-in comes back to this port; and its cookies and origin)
        const headers = { 'content-type': 'application/json' };
        for (const k of ['cookie', 'origin']) if (req.headers[k]) headers[k] = req.headers[k];
        const request = new Request(`http://${req.headers.host || 'localhost'}${path}`, { method: req.method, headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined, signal: ac.signal });
        // (the pretend Google's consent page says yes at once)
        const consent = fake && new URL(request.url).pathname === '/api/google/fake_consent', q = new URL(request.url).searchParams;
        const response = consent ? new Response(null, { status: 302, headers: { location: `${q.get('redirect_uri')}?code=fake-code&state=${q.get('state')}` } })
          : google ? await handleGoogle(request, googleEnv, fake ? { fetch: fake.fetch, authUrl: `http://${req.headers.host}/api/google/fake_consent` } : {}) ?? new Response('Not found', { status: 404 })
          : env.REVERIE_FAKE === '1' ? await fakeTurn(request) : await handleTurn(request, env);
        res.statusCode = response.status;
        response.headers.forEach((v, k) => { if (k !== 'set-cookie') res.setHeader(k, v); });
        const cookies = response.headers.getSetCookie?.() || [];
        if (cookies.length) res.setHeader('set-cookie', cookies);
        if (!response.body) return res.end();
        Readable.fromWeb(response.body).on('error', () => res.end()).pipe(res);
      });
    },
  };
}
