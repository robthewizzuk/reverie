// Every so often, the chat so far is boiled down for the diary (memory.js): the lines not yet recapped go to the
// backend's /api/recap with what the diary already knows, and what comes back (a one-line recap, and facts to add,
// change or drop) is written in. So Reverie learns about you even from things it didn't think to write down, the raw
// chat never piles up, and what Claude reads at the top of a chat stays small.
//
// When: after a quiet spell in a chat (IDLE_MS with nothing said), when the page is hidden (a tab switch, closing
// it), and on the next visit for anything left over. Never while learning is turned off in the diary sheet.

const API = (import.meta.env?.VITE_API_URL || '').replace(/\/+$/, '') + '/api/recap';
const IDLE_MS = 75_000;     // quiet this long after something was said: recap it
const MIN_THEIRS = 2;       // lines of theirs it takes to be worth a recap (any, when the page is closing)

/** memory: memory.js. Returns { poke() after each line said, now(why) to recap straight away }. */
export function makeRecapper({ memory, fetchFn = (...a) => fetch(...a), log = (...a) => console.info('[reverie]', ...a) }) {
  let timer = null, running = null, failures = 0;

  async function now(why = 'quiet', { keepalive = false } = {}) {
    clearTimeout(timer); timer = null;
    if (running || !memory.learn) return running;
    const p = memory.pending();
    if (p.theirs < (why === 'quiet' ? MIN_THEIRS : 1)) return null;
    running = (async () => {
      try {
        const res = await fetchFn(API, { method: 'POST', headers: { 'content-type': 'application/json' }, keepalive, body: JSON.stringify({ ...memory.forRecap(), lines: p.lines.slice(-60) }) });
        if (!res.ok) throw new Error(`the backend said ${res.status}`);
        const r = await res.json();
        const done = memory.applyRecap(r, p.upTo);
        failures = 0;
        log(`diary recap (${why}): ${done}`);
      } catch (e) {
        // (kept for next time: the lines stay until a recap goes through)
        failures++; log(`diary recap failed (${why}): ${e?.message || e}`);
        if (failures < 4) schedule(IDLE_MS * 2 ** failures);
      } finally { running = null; }
    })();
    return running;
  }
  function schedule(ms = IDLE_MS) { clearTimeout(timer); timer = setTimeout(() => now('quiet'), ms); }

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') now('hidden', { keepalive: true }); });
  // (left over from last time: a few seconds after the page opens, out of the way of the hello)
  if (memory.pending().theirs) setTimeout(() => now('last time'), 6000);

  return { poke: () => schedule(), now };
}
