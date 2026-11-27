// Reverie's backend on Cloudflare: POST /api/turn streams Claude's reply (and POST /api/warm reads the prompt into the cache) (server/turn.js, the same code the dev
// server runs). The key is a Worker secret: `npx wrangler secret put ANTHROPIC_API_KEY` (never in this repo).
// The page itself is served from dist/ as static assets (wrangler.toml [assets]); only /api/* reaches this code.
// Only the Worker's own address (and ALLOWED_ORIGIN, if set; '*' allows any) may call the API, so other sites can't spend the key.
import { handleTurn, handleWarm } from '../../server/turn.js';

const cors = env => ({
  'access-control-allow-origin': env.ALLOWED_ORIGIN || '',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  vary: 'origin',
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/turn' && url.pathname !== '/api/warm') return new Response('Not found', { status: 404 });
    const origin = request.headers.get('origin');
    const allowed = env.ALLOWED_ORIGIN === '*' || origin === url.origin || origin === env.ALLOWED_ORIGIN;
    if (origin && !allowed) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    const res = url.pathname === '/api/warm' ? await handleWarm(request, env) : await handleTurn(request, env);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors(env))) if (v) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  },
};
