// Boiling a chat down for Reverie's diary: the page posts the lines said since the last recap and what the diary
// already knows (src/memory.js forRecap), and this asks the quick model for a one-line recap plus the facts to add,
// change or drop, as JSON (structured outputs). The page checks everything again before it writes any of it. Runs in
// the dev server and the Worker, like turn.js; the key stays here.
//
//   POST /api/recap  { today, name, lines: [{ who: 'you' | 'me', text }], facts: [{ id, kind, text, when }], talks: [] }
//   -> { recap, add: [{ kind, text, when }], update: [{ id, text, kind, when }], drop: [id], name }
import Anthropic from '@anthropic-ai/sdk';

const KINDS = ['about', 'people', 'plan', 'likes', 'interests', 'routine', 'feeling', 'dislikes'];
const MAX_BODY = 60_000;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const RECAP_SYSTEM = `You keep the diary of Reverie, a small friendly creature who talks with one person, its owner. You read a stretch of their chat and update what Reverie knows about the person, so that Reverie really knows them next time.

Write:
- recap: one short sentence (at most 25 words) of what you talked about and anything that mattered, from Reverie's side ("We played chess and they told me about their new puppy, Pip."). Empty if nothing happened worth keeping.
- add: new facts about the person, each a few words that make sense on their own ("has a sister called Mia", "loves strawberry ice cream", "is learning the guitar", "walks the dog before school", "has a maths test", "felt nervous about the move"). Only what THEY said about themselves, their life, people and pets, likes and dislikes, interests, routines, plans and feelings. Never facts about Reverie, the games or the props, and never guesses. kind is one of: about (who they are: age, job, where they live), people (family, friends, pets), plan (something coming up: give when, as YYYY-MM-DD, counted from today, if they said when), likes, interests (hobbies, things they do or follow), routine (things they do regularly), feeling (how they have been lately), dislikes.
- update: facts already in the diary that changed or that the chat makes clearer (the same id, the new words). A plan that happened becomes what came of it, if they said ("got an A in the maths test", kind about), or is dropped.
- drop: ids of facts that are now wrong, or repeat another fact, or are a plan that is over and nothing came of it.
- name: their first name, only if they said it and the diary doesn't have it.

Keep the diary small and true: merge near-duplicates (update one, drop the other), at most 8 adds. If the chat had nothing about the person, return an empty recap and empty lists. Skip anything they asked to be forgotten or said was private. Nothing that could embarrass them if read aloud.`;

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['recap', 'add', 'update', 'drop', 'name'],
  properties: {
    recap: { type: 'string' },
    add: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'text', 'when'], properties: { kind: { type: 'string', enum: KINDS }, text: { type: 'string' }, when: { type: 'string', description: 'YYYY-MM-DD, or empty' } } } },
    update: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text', 'kind', 'when'], properties: { id: { type: 'string' }, text: { type: 'string' }, kind: { type: 'string', enum: KINDS }, when: { type: 'string' } } } },
    drop: { type: 'array', items: { type: 'string' } },
    name: { type: 'string' },
  },
};

/** Checks what the page sent. Returns an error string, or null. */
export function checkRecap(b) {
  if (!b || typeof b !== 'object') return 'no body';
  if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 80) return 'lines must be a list of 1 to 80';
  if (b.lines.some(l => !l || (l.who !== 'you' && l.who !== 'me') || typeof l.text !== 'string')) return 'each line is { who, text }';
  if (b.facts != null && (!Array.isArray(b.facts) || b.facts.length > 80)) return 'facts must be a list';
  if (typeof b.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.today)) return 'today must be YYYY-MM-DD';
  return null;
}

/** The request for a recap. Exported for the tests. */
export function recapRequest(b, env = {}) {
  const cut = (s, n) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
  const facts = (b.facts || []).map(f => `${cut(f.id, 24)} [${KINDS.includes(f.kind) ? f.kind : 'about'}${f.when ? ', ' + cut(f.when, 10) : ''}] ${cut(f.text, 160)}`).join('\n') || '(none yet)';
  const chat = b.lines.map(l => `${l.who === 'you' ? 'Them' : 'Reverie'}: ${cut(l.text, 300)}`).join('\n');
  const day = new Date(b.today + 'T12:00').toLocaleDateString('en-GB', { weekday: 'long' });
  return {
    model: env.REVERIE_QUICK_MODEL || 'claude-haiku-5-5',
    max_tokens: 4000,
    system: [{ type: 'text', text: RECAP_SYSTEM }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `Today is ${day} ${b.today}. Their name: ${cut(b.name, 40) || 'not known yet'}.\n\nThe diary's facts (id [kind, when] text):\n${facts}\n\n${b.talks?.length ? `Earlier recaps: ${b.talks.map(t => cut(t, 240)).join(' / ')}\n\n` : ''}The chat to recap:\n${chat}` }],
  };
}

/** Handles POST /api/recap. env carries ANTHROPIC_API_KEY. */
export async function handleRecap(request, env = {}) {
  if (request.method !== 'POST') return json(405, { error: 'POST only' });
  if (!env.ANTHROPIC_API_KEY) return json(500, { error: 'ANTHROPIC_API_KEY is not set on the server.' });
  const text = await request.text();
  if (text.length > MAX_BODY) return json(413, { error: 'too long' });
  let body; try { body = JSON.parse(text); } catch { return json(400, { error: 'not JSON' }); }
  const bad = checkRecap(body); if (bad) return json(400, { error: bad });
  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const res = await client.messages.create(recapRequest(body, env));
    if (res.stop_reason === 'refusal') return json(200, { recap: '', add: [], update: [], drop: [], name: '' });
    const out = res.content.find(b => b.type === 'text')?.text || '';
    return json(200, JSON.parse(out));
  } catch (e) {
    return json(e?.status === 429 ? 429 : 502, { error: String(e?.message || e).slice(0, 300) });
  }
}
