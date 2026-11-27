// The helpers' backend (server/helpers.js) against a stand-in Anthropic client: how a session's events are read into
// "what it's doing" and a report, the limits, only our own sessions being readable, and a paused call being denied.
//   node tests/helpers-server.mjs
import assert from 'node:assert/strict';
import { handleHelpers, summarise, doingOf } from '../server/helpers.js';

const env = { ANTHROPIC_API_KEY: 'k', REVERIE_HELPER_AGENT_ID: 'agent_mine', REVERIE_HELPER_ENV_ID: 'env_mine', REVERIE_HELPERS_AT_ONCE: '2', REVERIE_HELPERS_PER_DAY: '3' };
const req = (method, path, body) => new Request('http://x' + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

// ---- reading events (newest first)
assert.equal(doingOf({ type: 'agent.tool_use', name: 'web_search', input: { query: 'trains to york' } }), 'searching for "trains to york"');
assert.equal(doingOf({ type: 'agent.tool_use', name: 'web_fetch', input: { url: 'https://www.nationalrail.co.uk/x' } }), 'reading nationalrail.co.uk');
const working = summarise({ id: 'sesn_1', status: 'running', usage: { list_cost: { amount: '12' } } }, [
  { type: 'agent.tool_use', name: 'web_fetch', input: { url: 'https://bbc.co.uk/a' } },
  { type: 'agent.tool_use', name: 'web_search', input: { query: 'q' } },
  { type: 'user.message' },
  { type: 'agent.message', content: [{ type: 'text', text: 'an old report' }] },
]);
assert.equal(working.status, 'working'); assert.equal(working.doing, 'reading bbc.co.uk'); assert.equal(working.steps, 2); assert.equal(working.cost, .12);
assert.equal(working.result, '', 'a report from before the latest ask is not this one');
const done = summarise({ id: 'sesn_1', status: 'idle' }, [
  { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
  { type: 'agent.message', content: [{ type: 'text', text: 'Part two.' }] },
  { type: 'agent.message', content: [{ type: 'text', text: 'Part one.' }] },
  { type: 'agent.tool_use', name: 'web_fetch', input: { url: 'https://example.org/' } },
  { type: 'user.message' },
]);
assert.equal(done.status, 'done'); assert.equal(done.result, 'Part one.\n\nPart two.'); assert.deepEqual(done.sources, ['example.org']);
assert.equal(summarise({ id: 's', status: 'idle' }, [{ type: 'session.status_idle', stop_reason: { type: 'budget_reached' } }, { type: 'user.message' }]).status, 'out_of_budget');
assert.equal(summarise({ id: 's', status: 'idle' }, [{ type: 'session.status_idle', stop_reason: { type: 'end_turn' } }, { type: 'user.message' }]).status, 'failed');
assert.equal(summarise({ id: 's', status: 'idle' }, [{ type: 'user.message' }]).status, 'working', 'idle before it starts: still queued');

// ---- the routes, with a stand-in client
function fakeClient({ running = 0, today = 0, sessions = {} } = {}) {
  const sent = [], created = [];
  async function* list(params) {
    const n = params.statuses ? running : today;
    for (let i = 0; i < n; i++) yield { id: 'sesn_x' + i };
  }
  return { sent, created, beta: { sessions: {
    list, retrieve: async id => { if (!sessions[id]) { const e = new Error('nope'); e.status = 404; throw e; } return sessions[id]; },
    create: async p => { created.push(p); return { id: 'sesn_new00000001', status: 'running' }; },
    events: {
      list: async id => ({ data: sessions[id]?.events || [] }),
      send: async (id, p) => { sent.push([id, p]); return {}; },
    },
  } } };
}

let c = fakeClient();
let r = await handleHelpers(req('POST', '/api/helpers', { name: 'Pip', task: 'find the cheapest train to York on Saturday', context: 'they are in Leeds' }), env, c);
assert.equal(r.status, 200); assert.equal((await r.json()).id, 'sesn_new00000001');
const p = c.created[0];
assert.equal(p.agent, 'agent_mine'); assert.equal(p.environment_id, 'env_mine');
assert.deepEqual(p.budget, { type: 'limit', max_list_cost: { amount: '100', currency: 'USD' } });
assert.match(p.initial_events[0].content[0].text, /Pip[\s\S]*cheapest train[\s\S]*Leeds/);

r = await handleHelpers(req('POST', '/api/helpers', { name: 'Pip', task: 'find the cheapest train to York' }), env, fakeClient({ running: 2 }));
assert.equal(r.status, 429); assert.equal((await r.json()).limit, 'running');
r = await handleHelpers(req('POST', '/api/helpers', { name: 'Pip', task: 'find the cheapest train to York' }), env, fakeClient({ today: 3 }));
assert.equal(r.status, 429); assert.equal((await r.json()).limit, 'day');
r = await handleHelpers(req('POST', '/api/helpers', { task: 'hi' }), env, fakeClient());
assert.equal(r.status, 400);

// only our own sessions can be read or steered
c = fakeClient({ sessions: {
  sesn_ours0001: { id: 'sesn_ours0001', status: 'idle', agent: { id: 'agent_mine' }, events: [{ type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_ask'] } }, { type: 'agent.tool_use', name: 'bash', input: {} }, { type: 'user.message' }] },
  sesn_other001: { id: 'sesn_other001', status: 'idle', agent: { id: 'agent_someone_else' }, events: [] },
} });
r = await (await handleHelpers(req('GET', '/api/helpers?ids=sesn_ours0001,sesn_other001,not-an-id'), env, c)).json();
assert.equal(r.helpers[0].status, 'working', 'a paused call keeps it working');
assert.equal(r.helpers[1].status, 'failed'); assert.equal(r.helpers[1].error, 'this helper is gone');
assert.equal(r.helpers[2].status, 'failed');
assert.equal(c.sent.length, 1, 'the paused call was answered');
assert.deepEqual(c.sent[0][1].events[0], { type: 'user.tool_confirmation', tool_use_id: 'sevt_ask', result: 'deny', deny_message: c.sent[0][1].events[0].deny_message });
assert.equal((await handleHelpers(req('POST', '/api/helpers/stop', { id: 'sesn_other001' }), env, c)).status, 404);
assert.equal((await handleHelpers(req('POST', '/api/helpers/stop', { id: 'sesn_ours0001' }), env, c)).status, 200);
assert.deepEqual(c.sent.at(-1), ['sesn_ours0001', { events: [{ type: 'user.interrupt' }] }]);
assert.equal((await handleHelpers(req('POST', '/api/helpers/more', { id: 'sesn_ours0001', words: 'and on Sunday?' }), env, c)).status, 200);
assert.match(c.sent.at(-1)[1].events[0].content[0].text, /Sunday/);

// not set up yet: says so
const none = fakeClient(); none.beta.agents = { list: async function* () { yield { id: 'agent_x', metadata: {} }; } }; none.beta.environments = { list: async function* () {} };
r = await handleHelpers(req('GET', '/api/helpers?ids=a'), { ANTHROPIC_API_KEY: 'k' }, none);
assert.equal(r.status, 503); assert.equal((await r.json()).setup, true);
// no ids in the env: found once by their metadata
const look = fakeClient({ sessions: { sesn_ours0002: { id: 'sesn_ours0002', status: 'running', agent: { id: 'agent_found' }, events: [] } } });
look.beta.agents = { list: async function* () { yield { id: 'agent_old', metadata: { app: 'reverie-helper' }, archived_at: '2026-01-01' }; yield { id: 'agent_found', metadata: { app: 'reverie-helper' } }; } };
look.beta.environments = { list: async function* () { yield { id: 'env_found', metadata: { app: 'reverie-helper' } }; } };
r = await (await handleHelpers(req('GET', '/api/helpers?ids=sesn_ours0002'), { ANTHROPIC_API_KEY: 'k' }, look)).json();
assert.equal(r.helpers[0].status, 'working');
console.log('helpers-server: ok');
