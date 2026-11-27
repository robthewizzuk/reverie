// The page: runs the stage full screen with the engine's renderer, the chat bar (type, or talk where the device can
// listen on its own), and the creature's words as a caption. Wakes the creature with the first tap, which also
// lets the page make sound.
import gs, { loadParts } from '../engine/src/gamescroll.js';
import { speed, fpsFor, tick as tickHz, screenHz } from '../engine/src/kit/speed.js';
import { makeWorld } from './world.js';
import { makeBrain } from './brain.js';
import { makeBody } from './body.js';
import { Listener } from './listen.js';
import { askPlace } from './place.js';
import { makePad, madeFrom } from './doodle.js';
import { makeMood, toneOf } from './mood.js';
import { setTone } from './looks.js';

const $ = s => document.querySelector(s);
const stage = $('#stage'), canvas = $('#view'), ctx = canvas.getContext('2d');
const input = $('#say'), form = $('#bar'), mic = $('#mic'), caption = $('#caption'), status = $('#status'), wake = $('#wake'), timing = $('#timing');
const gamebar = $('#gamebar'), gameText = $('#gamebar span'), gameButtons = $('#gamebar div');
const draw = $('#draw');
const debug = new URLSearchParams(location.search).has('debug');

let W = 0, H = 0, world, brain, body, voice, pad, mood, last = 0, awake = false, captionT = 0, nextAt = 0;
// which kind of fun each of Claude's tools is, for its mood (mood.js FUN)
const FUN_OF = { make: 'make', change: 'change', toss: 'toss', place: 'place', room_colours: 'room', colours: 'colours', roll: 'roll', doodle: 'doodle', play: 'game', game_move: 'move', voice: 'voice' };

// What the engine's speed kit is told is being played, so the 3D view paces and tunes itself as it does for a Next Gen
// game in the app: 60 frames a second on a phone or a laptop's browser (not every refresh of a 120 Hz screen, which is
// twice the work and heat for a creature that breathes and waves), its own quality budget kept to that rate, and the
// tier and picture size it settles on remembered for next time, so it starts there instead of stuttering down again.
const REVERIE = { id: 'reverie', era: 'nextgen', title: 'Reverie' };
speed.game = REVERIE;
speed.playing = () => !document.hidden;

// The canvas's pixels: the screen's own, up to the 2.4 million the engine draws a computer's final picture at (its
// OUT_PX). The 3D is drawn at its tier's size and blown up to this, so past that a big desktop window only paid for
// a bigger upscale and finishing pass (a 1920 x 1080 window at 2x is 8.3 million), and looked no sharper.
const MOST_PX = 2.4e6;

function fit() {
  const r = stage.getBoundingClientRect();
  W = Math.round(r.width); H = Math.round(r.height);
  const dpr = Math.max(1, Math.min(2, devicePixelRatio || 1, Math.sqrt(MOST_PX / Math.max(1, W * H))));
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

/** Words heard that are clearly someone talking, not its voice coming back: 3 or more new words, most of what was heard. */
const deliberate = h => !!h && h.yours.length >= 3 && h.yours.length / Math.max(1, h.words.length) >= .5;

function frame(now) {
  requestAnimationFrame(frame);
  // frames on a steady beat at the engine's rate for it (60, or less where it has stepped down): a refresh between two
  // frames draws nothing (on a 90 Hz screen a 60 beat alternates one and two refreshes and still averages 60)
  tickHz(now);
  const step = 1000 / fpsFor(REVERIE), rf = 1000 / screenHz();
  if (now < nextAt - .4 * rf) return;
  nextAt = now - nextAt > step ? now + step : nextAt + step;
  const dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
  try {
    if (voice?.listening || voice?.want) {
      // the mic hears its voice too: only words it has not just said (or is about to say) count as yours
      const heard = voice.text.trim(), h = heard ? brain.yours(heard) : null, mine = h ? h.yours.length : 0;
      world.creature.state.listening = mine > 0;
      if (mine) input.placeholder = heard;
      // talking over it: three or more words of yours, most of what was heard, stop it (less is its own voice misheard)
      if (brain.speaking && deliberate(h)) brain.interrupt(`talked over by "${heard}"`);
      const said = voice.next();
      if (said) {
        input.placeholder = 'Say something, or type…';
        const f = brain.yours(said);
        // while it talks, only a clear new ask counts (or two or more words, none of them its own); between its sentences
        // in a reply (making something, thinking), anything with none of its words; when it is quiet, anything with
        // some words of yours ("make it bigger" after it said "make it"), and short words alone ("hi")
        const all = f.words.length > 0 && f.yours.length === f.words.length;
        const ok = brain.speaking ? deliberate(f) || (all && f.words.length >= 2)
          : brain.busy ? deliberate(f) || all
          : !f.words.length || f.yours.length / f.words.length > .3;
        if (ok) brain.hear(said);
        else { console.info(`[reverie] ignored its own voice: "${said}" (yours: ${f.yours.join(' ') || 'none'})`); if (debug) timing.textContent = 'ignored echo: ' + said; }
      }
    }
    captionT -= dt; if (captionT < 0 && !brain?.speaking) caption.hidden = true;
    if (awake) body.update(dt);
    mood.update(dt);
    const c = world.creature; c.cheer += (mood.cheer - c.cheer) * (1 - Math.exp(-dt * 1.5));   // (its body follows its mood, gently)
    brain.update();
    showGame();
    world.update(dt);
    world.draw(ctx);
  } catch (e) {
    if (!e?.kitLoading) { console.error(e); setStatus('error: ' + e.message); }
  }
}

async function boot() {
  fit(); new ResizeObserver(fit).observe(stage);   // (the stage changes size when the status line comes and goes, not only with the window)
  status.textContent = 'Waking up…';
  await loadParts(['hd', 'models', 'characters', 'physics3d', 'fx3d']);
  world = makeWorld();
  await whenLoaded(() => world.reset());
  world.resize(W, H);
  // the drawing pad: what they draw is named on the device and made real; Reverie hears what it was
  pad = makePad({ el: $('#pad'), onOpen: () => { world.creature.mood('curious'); world.creature.gesture('point'); },
    onDrawn: async guesses => { const news = await madeFrom(guesses, world); console.info('[reverie] ' + news); brain.notice(news, true); } });
  // its mood: lifted by play, shown in its body, glow and voice, and told to Claude; a level up is a little burst of hearts
  mood = makeMood({ onLevel: (level, up) => {
    console.info(`[reverie] mood: ${level}`);
    if (!up) return;
    const c = world.creature, at = c.coreAt(new gs.hd.THREE.Vector3());
    world.floaties.burst({ x: at.x, y: at.y + .3, z: at.z }, { n: 6 }); gs.sound.sounds.heart?.(); if (!c.busy) c.gesture('bounce');
  } });
  world.mood = mood; world.addLine(() => mood.line());
  world.creature.cheer = mood.cheer;
  setTone(() => toneOf(mood.cheer));
  brain = makeBrain({ world, onCaption: say, onStatus: setStatus, onTiming: showTiming,
    onTool: name => { if (FUN_OF[name]) mood.fun(FUN_OF[name]); }, onTurn: () => mood.fun('chat'),
    tools: { doodle: async () => { pad.show(); return 'The drawing pad is open on their screen. When they press Make it!, you will hear what they drew and it appears in your hands.'; } } });
  body = makeBody({ creature: world.creature, world, mood });
  world.onNews = (text, loud) => { if (/^\[(chess|quiz)/.test(text)) mood.fun(/checkmate|you win|you won|last question|well played|right!/i.test(text) ? 'win' : 'move'); brain.notice(text, loud); };
  voice = new Listener({ onProblem: () => listeningOff(), onNote: debug ? line => { timing.textContent = 'mic: ' + line; } : null });
  window.__reverie = { world, brain, body, gs, voice, pad, mood };
  requestAnimationFrame(frame);
  // every shader the room needs, built in the background before it wakes (the driver's own threads), so none is built
  // in the middle of a chat: a whole room's shaders built in one frame was a stall of a second or more
  status.textContent = 'Waking up… (getting the light ready)';
  await Promise.race([world.view.prepare(), new Promise(r => setTimeout(r, 12000))]).catch(() => {});
  status.textContent = '';
  wake.hidden = false; wake.textContent = 'Tap to say hi';
}

/** Reverie's hello, one picked each time: short, spoken aloud, and a quick tour of what it can do. */
const HELLOS = [
  "Hi, I'm Reverie! I can play chess, host a quiz, roll dice, or turn your doodles into real things. Ask me to paint the room, change my voice, or check the weather. Go on, try me!",
  "Hello, I'm Reverie! Fancy a game of chess, a quiz, or a roll of the dice? Draw me something and I'll make it real, or tell me where to put things and how to paint this place.",
  "Hey there, I'm Reverie! I magic up props, decorate the room, and play chess, quizzes and dice. I can even talk like a pirate, or tell you what the sky's up to. What shall we do?",
  "Hi! I'm Reverie, your little maker. Doodle it and I'll build it, ask and I'll paint the walls, or challenge me to chess, a quiz or the dice. I know the weather too!",
];

function wakeUp() {
  if (awake) return; awake = true; wake.hidden = true;
  const c = world.creature;
  c.gesture('wave'); c.mood('happy');
  // back after a long while: it missed them (Claude hears it with the first thing they say), and the pet runs to say hello
  if (mood.missed) {
    const d = mood.missed >= 36 ? `${Math.round(mood.missed / 24)} days` : `${Math.round(mood.missed)} hours`;
    brain.notice(`[mood] They are back after ${d} away. You missed them and are really glad to see them.`);
    world.floaties.burst({ x: 0, y: .75, z: .1 }, { n: 7 });
  }
  mood.fun('chat');
  world.keeper?.greet();
  brain.speak(HELLOS[Math.floor(Math.random() * HELLOS.length)]);   // (through its speaker, so the mic knows this is its voice)
  // the browser's prompts, from this tap: the microphone, then where they are (for the weather and local things)
  startListening().finally(() => askPlace());
}

async function startListening() {
  if (voice.listening) return true;
  const ok = await voice.start();
  mic.classList.toggle('on', !!ok);
  if (ok) input.placeholder = 'Listening… or type';
  else listeningOff();
  return ok;
}

/** Listening stopped for good (refused, or this browser's recogniser isn't working): say so, and offer typing. */
function listeningOff() {
  mic.classList.remove('on');
  input.placeholder = 'Type to Reverie…';
  const p = voice.problem;
  setStatus(p === 'denied' ? 'The microphone is off. Tap the mic to try again, or type.'
    : p === 'broken' ? "Listening isn't working in this browser, so type instead. Tap the mic to try again."
    : "This browser can't listen, so type instead.");
  if (p === 'unavailable') mic.hidden = true;
  input.focus({ preventScroll: true });
}

form.addEventListener('submit', e => {
  e.preventDefault();
  const text = input.value.trim(); if (!text || !brain) return;
  input.value = ''; wakeUp(); brain.hear(text, { at: performance.now() });
});
input.addEventListener('input', () => { speed.inputAt = performance.now(); if (input.value.length === 1) body?.notice(); if (input.value && brain?.speaking && input.value.length > 3) brain.interrupt(); });
mic.addEventListener('click', async () => {
  if (!awake) return wakeUp();   // (waking asks for the microphone itself)
  if (voice.listening || voice.want) { voice.stop(); mic.classList.remove('on'); input.placeholder = 'Say something, or type…'; return; }
  // (denied before: the browser may let it ask again, or the person has to allow it in the site settings)
  // ('broken': try every way again from the top)
  if (voice.problem === 'denied' || voice.problem === 'broken') { if (voice.problem === 'broken') voice.way = voice.firstWay; voice.available = true; voice.problem = null; }
  if (await startListening()) setStatus('');
});
wake.addEventListener('click', wakeUp);
draw.addEventListener('click', () => { if (!pad) return; wakeUp(); if (pad.open) pad.hide(); else pad.show(); });
canvas.addEventListener('pointerdown', e => {
  speed.inputAt = performance.now();
  if (!world) return;
  if (!awake) return wakeUp();
  const r = canvas.getBoundingClientRect(), hit = world.tap(e.clientX - r.left, e.clientY - r.top);
  if (hit === 'game') return;
  if (hit === 'creature') { body.poke(); mood.fun('poke'); gs.sound.sounds.boing?.(); }
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
