// The page: runs the stage full screen with the engine's renderer, the chat bar (type, or talk where the device can
// listen on its own), and the creature's words as a caption. Wakes the creature with the first tap, which also
// lets the page make sound.
import gs, { loadParts } from '../engine/src/gamescroll.js';
import { makeWorld } from './world.js';
import { makeBrain } from './brain.js';
import { makeBody } from './body.js';
import { Listener } from './listen.js';
import { askPlace } from './place.js';

const $ = s => document.querySelector(s);
const stage = $('#stage'), canvas = $('#view'), ctx = canvas.getContext('2d');
const input = $('#say'), form = $('#bar'), mic = $('#mic'), caption = $('#caption'), status = $('#status'), wake = $('#wake'), timing = $('#timing');
const debug = new URLSearchParams(location.search).has('debug');

let W = 0, H = 0, world, brain, body, voice, last = 0, awake = false, captionT = 0;

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
    if (voice?.listening || voice?.want) {
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
    if (awake) body.update(dt);
    world.update(dt);
    world.draw(ctx);
  } catch (e) {
    if (!e?.kitLoading) { console.error(e); setStatus('error: ' + e.message); }
  }
  requestAnimationFrame(frame);
}

async function boot() {
  fit(); addEventListener('resize', fit);
  status.textContent = 'Waking up…';
  await loadParts(['hd', 'models', 'characters', 'physics3d', 'fx3d']);
  world = makeWorld();
  await whenLoaded(() => world.reset());
  world.resize(W, H);
  brain = makeBrain({ world, onCaption: say, onStatus: setStatus, onTiming: showTiming });
  body = makeBody({ creature: world.creature, world });
  voice = new Listener();
  window.__reverie = { world, brain, body, gs };
  status.textContent = '';
  wake.hidden = false; wake.textContent = 'Tap to say hi';
  requestAnimationFrame(frame);
}

function wakeUp() {
  if (awake) return; awake = true; wake.hidden = true;
  const c = world.creature;
  c.gesture('wave'); c.mood('happy');
  const hello = "Hi, I'm Reverie! Ask me anything you like, like what the weather's up to. Or say the word and I'll magic something up for us to play with.";
  brain.speak(hello);   // (through its speaker, so the mic knows this is its voice)
  // the browser's prompts, from this tap: the microphone, then where they are (for the weather and local things)
  startListening().finally(() => askPlace());
}

async function startListening() {
  if (voice.listening) return true;
  const ok = await voice.start();
  mic.classList.toggle('on', !!ok);
  if (ok) input.placeholder = 'Listening… or type';
  else {
    input.placeholder = 'Say something, or type…';
    setStatus(voice.problem === 'denied' ? 'The microphone is off. Tap the mic to try again, or type.' : "This browser can't listen, so type instead.");
    if (voice.problem !== 'denied') mic.hidden = true;
    input.focus({ preventScroll: true });
  }
  return ok;
}

form.addEventListener('submit', e => {
  e.preventDefault();
  const text = input.value.trim(); if (!text || !brain) return;
  input.value = ''; wakeUp(); brain.hear(text, { at: performance.now() });
});
input.addEventListener('input', () => { if (input.value.length === 1) body?.notice(); if (input.value && brain?.speaking && input.value.length > 3) brain.interrupt(); });
mic.addEventListener('click', async () => {
  if (!awake) return wakeUp();   // (waking asks for the microphone itself)
  if (voice.listening || voice.want) { voice.stop(); mic.classList.remove('on'); input.placeholder = 'Say something, or type…'; return; }
  // (denied before: the browser may let it ask again, or the person has to allow it in the site settings)
  if (voice.problem === 'denied') { voice.available = true; voice.problem = null; }
  if (await startListening()) setStatus('');
});
wake.addEventListener('click', wakeUp);
canvas.addEventListener('pointerdown', e => {
  if (!world) return;
  if (!awake) return wakeUp();
  const r = canvas.getBoundingClientRect(), hit = world.tap(e.clientX - r.left, e.clientY - r.top);
  if (hit === 'creature') { body.poke(); gs.sound.sounds.boing?.(); }
  else if (hit === 'prop') world.toss();
});

boot().catch(e => { console.error(e); setStatus('error: ' + (e?.message || e)); });
