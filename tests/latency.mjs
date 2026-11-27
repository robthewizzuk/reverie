// How long Claude takes to start answering a turn, with the real API: the time to the first token, to the first words
// (what the voice waits for) and to the end, for a few everyday things said, in each of a few ways of asking.
// Costs a few pennies (Haiku, short replies). Needs the key: ANTHROPIC_API_KEY in the shell or in .env.local.
//   node tests/latency.mjs [rounds=3]
// Ways compared, each in the same run, one after another (so the service's speed that minute is the same for all):
//   cold      the prompt not in the cache (as the first turn after a long break was before this change)
//   warm      the prompt read from the cache (every turn in full flow, and now the first turn too: /api/warm)
//   no-think  warm, with Haiku's thinking turned off: shows what thinking adds before the first word
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { requestFor, warmRequestFor } from '../server/turn.js';

const env = { ...process.env };
try { for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) { const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(l); if (m && m[2] && !env[m[1]]) env[m[1]] = m[2]; } } catch { /* no file */ }
if (!env.ANTHROPIC_API_KEY) { console.error('No ANTHROPIC_API_KEY (shell or .env.local).'); process.exit(1); }
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const rounds = +process.argv[2] || 3;
const SAID = ['hi! how are you today?', 'can you make me a red dragon?', "what's the capital of Peru?", 'tell me a joke about cats', 'paint the walls light blue'];
const line = t => `[From the device, not said aloud: it is Friday afternoon where they are]\n${t}`;

async function time(req) {
  const t0 = performance.now(); let first = null, text = null;
  const stream = client.beta.messages.stream(req);
  for await (const ev of stream) {
    if (ev.type === 'message_start') continue;
    first ??= performance.now() - t0;
    if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') { text ??= performance.now() - t0; }
  }
  const m = await stream.finalMessage();
  return { first, text, end: performance.now() - t0, read: m.usage.cache_read_input_tokens || 0, wrote: m.usage.cache_creation_input_tokens || 0, out: m.usage.output_tokens, thought: m.content.some(b => b.type === 'thinking') };
}

const ways = {
  // (a different first line of the system prompt each time: nothing to read from the cache)
  cold: said => { const r = requestFor({ tier: 'quick', messages: [{ role: 'user', content: line(said) }] }, env); r.system = [{ ...r.system[0], text: `(${Math.random()})\n` + r.system[0].text }]; return r; },
  warm: said => requestFor({ tier: 'quick', messages: [{ role: 'user', content: line(said) }] }, env),
  'no-think': said => { const r = requestFor({ tier: 'quick', messages: [{ role: 'user', content: line(said) }] }, env); r.thinking = { type: 'disabled' }; r.betas = r.betas.filter(b => !/thinking-binding/.test(b)); return r; },
};

const w0 = performance.now();
const warmed = await client.beta.messages.create(warmRequestFor(env));
console.log(`warm-up: ${Math.round(performance.now() - w0)} ms, ${warmed.usage.cache_creation_input_tokens || 0} written, ${warmed.usage.cache_read_input_tokens || 0} read`);
const all = Object.fromEntries(Object.keys(ways).map(k => [k, []]));
for (let r = 0; r < rounds; r++) for (const said of SAID) for (const [k, f] of Object.entries(ways)) {
  try { all[k].push(await time(f(said))); } catch (e) { console.warn(`${k}: ${e.message}`); }
}
const med = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); return s.length ? Math.round(s[Math.floor(s.length / 2)]) : '–'; };
const p90 = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * .9))]) : '–'; };
console.log(`\n${rounds * SAID.length} turns each (median / slowest 1 in 10, ms):`);
console.log('way        first token    first words    whole reply    cached read   thought');
for (const [k, xs] of Object.entries(all)) console.log(`${k.padEnd(10)} ${String(med(xs.map(x => x.first))).padStart(5)} / ${String(p90(xs.map(x => x.first))).padEnd(6)} ${String(med(xs.map(x => x.text))).padStart(5)} / ${String(p90(xs.map(x => x.text))).padEnd(6)} ${String(med(xs.map(x => x.end))).padStart(5)} / ${String(p90(xs.map(x => x.end))).padEnd(6)} ${String(med(xs.map(x => x.read))).padStart(8)}      ${xs.filter(x => x.thought).length}/${xs.length}`);
