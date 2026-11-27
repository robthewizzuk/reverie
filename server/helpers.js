// The helpers' backend: start a helper, see how each is getting on, send one a follow-up, stop one. Each helper is a
// Claude Managed Agents session on the one helper agent (server/helper-agent.js; made by scripts/helpers-sync.mjs, which
// a deploy runs). Anthropic runs the session, so nothing here waits for a helper to finish:
// the page asks now and then how they are doing (GET), and the Worker keeps no state of its own. The key stays here.
//
//   POST /api/helpers        { name, task, context? }  -> { id, name, status }   (refused past the limits below)
//   GET  /api/helpers?ids=a,b                          -> { helpers: [{ id, status, doing, steps, sources, result, cost, error }] }
//   POST /api/helpers/more   { id, words }             -> { id, status }   (a follow-up for a finished helper)
//   POST /api/helpers/stop   { id }                    -> { id, status: 'stopped' }
//
// status: 'working', 'done', 'out_of_budget' (it hit its spend cap: result is what it had), or 'failed'.
import Anthropic from '@anthropic-ai/sdk';
import { HELPER_APP } from './helper-agent.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const num = (v, d) => Number.isFinite(+v) && +v > 0 ? +v : d;

/** The limits, from the env (all optional). A helper's budget is a hard cap Anthropic enforces on its session. */
export const limitsOf = env => ({
  running: num(env.REVERIE_HELPERS_AT_ONCE, 3),          // helpers working at the same time
  perDay: num(env.REVERIE_HELPERS_PER_DAY, 30),          // helpers started in any 24 hours
  budgetCents: num(env.REVERIE_HELPER_BUDGET_CENTS, 100), // the most one helper may spend, in US cents ($1.00)
});

const ID = /^sesn_[A-Za-z0-9]{8,64}$/;
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const textOf = content => (Array.isArray(content) ? content : []).filter(b => b?.type === 'text').map(b => b.text).join('\n').trim();

/** What a helper is up to, in a few words, from one of its events. Exported for the tests. */
export function doingOf(ev) {
  if (!ev) return 'getting started';
  if (ev.type === 'agent.tool_use') {
    const i = ev.input || {};
    if (ev.name === 'web_search') return `searching for "${clip(i.query, 60)}"`;
    if (ev.name === 'web_fetch') return `reading ${host(i.url) || 'a web page'}`;
    if (ev.name === 'bash') return 'working something out';
    if (ev.name === 'write' || ev.name === 'edit') return 'jotting down notes';
    return 'looking through its notes';
  }
  if (ev.type === 'agent.message') return 'writing up what it found';
  if (ev.type === 'session.status_rescheduled') return 'getting going again';
  return 'thinking it over';
}

/** How a helper stands, from its session and its latest events (newest first). Exported for the tests. */
export function summarise(session, newest) {
  // what it did since the last thing it was asked (its task, or a follow-up)
  const since = [];
  for (const ev of newest) { if (ev.type === 'user.message') break; since.push(ev); }
  const steps = since.filter(e => e.type === 'agent.tool_use');
  const sources = [...new Set(steps.filter(e => e.name === 'web_fetch').map(e => host(e.input?.url)).filter(Boolean))].slice(0, 6);
  const result = since.filter(e => e.type === 'agent.message').reverse().map(e => textOf(e.content)).filter(Boolean).join('\n\n').slice(0, 6000);
  const idle = since.find(e => e.type === 'session.status_idle'), err = since.find(e => e.type === 'session.error');
  const latest = since.find(e => e.type === 'agent.tool_use' || e.type === 'agent.message' || e.type === 'agent.thinking' || e.type === 'span.model_request_start' || e.type === 'session.status_rescheduled');
  const cents = +session?.usage?.list_cost?.amount || 0;
  const out = { id: session.id, status: 'working', doing: doingOf(latest), steps: steps.length, sources, result, cost: cents / 100, error: null, waiting: [] };
  const st = session.status;
  if (st === 'terminated') { out.status = result ? 'done' : 'failed'; out.error = result ? null : clip(err?.error?.message || err?.message || 'it stopped before it finished', 160); }
  else if (st === 'idle') {
    const why = idle?.stop_reason?.type;
    if (why === 'requires_action') out.waiting = idle.stop_reason.event_ids || [];   // (a tool call paused for approval)
    else if (why === 'budget_reached') { out.status = 'out_of_budget'; out.doing = 'ran out of budget'; }
    else if (result) { out.status = 'done'; out.doing = 'finished'; }
    else if (err || idle) { out.status = 'failed'; out.error = why === 'refusal' ? 'it declined that one' : clip(err?.error?.message || err?.message || 'it stopped without a report', 160); }
    // (idle with no idle event yet: the task is still queued)
  }
  return out;
}

function clientOf(env) {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

// The helper agent and its environment: their ids come from the env (the deploy sets them), or else are looked up once
// by the metadata scripts/helpers-sync.mjs gave them (a deploy by hand drops the env's ids). Never created here.
let found = null;
async function idsOf(client, env) {
  if (env.REVERIE_HELPER_AGENT_ID && env.REVERIE_HELPER_ENV_ID) return { agent: env.REVERIE_HELPER_AGENT_ID, environment: env.REVERIE_HELPER_ENV_ID };
  if (found) return found;
  const mine = x => x?.metadata?.app === HELPER_APP && !x.archived_at;
  let agent = null, environment = null;
  for await (const a of client.beta.agents.list({ limit: 100 })) if (mine(a)) { agent = a.id; break; }
  for await (const e of client.beta.environments.list({ limit: 100 })) if (mine(e)) { environment = e.id; break; }
  if (agent && environment) found = { agent, environment };
  return found;
}

async function count(client, params, most) {
  let n = 0;
  for await (const _ of client.beta.sessions.list({ ...params, limit: Math.min(100, most + 1) })) if (++n > most) break;
  return n;
}

/** One helper's session, only if it is one of ours (the page can't read other sessions on the account). */
async function ours(client, ids, id) {
  if (!ID.test(id)) return null;
  const s = await client.beta.sessions.retrieve(id).catch(e => { if (e?.status === 404) return null; throw e; });
  const agentId = typeof s?.agent === 'string' ? s.agent : s?.agent?.id;
  return s && agentId === ids.agent ? s : null;
}

async function status(client, ids, id) {
  const s = await ours(client, ids, id);
  if (!s) return { id, status: 'failed', error: 'this helper is gone', doing: '', steps: 0, sources: [], result: '', cost: 0 };
  const page = await client.beta.sessions.events.list(id, { order: 'desc', limit: 60 });
  let out = summarise(s, page.data || []);
  // Nobody is watching a helper to approve a call the server could not decide on, so it is told no and finds another way.
  if (out.waiting.length) {
    await client.beta.sessions.events.send(id, { events: out.waiting.map(e => ({ type: 'user.tool_confirmation', tool_use_id: e, result: 'deny', deny_message: 'Nobody is here to approve that. Find another way, or say in your report that you could not.' })) }).catch(() => {});
  }
  delete out.waiting;
  return out;
}

async function start(client, env, ids, body) {
  const name = clip(body.name, 24) || 'Helper', task = clip(body.task, 3000), context = clip(body.context, 600);
  if (task.length < 8) return json(400, { error: 'say what the helper should do' });
  const lim = limitsOf(env), agent = ids.agent;
  // the limits, counted from the sessions themselves (the Worker keeps nothing)
  if (await count(client, { agent_id: agent, statuses: ['running', 'rescheduling'] }, lim.running) >= lim.running)
    return json(429, { error: `${lim.running} helpers are already working; wait for one to finish`, limit: 'running' });
  if (await count(client, { agent_id: agent, 'created_at[gte]': new Date(Date.now() - 864e5).toISOString() }, lim.perDay) >= lim.perDay)
    return json(429, { error: `that's ${lim.perDay} helpers today already; more tomorrow`, limit: 'day' });
  const text = `Reverie sent you, a helper called ${name}, to do this for the person it is talking with:\n\n${task}` + (context ? `\n\nWhat Reverie knows about where and when they are: ${context}` : '');
  const s = await client.beta.sessions.create({
    agent, environment_id: ids.environment, title: `${name}: ${clip(task, 80)}`,
    budget: { type: 'limit', max_list_cost: { amount: String(Math.round(lim.budgetCents)), currency: 'USD' } },
    metadata: { app: 'reverie', helper: name },
    initial_events: [{ type: 'user.message', content: [{ type: 'text', text }] }],
  });
  return json(200, { id: s.id, name, status: 'working' });
}

/** Handles /api/helpers*. env carries ANTHROPIC_API_KEY, and REVERIE_HELPER_AGENT_ID and REVERIE_HELPER_ENV_ID (optional). */
export async function handleHelpers(request, env = {}, client = null) {
  if (!env.ANTHROPIC_API_KEY) return json(500, { error: 'ANTHROPIC_API_KEY is not set on the server.' });
  client ||= clientOf(env);
  const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '');
  try {
    const ids = await idsOf(client, env);
    if (!ids) return json(503, { error: 'helpers are not set up yet: run npm run helpers:sync (see the README)', setup: true });
    if (request.method === 'GET' && path === '/api/helpers') {
      const want = (url.searchParams.get('ids') || '').split(',').filter(Boolean).slice(0, 8);
      return json(200, { helpers: await Promise.all(want.map(id => status(client, ids, id).catch(e => ({ id, status: 'unknown', error: clip(e?.message, 120) })))) });
    }
    if (request.method !== 'POST') return json(405, { error: 'GET or POST' });
    const text = await request.text();
    if (text.length > 20000) return json(413, { error: 'too long' });
    let body; try { body = JSON.parse(text || '{}'); } catch { return json(400, { error: 'not JSON' }); }
    if (path === '/api/helpers') return await start(client, env, ids, body);
    const s = await ours(client, ids, String(body.id || ''));
    if (!s) return json(404, { error: 'no such helper' });
    if (path === '/api/helpers/stop') {
      if (s.status !== 'terminated') await client.beta.sessions.events.send(s.id, { events: [{ type: 'user.interrupt' }] });
      return json(200, { id: s.id, status: 'stopped' });
    }
    if (path === '/api/helpers/more') {
      const words = clip(body.words, 2000);
      if (!words) return json(400, { error: 'say what to look into next' });
      if (s.status === 'terminated') return json(409, { error: 'that helper has gone home; send a new one' });
      await client.beta.sessions.events.send(s.id, { events: [{ type: 'user.message', content: [{ type: 'text', text: `Reverie has a follow-up for you:\n\n${words}\n\nFinish with a new report, the same way.` }] }] });
      return json(200, { id: s.id, status: 'working' });
    }
    return json(404, { error: 'not found' });
  } catch (e) {
    const st = e?.status;
    return json(st === 429 ? 429 : st === 400 ? 400 : 502, { error: clip(e?.message || e, 200) });
  }
}
