// Draw it and Reverie makes it: a sheet of paper over the stage to draw on with a finger or a mouse. When you're done,
// the engine's doodle model (gs.doodle, a tiny network trained on Quick, Draw! drawings, on the device, a few
// milliseconds) names what it looks like among 200 things, and Reverie magics that up with the 3D generator.
// Nothing is sent anywhere but the name of what it guessed, for Reverie to react to.
import gs, { loadParts } from '../engine/src/gamescroll.js';

const SURE = .3;     // how sure the model must be before Reverie makes its guess without asking

/**
 * The pad. o.el: the #pad element (a canvas and Cancel, Clear and Make it! buttons). onDrawn(guesses) gets the
 * model's top guesses ({ name, sure }), most likely first, once they press Make it!
 */
export function makePad({ el, onDrawn = () => {}, onOpen = () => {} }) {
  const cv = el.querySelector('canvas'), c = cv.getContext('2d');
  let model = null, strokes = [], drawing = false, loading = null, game = null, liveAt = 0;
  const title = el.querySelector('p'), row = el.querySelector('div'), plain = { title: title.textContent, row: row.innerHTML };

  function load() {
    loading ||= (async () => {
      await loadParts(['doodle']);
      for (let i = 0; i < 50; i++) { try { model = new gs.doodle.Doodle(); return model; } catch (e) { if (!e?.kitLoading) throw e; await e.kitLoading; } }
      throw new Error('the doodle model did not load');
    })();
    return loading;
  }
  function fit() {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0); redraw();
  }
  function redraw() {
    const r = cv.getBoundingClientRect();
    c.clearRect(0, 0, r.width, r.height);
    c.lineCap = c.lineJoin = 'round'; c.lineWidth = 5; c.strokeStyle = '#2a1d16';
    for (const s of strokes) { c.beginPath(); s.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); if (s.length === 1) c.lineTo(s[0].x + .1, s[0].y); c.stroke(); }
  }
  const at = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); drawing = true; strokes.push([at(e)]); redraw(); });
  cv.addEventListener('pointermove', e => {
    if (!drawing) return; const p = at(e), s = strokes.at(-1), q = s.at(-1);
    if (Math.hypot(p.x - q.x, p.y - q.y) > 2) { s.push(p); redraw(); }
    // a game hears the drawing as it grows too, a few times a second
    if (game && performance.now() - liveAt > 450) { liveAt = performance.now(); game.onDraw?.(strokes); }
  });
  const end = () => { if (drawing && game) game.onDraw?.(strokes); drawing = false; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);

  const pad = {
    get open() { return !el.hidden; },
    /** Shows the pad (empty), and starts the model loading. */
    show() { strokes = []; el.hidden = false; fit(); load().catch(e => console.warn('[reverie] doodle:', e)); onOpen(); },
    hide() { el.hidden = true; drawing = false; if (game) pad.leave(); },
    /**
     * A game takes the pad over (games/draw.js): o.title is the line over the paper, o.buttons [{ id, label }] the row
     * under it, o.onButton(id) hears them and o.onDraw(strokes) hears the drawing as it grows. The stage shows above it.
     */
    take(o) {
      game = o; el.classList.add('game'); strokes = []; el.hidden = false;
      row.replaceChildren(...(o.buttons || []).map(x => { const b = document.createElement('button'); b.type = 'button'; b.dataset.id = x.id; b.textContent = x.label; return b; }));
      pad.title = o.title || ''; fit(); load().catch(e => console.warn('[reverie] doodle:', e));
    },
    /** The game is done with the pad: it goes back to how it was, and away. */
    leave() { const g = game; if (!g) return; game = null; el.classList.remove('game'); title.textContent = plain.title; row.innerHTML = plain.row; el.hidden = true; drawing = false; strokes = []; g.onLeave?.(); },
    set title(s) { title.textContent = s; },
    get strokes() { return strokes; },
    /** The model's guesses for what is drawn now, at once (none until it has loaded): [{ name, sure }] most likely first. */
    guessNow(among) { return model && strokes.some(s => s.length > 1) ? model.guess(strokes, among ? { among } : undefined) : []; },
    load,
    clear() { strokes = []; redraw(); },
    /** What the model makes of the drawing: its top guesses, most likely first ([] for an empty page). */
    async guess() {
      if (!strokes.some(s => s.length > 1)) return [];
      await load();
      return model.guess(strokes).slice(0, 3);
    },
    sure: SURE,
  };
  el.addEventListener('click', async e => {
    const id = e.target.closest('button')?.dataset.id; if (!id) return;
    if (game) { if (id === 'clear') pad.clear(); game.onButton?.(id); return; }
    if (id === 'cancel') pad.hide();
    else if (id === 'clear') pad.clear();
    else if (id === 'done') {
      if (!strokes.some(s => s.length > 1)) return;
      const btn = e.target.closest('button'); btn.disabled = true;
      try { const g = await pad.guess(); pad.hide(); onDrawn(g); }
      catch (err) { console.warn('[reverie] doodle:', err); pad.hide(); onDrawn([]); }
      finally { btn.disabled = false; }
    }
  });
  new ResizeObserver(() => { if (!el.hidden) fit(); }).observe(cv);
  return pad;
}

/** What Reverie hears about a drawing (and makes, when it's sure enough). world: the stage. Resolves the news line. */
export async function madeFrom(guesses, world) {
  if (!guesses.length) return '[doodle] They opened the drawing pad but nothing came through. Ask them to try again.';
  const [best, ...rest] = guesses, pct = g => Math.round(g.sure * 100) + '%';
  const others = rest.map(g => `${g.name} (${pct(g)})`).join(' or ');
  if (best.sure < SURE) {
    world.creature.gesture('think');
    return `[doodle] They drew you a picture on the drawing pad, but it's hard to tell what it is: it might be ${best.name} (${pct(best)})${others ? ', or ' + others : ''}. Guess out loud, playfully, and make your best guess with make, or ask them what it is.`;
  }
  const r = await world.make(/^[aeiou]/.test(best.name) ? 'an ' + best.name : 'a ' + best.name);
  return `[doodle] They drew you a picture on the drawing pad. It looked most like ${best.name} (${pct(best)} sure${others ? '; or maybe ' + others : ''}), so you magicked their drawing into a real one: ${r} React out loud: admire their drawing and show off what you made. If they say it was meant to be something else, make that instead.`;
}
