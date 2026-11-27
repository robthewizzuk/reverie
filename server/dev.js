// The Claude routes inside `npm run dev`: POST /api/turn runs server/turn.js (and /api/recap server/recap.js) in the Vite dev server, with the key
// read from .env.local (or the shell). /api/google/* runs server/google.js the same way (Gmail and the calendar, with
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from .env.local). Nothing here reaches the page's bundle.
//
// REVERIE_FAKE=1 answers with a scripted Claude instead (tests/fake.js): no key, no network. The smoke test uses it.
// /api/helpers* (Reverie's background helpers, server/helpers.js) runs here too, faked the same way (tests/fake-helpers.js).
// With no Google client set, it also signs in to a pretend Google (tests/fake-google.js), with a calendar and an inbox.
import { Readable } from 'node:stream';
import { handleTurn, handleWarm } from './turn.js';
import { handleRecap } from './recap.js';
import { handleGoogle } from './google.js';
import { fakeTurn, fakeRecap, fakeShop } from '../tests/fake.js';
import { fakeGoogle } from '../tests/fake-google.js';
import { handleHelpers } from './helpers.js';
import { fakeHelpers } from '../tests/fake-helpers.js';
import { handleShop } from './shop.js';

export function reverieApi(env) {
  const fake = env.REVERIE_FAKE === '1' && !env.GOOGLE_CLIENT_ID ? fakeGoogle() : null;
  const googleEnv = fake ? { ...env, GOOGLE_CLIENT_ID: 'fake', GOOGLE_CLIENT_SECRET: 'fake-secret' } : env;
  return {
    name: 'reverie-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // (push for reminders runs on the Worker only: here the page keeps them while it is open)
        if ((req.url || '').startsWith('/api/push')) { res.statusCode = 404; res.setHeader('content-type', 'application/json'); return res.end('{"error":"push runs on the Worker only"}'); }
        const path = req.url || '', google = path.startsWith('/api/google/');
        const warm = path.startsWith('/api/warm'), recap = path.startsWith('/api/recap'), helpers = path.startsWith('/api/helpers'), shop = path.startsWith('/api/shop');
        if (!path.startsWith('/api/turn') && !google && !warm && !helpers && !recap && !shop) return next();
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
          : warm ? (env.REVERIE_FAKE === '1' ? Response.json({ ok: true, fake: true }) : await handleWarm(request, env))
          : helpers ? (env.REVERIE_FAKE === '1' ? await fakeHelpers(request) : await handleHelpers(request, env))
          : shop ? (env.REVERIE_FAKE === '1' ? await fakeShop(request) : await handleShop(request, env))
          : recap ? (env.REVERIE_FAKE === '1' ? await fakeRecap(request) : await handleRecap(request, env))
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
