// One turn of Reverie's thinking: the page posts the conversation, this streams Claude's reply back as
// server-sent events. It runs in two places with the same code: inside the Vite dev server (server/dev.js)
// and in the Cloudflare Worker (worker/src/index.js). The API key only ever lives here, read from the
// environment (ANTHROPIC_API_KEY), never in the page.
//
//   POST /api/turn  { tier: 'quick' | 'deep', messages: MessageParam[] }
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
    system: [{ type: 'text', text: SYSTEM + (deep ? '\n\nYou are now thinking harder about this question. Do not call think_harder again; answer it.' : '') }],
    tools: TOOLS.map(t => ({ ...t, eager_input_streaming: true })),
    tool_choice: { type: 'auto' },
    output_config: { effort: deep ? 'medium' : 'low' },
    cache_control: { type: 'ephemeral' },
    messages: body.messages,
  };
  // A declined request is tried again on another model, so the creature is never left silent. Sonnet 5.5 has this on
  // the server; Haiku 5.5 does not (the page answers a refusal itself).
  if (/sonnet-5-5|opus-5|fable/.test(model)) { req.betas = ['server-side-fallback-2026-07-01']; req.fallbacks = 'default'; }
  return req;
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
      stream = req.betas ? client.beta.messages.stream(req, { signal: request.signal }) : client.messages.stream(req, { signal: request.signal });
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
