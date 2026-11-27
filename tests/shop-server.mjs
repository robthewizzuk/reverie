// The shopping backend (server/shop.js) without the network: the request it builds, the links it trusts, and a whole
// run against a stand-in client that pauses once, searches, fetches and reports (one offer on a site it never saw).
//   node tests/shop-server.mjs
import { checkShop, shopRequest, seenLinks, cleanReport, handleShop } from '../server/shop.js';

let failed = 0;
const ok = (c, msg) => { if (!c) { failed++; console.error('FAIL:', msg); } else console.log('ok:', msg); };

ok(checkShop({ query: 'kettle' }) === null, 'a plain query is fine');
ok(checkShop({ query: '' }) && checkShop({ query: 'x', budget: -1 }) && checkShop({ query: 'x'.repeat(201) }), 'empty, negative budget and too long are refused');

const req = shopRequest({ query: 'kettle', budget: 40, notes: 'white' }, {});
ok(req.model === 'claude-sonnet-5-5', 'Sonnet 5.5 looks');
ok(req.tools.some(t => t.type === 'web_search_20260209' && t.user_location.country === 'GB') && req.tools.some(t => t.type === 'web_fetch_20260209'), 'web search (in the UK) and web fetch');
ok(/£40/.test(req.messages[0].content) && /white/.test(req.messages[0].content), 'budget and notes are in the ask');
ok(req.fallbacks === 'default' && req.tool_choice.type === 'auto', 'server-side fallback, tool choice auto');

const content = [
  { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'kettle uk' } },
  { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://www.argos.co.uk/product/1', title: 'Kettle' }, { type: 'web_search_result', url: 'https://www.johnlewis.com/k/p2', title: 'Kettle' }] },
  { type: 'server_tool_use', id: 's2', name: 'web_fetch', input: { url: 'https://www.currys.co.uk/k.html' } },
  { type: 'web_fetch_tool_result', tool_use_id: 's2', content: { type: 'web_fetch_result', url: 'https://www.currys.co.uk/k.html', content: { type: 'document' } } },
];
const seen = seenLinks(content);
ok(seen.has('https://www.argos.co.uk/product/1') && seen.has('https://www.currys.co.uk/k.html'), 'links from search results and fetched pages are seen');

const report = { summary: 'Argos is cheapest.', kind: 'kettle', best: 3, offers: [
  { name: 'Kettle A', retailer: 'Argos', price: 24.99, was: 0, url: 'https://www.argos.co.uk/product/1', stock: 'in stock', delivery: 'free', note: '' },
  { name: 'Kettle A', retailer: 'Made Up', price: 9.99, was: 0, url: 'https://totally-real-deals.example/k', stock: 'in stock', delivery: '', note: '' },
  { name: 'Kettle A', retailer: 'John Lewis', price: 29, was: 35, url: 'https://johnlewis.com/k/other', stock: 'unknown', delivery: '', note: '' },
  { name: 'Kettle A', retailer: 'Currys', price: 'free!', was: 0, url: 'https://www.currys.co.uk/k.html', stock: 'in stock', delivery: '', note: '' },
  { name: 'Kettle A', retailer: 'Evil', price: 5, was: 0, url: 'javascript:alert(1)', stock: 'in stock', delivery: '', note: '' },
] };
const r = cleanReport(report, seen, 'kettle');
ok(r.offers.length === 2, `only offers on seen sites with real prices are kept (${r.offers.length})`);
ok(!r.offers.some(o => /example|javascript/.test(o.url)), 'a made-up shop and a javascript: link are dropped');
ok(r.offers[0].exact === true && r.offers[1].exact === false && r.offers[1].was === 35, 'exact links are marked, was-prices kept');
ok(r.best === 2, `the pick follows its offer after dropping (${r.best})`);

// a whole run, with a stand-in client: a pause, then the report
let calls = 0;
const fakeClient = { beta: { messages: { stream(body) {
  calls++;
  const msg = calls === 1 ? { content: content.slice(0, 2), stop_reason: 'pause_turn' }
    : { content: [...content.slice(2), { type: 'tool_use', id: 't1', name: 'report_offers', input: report }], stop_reason: 'tool_use' };
  const handlers = {};
  return { on(ev, f) { handlers[ev] = f; return this; }, async finalMessage() { for (const b of msg.content) handlers.contentBlock?.(b); return msg; } };
} } } };
const res = await handleShop(new Request('http://x/api/shop', { method: 'POST', body: JSON.stringify({ query: 'kettle' }) }), {}, { client: fakeClient });
const text = await res.text();
const events = text.split('\n\n').filter(Boolean).map(l => JSON.parse(l.replace(/^data: /, '')));
ok(calls === 2, 'a paused turn is carried on');
ok(events.some(e => e.type === 'progress' && /Searching: kettle uk/.test(e.text)) && events.some(e => e.type === 'progress' && /currys/.test(e.text)), 'progress for each search and page');
const done = events.find(e => e.type === 'done');
ok(done && done.result.offers.length === 2, 'done, with the cleaned offers');

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('all passed');
