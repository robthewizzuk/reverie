// Shopping: "find me some wireless headphones under £100". Reverie sends a helper off (server/shop.js: Sonnet with web
// search, looking across UK shops) and carries on chatting; the helper's offers come back as cards along the bottom of
// the stage, cheapest first, and as [shop] news for Reverie to talk about. It holds up a little 3D model of the thing.
//
// Reverie never buys anything itself and never sees a card number. Asking it to buy one puts a confirm strip on the
// screen; only a tap on it (or on a card's own button) opens that shop's page, where the person checks out themselves.
// The last search is kept in this browser so the cards can be brought back.
const API = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '') + '/api/shop';
const KEEP_KEY = 'reverie.shop';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gbp = n => '£' + (Number.isInteger(n) ? String(n) : n.toFixed(2));
const safeUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch { return null; } };

/** Reads a text/event-stream response, calling onEvent for each `data:` object. */
async function readEvents(res, onEvent) {
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const data = buf.slice(0, i).split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
      buf = buf.slice(i + 2);
      if (data) onEvent(JSON.parse(data));
    }
  }
}

/** The offers as Reverie hears them: short, numbered as on the cards. Exported for the tests. */
export function newsOf(r) {
  if (!r.offers.length) return `[shop] Your shopping helper looked for "${r.query}" but found nothing it could link to. ${r.summary}`.trim();
  const cheapest = r.offers.reduce((a, o, i) => o.price < r.offers[a].price ? i : a, 0);
  const lines = r.offers.map((o, i) => `${i + 1}. ${o.name}: ${gbp(o.price)}${o.was ? ` (was ${gbp(o.was)})` : ''} at ${o.retailer}${o.delivery ? ', delivery ' + o.delivery : ''}${o.stock !== 'unknown' ? ', ' + o.stock : ''}${o.note ? ', ' + o.note : ''}.`);
  return `[shop] Your shopping helper is back with ${r.offers.length} offer${r.offers.length > 1 ? 's' : ''} for "${r.query}", shown as numbered cards on their screen (prices as the shops showed them just now):\n${lines.join('\n')}\n`
    + `Cheapest: number ${cheapest + 1}.${r.best ? ` Helper's pick: number ${r.best}.` : ''} ${r.summary}\n`
    + `Tell them in a sentence or two: the cheapest and your pick, the price said naturally. Don't read the list or any links. If they want one, use shop with action buy.`;
}

/** el: the #shop element. world: the stage (to hold up a model of the thing). onNews(text, loud): to Reverie. */
export function makeShop({ el, world, onNews = () => {} }) {
  const head = el.querySelector('.head span'), cards = el.querySelector('.cards'), confirm = el.querySelector('.confirm');
  let result = null, busy = null, progress = '', picked = 0;
  try { result = JSON.parse(localStorage.getItem(KEEP_KEY) || 'null')?.result || null; } catch { result = null; }

  function render() {
    el.classList.toggle('busy', !!busy);
    if (busy) {
      head.textContent = `Looking for ${busy.query}…`;
      cards.innerHTML = `<p class="wait">${esc(progress || 'Sending a helper off to the shops')}</p>`;
      confirm.hidden = true; return;
    }
    if (!result) { head.textContent = 'Shopping'; cards.innerHTML = '<p class="wait">Ask Reverie to find you something.</p>'; confirm.hidden = true; return; }
    head.textContent = `${result.query}`;
    const cheapest = result.offers.length ? Math.min(...result.offers.map(o => o.price)) : 0;
    cards.innerHTML = result.offers.length ? result.offers.map((o, i) => {
      const url = safeUrl(o.url);
      const tags = [o.price === cheapest ? '<b class="tag cheap">Cheapest</b>' : '', result.best === i + 1 ? '<b class="tag pick">Reverie\'s pick</b>' : ''].join('');
      return `<article class="card${picked === i + 1 ? ' picked' : ''}" data-n="${i + 1}">
        <header><span class="n">${i + 1}</span><span class="shop">${esc(o.retailer)}</span>${tags}</header>
        <h4>${esc(o.name)}</h4>
        <p class="price">${esc(gbp(o.price))}${o.was ? ` <s>${esc(gbp(o.was))}</s>` : ''}</p>
        <p class="meta">${esc([o.stock !== 'unknown' ? o.stock : '', o.delivery ? 'delivery ' + o.delivery : '', o.note].filter(Boolean).join(' · '))}</p>
        ${url ? `<a class="go" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-n="${i + 1}">See it at ${esc(o.site)} ↗</a>` : ''}
      </article>`;
    }).join('') : `<p class="wait">${esc(result.summary || 'Nothing found.')}</p>`;
    const o = picked && result.offers[picked - 1], url = o && safeUrl(o.url);
    confirm.hidden = !url;
    if (url) {
      confirm.querySelector('p').textContent = `Buy ${o.name} for ${gbp(o.price)} at ${o.retailer}? You'll finish on their own site and pay there; Reverie never sees your card.`;
      const go = confirm.querySelector('a');
      go.href = url; go.dataset.n = String(picked); go.textContent = `Go to ${o.retailer} ↗`;
      cards.querySelector(`.card[data-n="${picked}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  }

  el.addEventListener('click', e => {
    const b = e.target.closest('button, a'); if (!b) return;
    if (b.dataset.id === 'close') return hide();
    if (b.dataset.id === 'stop') { busy?.ctl.abort(); return; }
    if (b.dataset.id === 'notnow') { picked = 0; render(); onNews('[shop] They decided not to buy it just now.', false); return; }
    // (a link: the browser opens the shop's page in a new tab, from their own tap)
    if (b.tagName === 'A' && b.dataset.n && result) {
      const o = result.offers[+b.dataset.n - 1];
      if (o) onNews(`[shop] They opened ${o.retailer}'s page for number ${b.dataset.n}, ${o.name} (${gbp(o.price)}), to finish there.`, false);
      picked = 0; setTimeout(render, 0);
    }
  });

  async function find({ query, budget, notes }) {
    query = String(query || '').trim().slice(0, 200);
    if (!query) return { text: 'Not done: say what to look for.', error: true };
    if (busy) return `Your helper is still out looking for "${busy.query}". Wait for it.`;
    const ctl = new AbortController();
    busy = { query, ctl }; progress = ''; picked = 0; show(); render();
    (async () => {
      try {
        const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
          body: JSON.stringify({ query, ...(budget > 0 ? { budget } : {}), ...(notes ? { notes: String(notes).slice(0, 300) } : {}) }) });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `the shop helper said ${res.status}`); }
        let got = null, failed = null;
        await readEvents(res, ev => {
          if (ev.type === 'progress') { progress = ev.text; if (busy) render(); }
          else if (ev.type === 'done') got = ev.result;
          else if (ev.type === 'error') failed = ev.error;
        });
        if (failed || !got) throw new Error(failed || 'the reply was cut off');
        result = got; busy = null;
        try { localStorage.setItem(KEEP_KEY, JSON.stringify({ result, at: Date.now() })); } catch { /* private window */ }
        show(); render();
        console.info(`[reverie] shop: ${result.offers.length} offers for "${query}" in ${Math.round((result.ms || 0) / 1000)} s`);
        onNews(newsOf(result), true);
        // it holds up a little model of the thing (not in the middle of a game)
        if (result.offers.length && result.kind && !world.game) world.make(result.kind).catch(() => {});
      } catch (e) {
        const stopped = e?.name === 'AbortError';
        busy = null; render();
        onNews(stopped ? `[shop] They called the shopping helper back before it finished looking for "${query}".` : `[shop] The shopping helper couldn't finish looking for "${query}": ${String(e?.message || e).slice(0, 120)}. Say sorry lightly and offer to try again.`, !stopped);
      }
    })();
    return `Your shopping helper has gone off to look across UK shops for "${query}"${budget > 0 ? ` (up to ${gbp(budget)})` : ''}. It takes about a minute; you'll get its offers as [shop] news, and cards appear on their screen. Say a short line while it looks, and nothing about prices yet.`;
  }

  function buy({ pick }) {
    if (!result?.offers.length) return { text: 'Not done: there are no offers to buy from yet. Search first with action find.', error: true };
    const n = pick > 0 ? Math.round(pick) : result.best || 1, o = result.offers[n - 1];
    if (!o) return { text: `Not done: there are only ${result.offers.length} offers.`, error: true };
    picked = n; show(); render();
    return `A confirm button for number ${n}, ${o.name} at ${o.retailer} (${gbp(o.price)}), is on their screen. You can't buy it or pay for them: only their tap opens ${o.retailer}'s page, where they check out themselves. Tell them that in one short sentence.`;
  }

  function list() {
    if (busy) return `Your helper is still out looking for "${busy.query}".`;
    if (!result) return 'There are no shopping results yet.';
    show(); render();
    return 'The cards are back on their screen. ' + newsOf(result).replace(/^\[shop\] /, '');
  }

  function show() { el.hidden = false; }
  function hide() { el.hidden = true; picked = 0; }
  render();
  return {
    /** Claude's shop tool: { action: find | show | buy, query?, budget?, notes?, pick? } */
    tool: async input => {
      // (streamed tool inputs are not checked by the API)
      if (!['find', 'show', 'buy'].includes(input?.action)) return { text: 'Not done: action must be find, show or buy.', error: true };
      if (['query', 'notes'].some(k => input[k] != null && typeof input[k] !== 'string') || ['budget', 'pick'].some(k => input[k] != null && typeof input[k] !== 'number')) return { text: 'Not done: query and notes are text, budget and pick are numbers.', error: true };
      return input.action === 'find' ? find(input) : input.action === 'buy' ? buy(input) : list();
    },
    show: () => { show(); render(); }, hide,
    get open() { return !el.hidden; }, get busy() { return !!busy; }, get result() { return result; },
  };
}
