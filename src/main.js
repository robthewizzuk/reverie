// The page: runs the stage full screen with the engine's renderer, the chat bar (type, or talk where the device can
// listen on its own), and the creature's words as a caption. Wakes the creature with the first tap, which also
// lets the page make sound.
import gs, { loadParts } from '../engine/src/gamescroll.js';
import { makeWorld } from './world.js';
import { makeBrain } from './brain.js';

const $ = s => document.querySelector(s);
const stage = $('#stage'), canvas = $('#view'), ctx = canvas.getContext('2d');
const input = $('#say'), form = $('#bar'), mic = $('#mic'), caption = $('#caption'), status = $('#status'), wake = $('#wake'), timing = $('#timing');
const gamebar = $('#gamebar'), gameText = $('#gamebar span'), gameButtons = $('#gamebar div');
const debug = new URLSearchParams(location.search).has('debug');

let W = 0, H = 0, world, brain, voice, last = 0, awake = false, captionT = 0;

function fit() {
  const r = stage.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  W = Math.round(r.width); H = Math.round(r.height);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  world?.resize(W, H);
}

// Engine parts load the first time they're needed: a part not in yet throws StillLoading with a promise to wait on.
async function whenLoaded(fn) {
  for (let i = 0; i < 50; i++) {
    try { return fn(); } catch (e) {
      if (!e?.kitLoading) throw e;
      status.textContent = `Waking up… (${e.what || 'loading'})`;
      await e.kitLoading;
    }
  }
  throw new Error('the engine did not finish loading');
}

function setStatus(s) {
  // (no "Thinking…" label: its core swirling and its head tilting say that)
  status.textContent = s === 'thinking' || s === 'thinking harder' ? '' : s.startsWith('error') ? 'Something went wrong: ' + s.slice(7) : s;
  status.classList.toggle('error', s.startsWith('error'));
}
function say(line) { caption.textContent = line; caption.hidden = false; captionT = 4 + line.length * .06; }
function showTiming(t) {
  const ms = x => x == null ? '–' : Math.round(x - t.start) + ' ms';
  const line = `first words ${ms(t.text)} · first tool ${ms(t.tool)} · whole turn ${ms(t.end)}`;
  console.info('[reverie] ' + line);
  if (debug) timing.textContent = line;
}

function frame(now) {
  const dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
  try {
    if (voice?.listening) {
      // the mic hears its voice too: only words it did not just say count as yours
      const heard = voice.text.trim(), yours = heard ? brain.yours(heard) : [];
      world.creature.state.listening = yours.length > 0;
      if (yours.length) input.placeholder = heard;
      // talking over it: three words of yours heard while it speaks stop it
      if (yours.length >= 3 && brain.speaking) brain.interrupt();
      const said = voice.next();
      if (said) {
        input.placeholder = 'Say something, or type…';
        // nearly all its own words: its voice coming back, not you ("make it bigger" after it said "make it" is yours)
        const n = said.split(/\s+/).length, yoursN = brain.yours(said).length;
        if (yoursN > 0 && yoursN / n > .3) brain.hear(said);
        else console.info('[reverie] ignored its own voice: ' + said);
      }
    }
    captionT -= dt; if (captionT < 0 && !brain?.speaking) caption.hidden = true;
    brain.update();
    showGame();
    world.update(dt);
    world.draw(ctx);
  } catch (e) {
    if (!e?.kitLoading) { console.error(e); setStatus('error: ' + e.message); }
  }
  requestAnimationFrame(frame);
}

async function boot() {
  fit(); new ResizeObserver(fit).observe(stage);   // (the stage changes size when the status line comes and goes, not only with the window)
  status.textContent = 'Waking up…';
  await loadParts(['hd', 'models', 'characters', 'physics3d', 'fx3d', 'hear']);
  world = makeWorld();
  await whenLoaded(() => world.reset());
  world.resize(W, H);
  brain = makeBrain({ world, onCaption: say, onStatus: setStatus, onTiming: showTiming });
  world.onNews = (text, loud) => brain.notice(text, loud);
  voice = new gs.hear.Voice({ free: true });
  window.__reverie = { world, brain, gs };
  status.textContent = '';
  wake.hidden = false; wake.textContent = 'Tap to wake it up';
  requestAnimationFrame(frame);
}

function wakeUp() {
  if (awake) return; awake = true; wake.hidden = true;
  const c = world.creature;
  c.gesture('wave'); c.mood('happy');
  const hello = "Hi! I'm Reverie. Ask me to make you something, anything at all.";
  brain.speak(hello);   // (through its speaker, so the mic knows this is its voice)
  input.focus({ preventScroll: true });
  if (voice.available === false) mic.hidden = true;
}

form.addEventListener('submit', e => {
  e.preventDefault();
  const text = input.value.trim(); if (!text || !brain) return;
  input.value = ''; wakeUp(); brain.hear(text, { at: performance.now() });
});
input.addEventListener('input', () => { if (input.value && brain?.speaking && input.value.length > 3) brain.interrupt(); });
mic.addEventListener('click', async () => {
  wakeUp();
  if (voice.listening) { voice.stop(); mic.classList.remove('on'); input.placeholder = 'Say something, or type…'; return; }
  const ok = await voice.start();
  mic.classList.toggle('on', !!ok);
  if (!ok) { mic.hidden = true; setStatus("This device can't listen on its own, so type instead."); }
  else input.placeholder = 'Listening…';
});
wake.addEventListener('click', wakeUp);
canvas.addEventListener('pointerdown', e => {
  if (!world) return;
  if (!awake) return wakeUp();
  const r = canvas.getBoundingClientRect(), hit = world.tap(e.clientX - r.left, e.clientY - r.top);
  if (hit === 'game') return;
  if (hit === 'creature') { world.creature.poke(); gs.sound.sounds.boing?.(); }
  else if (hit === 'prop') world.toss();
});

// The line above the chat bar while a game is on: how it stands, and its buttons (Undo, New game, Done).
let barKey = '';
function showGame() {
  const g = world.game, b = g?.bar();
  const key = b ? b.text + '|' + b.buttons.map(x => x.id).join() : '';
  if (key === barKey) return; barKey = key;
  gamebar.hidden = !b; if (!b) return;
  gameText.textContent = b.text;
  gameButtons.replaceChildren(...b.buttons.map(x => { const el = document.createElement('button'); el.type = 'button'; el.textContent = x.label; el.dataset.id = x.id; return el; }));
}
gamebar.addEventListener('click', e => {
  const id = e.target.closest('button')?.dataset.id, g = world?.game; if (!id || !g) return;
  if (id === 'leave') world.stopGame();
  else if (id === 'again') g.start();
  else g[id]?.();
  barKey = '';
});

boot().catch(e => { console.error(e); setStatus('error: ' + (e?.message || e)); });
