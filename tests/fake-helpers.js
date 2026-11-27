// Stand-in helpers for tests and for trying the page with no key (REVERIE_FAKE=1 npm run dev): the same routes and
// answers as server/helpers.js, with each helper "working" for a few seconds (searching, reading, writing up) and then
// reporting a made-up answer. A task with "fail" in it fails; REVERIE_FAKE_HELPER_MS sets how long one takes.
const helpers = new Map();
let n = 0;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const TAKES = () => +(process.env.REVERIE_FAKE_HELPER_MS || 6000);

function view(h) {
  const u = Math.min(1, (Date.now() - h.at) / h.takes);
  if (h.stopped) return { id: h.id, status: 'done', doing: 'finished', steps: h.steps, sources: [], result: 'I was called back before I finished.', cost: .01, error: null };
  if (/fail/i.test(h.task) && u >= 1) return { id: h.id, status: 'failed', doing: '', steps: 2, sources: [], result: '', cost: .02, error: 'it stopped without a report' };
  if (u >= 1) return { id: h.id, status: 'done', doing: 'finished', steps: 4, sources: ['example.org', 'bbc.co.uk'],
    result: `Here's what I found about "${h.task.slice(0, 80)}": the short answer is yes, and it's cheaper on Tuesdays. Sources: Example and the BBC.`, cost: .14, error: null };
  h.steps = Math.floor(u * 4);
  const doing = u < .3 ? `searching for "${h.task.slice(0, 40)}"` : u < .6 ? 'reading example.org' : u < .85 ? 'reading bbc.co.uk' : 'writing up what it found';
  return { id: h.id, status: 'working', doing, steps: h.steps, sources: [], result: '', cost: +(u * .1).toFixed(2), error: null };
}

export async function fakeHelpers(request) {
  const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '');
  if (request.method === 'GET') return json(200, { helpers: (url.searchParams.get('ids') || '').split(',').filter(Boolean).map(id => helpers.has(id) ? view(helpers.get(id)) : { id, status: 'failed', error: 'this helper is gone', doing: '', steps: 0, sources: [], result: '', cost: 0 }) });
  const body = await request.json().catch(() => ({}));
  if (path === '/api/helpers') {
    if (!body.task || String(body.task).length < 8) return json(400, { error: 'say what the helper should do' });
    if ([...helpers.values()].filter(h => view(h).status === 'working').length >= 3) return json(429, { error: '3 helpers are already working; wait for one to finish', limit: 'running' });
    const id = 'sesn_fake' + String(++n).padStart(6, '0');
    helpers.set(id, { id, task: String(body.task), at: Date.now(), takes: TAKES(), steps: 0 });
    return json(200, { id, name: body.name || 'Helper', status: 'working' });
  }
  const h = helpers.get(body.id);
  if (!h) return json(404, { error: 'no such helper' });
  if (path === '/api/helpers/stop') { h.stopped = true; return json(200, { id: h.id, status: 'stopped' }); }
  if (path === '/api/helpers/more') { h.task = String(body.words || h.task); h.at = Date.now(); h.stopped = false; return json(200, { id: h.id, status: 'working' }); }
  return json(404, { error: 'not found' });
}
