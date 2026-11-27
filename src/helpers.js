// Reverie's helpers, on the page: it sends little helpers off to look into or work things out (send_helper), keeps
// track of what each is doing (the helpers tool, and a line in what Claude is told each turn), and when one comes back,
// tells you what it found in its own voice. The helpers themselves run at Anthropic (server/helpers.js): this file
// only asks after them every few seconds while any is working. Who was sent where is kept in this browser, so a
// reload picks them up again, and a helper that finished while the page was shut reports as soon as you're back.
const API = (import.meta.env?.VITE_API_URL || '').replace(/\/+$/, '') + '/api/helpers';
const KEY = 'reverie.helpers.v1';
const KEEP = 12;                  // helpers remembered (the oldest finished ones drop off)
const AT_ONCE = 3;                // the Worker has its own limits too (server/helpers.js)
const POLL = 5000, POLL_HIDDEN = 30000;
const NAMES = ['Pip', 'Bo', 'Tink', 'Mo', 'Dot', 'Zip', 'Fen', 'Lu', 'Kit', 'Nim'];
const COLOURS = ['#7fd8ff', '#ffd36b', '#b49bff', '#7dffb2', '#ff9ccf', '#ffab6b'];
const OVER = ['done', 'failed', 'out_of_budget', 'stopped'];

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const ago = ms => { const m = Math.round(ms / 60000); return m < 1 ? 'just now' : m === 1 ? 'a minute ago' : m < 60 ? `${m} minutes ago` : `${Math.round(m / 60)} hours ago`; };

function load() { try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter(h => h && h.id && h.name) : []; } catch { return []; } }

/**
 * makeHelpers({ ready, onReport, context, onChange }):
 *   ready()       true when Reverie may speak up (awake, not mid-reply)
 *   onReport(h)   a helper finished (or failed) and Reverie should say so: returns true once it has been passed on
 *   context()     where and when they are, sent along with each task
 *   onChange(list) the list changed (for the room's wisps and the chips)
 */
export function makeHelpers({ ready = () => true, onReport = () => false, context = () => '', onChange = () => {}, fetch: get = (...a) => fetch(...a) } = {}) {
  let list = load(), timer = 0, polling = false;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-KEEP))); } catch { /* private mode */ } };
  const changed = () => { save(); try { onChange(list); } catch (e) { console.warn('[reverie] helpers view', e); } };
  const working = () => list.filter(h => h.status === 'working');
  const byName = name => { const n = clip(name, 24).toLowerCase(); return n ? [...list].reverse().find(h => h.name.toLowerCase() === n || h.name.toLowerCase().startsWith(n)) : null; };
  const pick = name => byName(name) || (!name ? [...list].reverse().find(h => h.status === 'working') || list.at(-1) : null);

  async function call(path, body) {
    const res = await get(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(out.error || `the helpers said ${res.status}`); e.status = res.status; e.setup = out.setup; throw e; }
    return out;
  }

  function schedule(ms) { clearTimeout(timer); timer = setTimeout(poll, ms ?? (document.hidden ? POLL_HIDDEN : POLL)); }

  /** Asks after every working helper, then passes on any finished one that hasn't been told yet. */
  async function poll() {
    if (polling) return; polling = true;
    try {
      const ids = working().map(h => h.id);
      if (ids.length) {
        const { helpers = [] } = await call('?ids=' + ids.map(encodeURIComponent).join(','));
        let moved = false;
        for (const s of helpers) {
          const h = list.find(x => x.id === s.id); if (!h || s.status === 'unknown') continue;
          const was = h.status + h.doing + h.steps;
          Object.assign(h, { status: s.status, doing: s.doing || h.doing, steps: s.steps ?? h.steps, sources: s.sources || [], cost: s.cost ?? h.cost, error: s.error || null });
          if (OVER.includes(s.status)) { h.result = s.result || ''; h.ended = Date.now(); h.told = false; }
          if (was !== h.status + h.doing + h.steps) moved = true;
        }
        if (moved) changed();
      }
    } catch (e) { console.warn('[reverie] helpers', e.message); }
    finally { polling = false; }
    tell();
    if (working().length || list.some(h => !h.told && OVER.includes(h.status))) schedule();
  }

  /** One finished helper at a time is passed to Reverie, when it is free to speak. */
  function tell() {
    const h = list.find(x => !x.told && OVER.includes(x.status) && x.status !== 'stopped');
    if (!h || !ready()) return;
    if (onReport(h)) { h.told = true; changed(); }
  }

  /** The send_helper tool: off it goes. */
  async function send(input) {
    const task = clip(input?.task, 3000);
    if (task.length < 8) return { text: 'Not done: say what the helper should do, as a clear brief.', error: true };
    if (working().length >= AT_ONCE) return { text: `Not sent: ${working().map(h => h.name).join(', ')} are all still out, and ${AT_ONCE} at once is the most. Say they'll have to wait, or stop one with the helpers tool.`, error: true };
    let name = clip(input?.name, 24).replace(/[^\p{L}\p{N} '-]/gu, '') || NAMES.find(n => !list.some(h => h.name === n && h.status === 'working')) || 'Helper';
    // (two out at once never share a name: the second gets a free one)
    const busy = n => list.some(h => h.name.toLowerCase() === n.toLowerCase() && h.status === 'working');
    if (busy(name)) name = NAMES.find(n => !busy(n)) || name + ' ' + (list.length + 1);
    try {
      const r = await call('', { name, task, context: clip(context(), 600) });
      list.push({ id: r.id, name, task, at: Date.now(), status: 'working', doing: 'getting started', steps: 0, sources: [], result: '', cost: 0, told: false, colour: COLOURS[list.length % COLOURS.length] });
      list = list.slice(-KEEP); changed(); schedule(3000);
      return `Sent ${name} off to look into it. It works on its own in the background, usually for one to a few minutes, and you'll hear back when it's done; chat about other things meanwhile.`;
    } catch (e) {
      return { text: e.setup ? 'Not sent: your helpers are not set up on the server yet. Tell them, kindly, that it needs setting up first.'
        : e.status === 429 ? `Not sent: ${e.message}.` : `Not sent: ${e.message}.`, error: true };
    }
  }

  /** The helpers tool: how they're doing, what one found, a follow-up, call one back, or tidy up the finished ones. */
  async function manage(input = {}) {
    const action = input.action || 'status', h = pick(input.name);
    if (action === 'status') {
      if (!list.length) return 'You have no helpers out, and none have reported back yet.';
      return list.slice(-6).map(lineOf).join(' ');
    }
    if (action === 'clear') { const n = list.length; list = list.filter(x => x.status === 'working'); changed(); return n - list.length ? `Tidied away ${n - list.length} finished helpers.` : 'Nothing to tidy.'; }
    if (!h) return { text: input.name ? `There's no helper called ${input.name}. Your helpers: ${list.map(x => x.name).join(', ') || 'none'}.` : 'You have no helpers.', error: true };
    if (action === 'read') {
      if (h.status === 'working') return `${h.name} is still working (${h.doing}, ${h.steps} steps so far). Nothing to read yet.`;
      h.told = true; changed();
      return h.result ? `${h.name}'s full report (sent ${ago(Date.now() - h.at)} to: ${clip(h.task, 160)}):\n${h.result}` : `${h.name} came back without a report${h.error ? ': ' + h.error : ''}.`;
    }
    if (action === 'stop') {
      if (h.status !== 'working') return `${h.name} isn't working on anything.`;
      await call('/stop', { id: h.id }).catch(() => {});
      Object.assign(h, { status: 'stopped', doing: 'called back', ended: Date.now(), told: true }); changed();
      return `Called ${h.name} back.`;
    }
    if (action === 'more') {
      const words = clip(input.words, 2000);
      if (!words) return { text: 'Not done: say what to look into next in words.', error: true };
      if (h.status === 'working') return { text: `${h.name} is still busy with the first job; wait for its report.`, error: true };
      if (working().length >= AT_ONCE) return { text: `Not sent: ${AT_ONCE} helpers are already out.`, error: true };
      try { await call('/more', { id: h.id, words }); }
      catch (e) { return { text: `Not sent: ${e.message}.`, error: true }; }
      Object.assign(h, { status: 'working', doing: 'getting started', steps: 0, result: '', told: false, task: words, at: Date.now() }); changed(); schedule(3000);
      return `Sent ${h.name} back out with that. You'll hear when it's done.`;
    }
    return { text: 'Not done: action must be status, read, more, stop or clear.', error: true };
  }

  function lineOf(h) {
    const what = `${h.name} (sent ${ago(Date.now() - h.at)} to: ${clip(h.task, 90)})`;
    if (h.status === 'working') return `${what} is ${h.doing}${h.steps ? `, ${h.steps} steps in` : ''}.`;
    if (h.status === 'stopped') return `${what} was called back.`;
    if (h.status === 'failed') return `${what} came back without an answer${h.error ? ' (' + h.error + ')' : ''}.`;
    return `${what} ${h.status === 'out_of_budget' ? 'ran out of budget and came back with what it had' : 'finished'}${h.told ? '' : ', not told yet'}.`;
  }

  // a reload: carry on asking after the ones still out, and tell the ones that finished meanwhile
  if (list.some(h => h.status === 'working' || (!h.told && OVER.includes(h.status)))) schedule(1500);
  document.addEventListener?.('visibilitychange', () => { if (!document.hidden && working().length) schedule(300); });

  return {
    send, manage, poll, tell,
    get list() { return list; },
    get working() { return working(); },
    /** For what Claude is told of the scene each turn: helpers out now, and recent ones. */
    line() {
      const now = list.filter(h => h.status === 'working' || (h.ended && Date.now() - h.ended < 20 * 60000));
      return now.length ? ` Your helpers: ${now.map(h => h.status === 'working' ? `${h.name} is ${h.doing}` : `${h.name} ${h.status === 'failed' ? 'came back empty-handed' : h.status === 'stopped' ? 'was called back' : 'has reported back'}`).join('; ')}.` : '';
    },
  };
}

/** What Reverie hears when a helper comes back: news for it to retell out loud, in its own words. */
export function reportOf(h) {
  const where = h.sources?.length ? ` It read ${h.sources.slice(0, 4).join(', ')}.` : '';
  if (h.status === 'failed') return `[helper] ${h.name}, the helper you sent to "${clip(h.task, 120)}", came back without an answer${h.error ? ` (${h.error})` : ''}. Tell them kindly, and offer to send another or try it yourself.`;
  const head = h.status === 'out_of_budget' ? `${h.name} ran out of its budget before it finished, but here is what it had` : `${h.name}, the helper you sent to "${clip(h.task, 120)}", is back. Its report`;
  // (what they say is cut at 1000 characters, so a long report is cut here and the rest read with the helpers tool)
  const more = h.result.length > 620 ? ' (more: read the whole report with the helpers tool if they want details)' : '';
  return `[helper] ${head}:${where}\n${clip(h.result, 620)}${more}\nTell them what it found now, in your own words: a few short, lively spoken sentences, the answer first.`;
}
