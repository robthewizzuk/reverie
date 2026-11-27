// Reverie's backend on Cloudflare: POST /api/turn streams Claude's reply (and POST /api/warm reads the prompt into the cache) (server/turn.js, the same code the dev
// server runs), POST /api/recap boils a chat down for the diary (server/recap.js), POST /api/shop sends a shopping
// helper to compare prices (server/shop.js), and /api/push wakes a closed page for its reminders (pusher.js: times
// only, never the words). The key is a Worker secret: `npx wrangler secret put ANTHROPIC_API_KEY` (never in this repo).
// GET /api/video gives a YouTube video's title and captions for watching it together (server/video.js).
// The page itself is served from dist/ as static assets (wrangler.toml [assets]); only /api/* reaches this code.
// /api/google/* is Gmail and Google Calendar (server/google.js): Google sign-in with the client secret as a Worker secret
// (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET), the tokens kept encrypted in the person's own cookie, never stored here.
// Only the Worker's own address (and ALLOWED_ORIGIN, if set; '*' allows any) may call the API, so other sites can't spend the key.
import { handleTurn, handleWarm } from '../../server/turn.js';
import { handleShop } from '../../server/shop.js';
import { handleRecap } from '../../server/recap.js';
import { handleHelpers } from '../../server/helpers.js';
import { handleGoogle } from '../../server/google.js';
import { handlePush, Pusher } from './pusher.js';

export { Pusher };
import { handleVideo } from '../../server/video.js';

const cors = env => ({
  'access-control-allow-origin': env.ALLOWED_ORIGIN || '',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  vary: 'origin',
});

// a video's captions are the same for everyone: kept a day in Cloudflare's cache, so YouTube is asked once
async function videoCached(request, env, url) {
  const cache = typeof caches !== 'undefined' && !url.searchParams.has('q') ? caches.default : null;
  const key = cache && new Request(url.toString(), { method: 'GET' });
  const hit = key && await cache.match(key).catch(() => null);
  if (hit) return hit;
  const res = await handleVideo(request, env);
  if (key && res.ok && /max-age=[1-9]/.test(res.headers.get('cache-control') || '')) await cache.put(key, res.clone()).catch(() => {});
  return res;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isGoogle = url.pathname.startsWith('/api/google/');
    const helpers = /^\/api\/helpers(\/(stop|more))?\/?$/.test(url.pathname);   // (Reverie's background helpers: server/helpers.js)
    if (!isGoogle && url.pathname !== '/api/turn' && url.pathname !== '/api/warm' && url.pathname !== '/api/push' && url.pathname !== '/api/recap' && url.pathname !== '/api/shop' && url.pathname !== '/api/video' && !helpers) return new Response('Not found', { status: 404 });
    const origin = request.headers.get('origin');
    const allowed = env.ALLOWED_ORIGIN === '*' || origin === url.origin || origin === env.ALLOWED_ORIGIN;
    if (origin && !allowed) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    const res = isGoogle ? (await handleGoogle(request, env) ?? new Response('Not found', { status: 404 }))
      : url.pathname === '/api/video' ? await videoCached(request, env, url)
      : helpers ? await handleHelpers(request, env)
      : url.pathname === '/api/push' ? await handlePush(request, env)
      : url.pathname === '/api/shop' ? await handleShop(request, env)
      : url.pathname === '/api/recap' ? await handleRecap(request, env)
      : url.pathname === '/api/warm' ? await handleWarm(request, env)
      : await handleTurn(request, env);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors(env))) if (v) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  },
};
