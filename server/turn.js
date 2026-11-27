// One turn of Reverie's thinking: the page posts the conversation, this streams Claude's reply back as
// server-sent events. It runs in two places with the same code: inside the Vite dev server (server/dev.js)
// and in the Cloudflare Worker (worker/src/index.js). The API key only ever lives here, read from the
// environment (ANTHROPIC_API_KEY), never in the page.
//
//   POST /api/turn  { tier: 'quick' | 'deep', messages: MessageParam[] }
//   POST /api/warm  (no body): reads the system prompt and tools into the API's cache while the page wakes, so the first
//                   turn reads them instead of paying for them in its wait. -> { ok, ms } or { error }
//   -> text/event-stream: each Claude stream event as `data: {...}`, then `data: {"type":"final","message":{...}}`
//      (the whole reply, thinking blocks included, for the page to keep in its history), or `{"type":"error"}`.
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM, TOOLS } from './persona.js';

// Which model answers. Everyday chat goes to the quick one; a hard question is handed to the deep one
// (the creature calls think_harder). Both can be changed without touching code.
const MODELS = env => ({
  quick: env.REVERIE_QUICK_MODEL || 'claude-haiku-5-5',
  deep: env.REVERIE_DEEP_MODEL || 'claude-sonnet-5-5',
});
const MAX_MESSAGES = 80;          // a long chat keeps its last 80 turns (the page trims too)
const MAX_BODY = 400_000;         // bytes

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Checks what the page sent: roles, content shapes and size. Returns an error string, or null. */
export function checkTurn(body) {
  if (!body || typeof body !== 'object') return 'no body';
  if (body.tier !== 'quick' && body.tier !== 'deep') return 'tier must be quick or deep';
  const m = body.messages;
  if (!Array.isArray(m) || !m.length || m.length > MAX_MESSAGES) return 'messages must be a list of 1 to ' + MAX_MESSAGES;
  for (const x of m) {
    if (!x || (x.role !== 'user' && x.role !== 'assistant')) return 'each message is user or assistant';
    if (typeof x.content !== 'string' && !Array.isArray(x.content)) return 'content must be text or blocks';
  }
  if (m[0].role !== 'user') return 'the first message is the user\'s';
  return null;
}

/** The request for this turn. Exported for the tests. */
export function requestFor(body, env = {}) {
  const models = MODELS(env), deep = body.tier === 'deep', model = deep ? models.deep : models.quick;
  const req = {
    model,
    max_tokens: 4000,
    // The same system prompt and tools for both models, always: Claude's thinking blocks are bound to everything
    // before them, so a prompt that changed with the model would make the quick model's thinking invalid when the deep
    // one reads it (a 400). The "answer now" note for the deep model rides in think_harder's result instead.
    // The tools and the system prompt are the same on every turn, every chat and both models' turns: cached for an hour
    // (a cache read keeps it alive), so a chat picked up after a cup of tea starts as fast as one in full flow. The
    // conversation after them is cached by the top-level marker below, for 5 minutes (a 1-hour part must come first).
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral', ttl: '1h' } }],
    tools: TOOLS.map(t => ({ ...t, eager_input_streaming: true })),
    tool_choice: { type: 'auto' },
    output_config: { effort: deep ? 'medium' : 'low' },
    // If the history before a thinking block ever does change (the page drops old turns in a long chat), that block is
    // left out of the request rather than failing it.
    thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
    betas: ['thinking-binding-controls-2026-08-01'],
    cache_control: { type: 'ephemeral' },
    messages: body.messages,
  };
  // A declined request is tried again on another model, so the creature is never left silent. Sonnet 5.5 has this on
  // the server; Haiku 5.5 does not (the page answers a refusal itself).
  if (/sonnet-5-5|opus-5|fable/.test(model)) { req.betas.push('server-side-fallback-2026-07-01'); req.fallbacks = 'default'; }
  return req;
}

// When this server last warmed the cache (one warm an hour per running server is plenty: it lives an hour, and turns keep it alive)
let warmedAt = 0;
const WARM_EVERY = 50 * 60e3;

/** The warm-up request: the quick model's turn, with a stand-in message and max_tokens 0 (the prompt is read and
 * cached, nothing is written or billed as output). Exported for the tests. */
export function warmRequestFor(env = {}) {
  const req = requestFor({ tier: 'quick', messages: [{ role: 'user', content: 'warm up' }] }, env);
  delete req.cache_control;   // (the cache is keyed at the end of the system prompt, not at the stand-in message)
  return { ...req, max_tokens: 0 };
}

/** Handles POST /api/warm. */
export async function handleWarm(request, env = {}) {
  if (request.method !== 'POST') return json(405, { error: 'POST only' });
  if (!env.ANTHROPIC_API_KEY) return json(500, { error: 'ANTHROPIC_API_KEY is not set on the server.' });
  if (Date.now() - warmedAt < WARM_EVERY) return json(200, { ok: true, skipped: true });
  warmedAt = Date.now();
  const t0 = Date.now();
  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0 });
    const m = await client.beta.messages.create(warmRequestFor(env));
    return json(200, { ok: true, ms: Date.now() - t0, written: m.usage?.cache_creation_input_tokens ?? null, read: m.usage?.cache_read_input_tokens ?? null });
  } catch (e) {
    warmedAt = 0;
    return json(200, { ok: false, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 200) });
  }
}

/** Handles POST /api/turn. env carries ANTHROPIC_API_KEY (and the optional model names). */
export async function handleTurn(request, env = {}) {
  if (request.method !== 'POST') return json(405, { error: 'POST only' });
  if (!env.ANTHROPIC_API_KEY) return json(500, { error: 'ANTHROPIC_API_KEY is not set on the server. Put it in .env.local (see .env.example).' });
  const text = await request.text();
  if (text.length > MAX_BODY) return json(413, { error: 'too long' });
  let body; try { body = JSON.parse(text); } catch { return json(400, { error: 'not JSON' }); }
  const bad = checkTurn(body); if (bad) return json(400, { error: bad });

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const req = requestFor(body, env);
  const enc = new TextEncoder();
  const out = new TransformStream();
  const w = out.writable.getWriter();
  const send = obj => w.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

  (async () => {
    const t0 = Date.now();
    let stream;
    try {
      stream = client.beta.messages.stream(req, { signal: request.signal });
      for await (const event of stream) await send(event);
      const message = await stream.finalMessage();
      await send({ type: 'final', message, ms: Date.now() - t0 });
    } catch (e) {
      // (the page went away: nothing to tell)
      if (request.signal?.aborted) { try { stream?.abort(); } catch {} }
      else await send({ type: 'error', status: e?.status ?? null, error: String(e?.message || e).slice(0, 300) }).catch(() => {});
    } finally { await w.close().catch(() => {}); }
  })();

  return new Response(out.readable, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}
