// The page: runs the stage full screen with the engine's renderer, the chat bar (type, or talk where the device can
// listen on its own), and the creature's words as a caption. Wakes the creature with the first tap, which also
// lets the page make sound.
import gs, { loadParts } from '../engine/src/gamescroll.js';
import { speed, fpsFor, tick as tickHz, screenHz } from '../engine/src/kit/speed.js';
import { makeWorld } from './world.js';
import { makeBrain } from './brain.js';
import { makeBody } from './body.js';
import { Listener, sameWords } from './listen.js';
import { askPlace, placeAt, weather } from './place.js';
import { makePad, madeFrom } from './doodle.js';
import { makeMood, toneOf } from './mood.js';
import { setTone, sayOptions } from './looks.js';
import { makeShow } from './show.js';
import { makeMemory } from './memory.js';
import { surpriseFor, briefingNote, funDay } from './daily.js';
import { makeDiary } from './diary.js';

const $ = s => document.querySelector(s);
const stage = $('#stage'), canvas = $('#view'), ctx = canvas.getContext('2d');
const input = $('#say'), form = $('#bar'), mic = $('#mic'), caption = $('#caption'), status = $('#status'), wake = $('#wake'), timing = $('#timing');
const gamebar = $('#gamebar'), gameText = $('#gamebar span'), gameButtons = $('#gamebar div');
const draw = $('#draw'), book = $('#book'), look = $('#look');
const debug = new URLSearchParams(location.search).has('debug');

let W = 0, H = 0, world, brain, body, voice, pad, diary, mood, show, last = 0, awake = false, captionT = 0, nextAt = 0;
// its diary, kept in this browser (memory.js), and today's surprise (daily.js): { surprise, holding, funDay }
const memory = makeMemory();
const today = { surprise: null, holding: null, funDay: funDay() };
let overnight = Promise.resolve(), hello = '';
// which kind of fun each of Claude's tools is, for its mood (mood.js FUN)
const FUN_OF = { make: 'make', change: 'change', toss: 'toss', place: 'place', room_colours: 'room', colours: 'colours', roll: 'roll', doodle: 'doodle', play: 'game', game_move: 'move', voice: 'voice', show: 'show' };

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
function say(line) { memory.said('me', line); caption.textContent = line; caption.hidden = false; captionT = 4 + line.length * .06; }
function showTiming(t) {
  const ms = x => x == null ? '–' : Math.round(x - t.start) + ' ms';
  // (from about when their last word was heard: the recogniser's wait, the reply's first words, then its voice)
  const line = `taken ${ms(t.heard)} · first words ${ms(t.text)} · voice ${ms(t.voice)} · first tool ${ms(t.tool)} · whole turn ${ms(t.end)}`;
  console.info('[reverie] ' + line);
  if (debug) timing.textContent = line;
}

// How long the words being heard must stand still before they are answered, without waiting for the recogniser to be
// sure the phrase is over (it often takes a second or more after the last word). If they go on, the rest joins on.
const SETTLE_MS = 650;

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
      // still going after a pause it took as the end: it stops and waits for the rest (asked again whole, not cut short)
      const early = voice.early, rest = early && heard.startsWith(early + ' ') ? brain.yours(heard.slice(early.length)) : null;
      if (rest && rest.yours.length && (brain.speaking || brain.busy)) brain.interrupt(`they went on: "${heard}"`, { rest: true });
      // talking over it: three or more words of yours, most of what was heard, stop it (less is its own voice misheard)
      // (not the words it took at a pause and is answering now: the recogniser shows them until it gives its final)
      else if (brain.speaking && !(early && sameWords(heard, early)) && deliberate(h)) brain.interrupt(`talked over by "${heard}"`);
      // words that have stood still are answered now (not while it talks: that is talking over it, above); not in a game
      // that counts what is said (Twenty Questions), where a phrase taken twice would count twice
      if (mine && !brain.speaking && !world.game?.heard) voice.settle(SETTLE_MS);
      const next = voice.next(), said = next?.text;
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
        if (ok) brain.hear(said, { more: next.more, at: next.at });
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
  warmUp();
  // a new day (and not the first ever): something it made overnight is waiting in its hands, made now while it wakes
  const visit = memory.peek();
  overnight = surpriseFor().then(async s => {
    today.surprise = s;
    if (!visit.newDay || visit.first) return;
    const r = await whenLoaded(() => world.make(s.build)).catch(() => '');
    if (world.held && /^Made/.test(r)) today.holding = world.held.short || s.build;
  }).catch(e => console.warn('[reverie] surprise', e));
  // the drawing pad: what they draw is named on the device and made real; Reverie hears what it was
  pad = makePad({ el: $('#pad'), onOpen: () => { world.creature.mood('curious'); world.creature.gesture('point'); },
    onDrawn: async guesses => { const news = await madeFrom(guesses, world); console.info('[reverie] ' + news); if (world.held) memory.note('doodle', { what: world.held.short }); brain.notice(news, true); } });
  // show and tell: a camera window; what it spots, signs and barcodes stay on the device, a press of Show sends a photo
  show = makeShow({ el: $('#show'), world, onOpen: () => { world.creature.mood('curious'); world.creature.gesture('wave'); },
    onNews: (text, loud, image, now) => {
      console.info('[reverie] ' + text.slice(0, 160));
      // (a press of Show is them talking: it answers now, even mid-sentence)
      if (now) { brain.interrupt('shown something'); brain.hear(text, { at: performance.now(), news: true, image }); } else brain.notice(text, loud, image);
    } });
  diary = makeDiary({ el: $('#diary'), memory, today: () => today, onForget: () => brain.refreshMemo() });
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
    memo: () => memory.summary(), onHeard: (text, again) => { memory.said('you', text, again); if (!again) mood.fun('chat'); },
    onTool: (name, input, r) => { noted(name, input, r); if (!r?.error && FUN_OF[name]) mood.fun(FUN_OF[name]); },
    tools: {
      window: input => world.daylight.set(input),
      doodle: async () => { pad.show(); return 'The drawing pad is open on their screen. When they press Make it!, you will hear what they drew and it appears in your hands.'; },
      remember: async input => memory.remember(input),
      forget: async input => { const r = memory.forget(input); brain.refreshMemo(); return r; },
      briefing: async () => { today.surprise ||= await surpriseFor(); return briefingNote(memory, { weather: await weatherHere(), surprise: today.surprise }); },
      show: input => show.open({ find: typeof input?.find === 'string' ? input.find : '' }),
      diary: async () => { diary.show(); return 'Your diary is open on their screen: everything you remember about them, and a way to forget any of it.'; },
    } });
  body = makeBody({ creature: world.creature, world, mood });
  world.onNews = (text, loud) => { gameNews(text); if (/^\[(chess|quiz|noughts|twenty|draw and guess|quest)/.test(text)) mood.fun(/checkmate|you win|you won|they won|last question|well played|right!|guessed it|treasure/i.test(text) ? 'win' : 'move'); brain.notice(text, loud); };
  world.onSay = line => { if (brain.busy || brain.speaking) return false; brain.speak(line); return true; };
  world.pad = pad;
  voice = new Listener({ onProblem: () => listeningOff(), onNote: debug ? line => { timing.textContent = 'mic: ' + line; } : null });
  window.__reverie = { world, brain, body, gs, voice, pad, memory, diary, today, mood, show };
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
  const c = world.creature, visit = memory.visit();
  c.gesture('wave'); c.mood('happy');
  // back after a long while: it missed them (Claude hears it with the first thing they say), and the pet runs to say hello
  if (mood.missed) {
    const d = mood.missed >= 36 ? `${Math.round(mood.missed / 24)} days` : `${Math.round(mood.missed)} hours`;
    brain.notice(`[mood] They are back after ${d} away. You missed them and are really glad to see them.`);
    world.floaties.burst({ x: 0, y: .75, z: .1 }, { n: 7 });
  }
  mood.fun('chat');
  world.keeper?.greet();
  world.daylight.sound(true);   // (the rain's patter, now the page may make sound)
  // (through its speaker, so the mic knows this is its voice): the tour the first time, after that a hello by name
  brain.speak(visit.first ? hello || pick(HELLOS) : welcome(visit));
  if (memory.birthdayToday() || [7, 30, 100].includes(memory.visits.streak) && visit.newDay) world.celebrate?.();
  // the browser's prompts, from this tap: the microphone, then where they are (for the weather and local things)
  const asked = startListening().finally(() => askPlace());
  if (visit.newDay && !visit.first) dailyBriefing(visit, asked).catch(e => console.warn('[reverie] briefing', e));
}

const pick = list => list[Math.floor(Math.random() * list.length)];

/**
 * While it wakes, everything the first exchange needs is got ready, so the first hello and the first answer don't wait:
 * its voice (on the web the engine loads it with the first line said, a few seconds the first time) with the first
 * hello written ahead, and Claude's prompt read into the API's cache (the first turn then reads it instead).
 */
function warmUp() {
  const visit = memory.peek();
  if (visit.first) hello = pick(HELLOS);
  gs.sound.prepare(hello || 'Hello again!', sayOptions()).catch(() => {});
  fetch(API_WARM, { method: 'POST' }).then(r => r.json()).then(r => console.info(`[reverie] warmed the prompt cache: ${r.ms ?? '?'} ms${r.error ? ', ' + r.error : ''}`)).catch(() => {});
}
const API_WARM = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '') + '/api/warm';

/** Its hello on a later visit: by name if it knows it, for the time of day, and a hint of the surprise on a new day. */
function welcome(visit) {
  const n = memory.name ? ', ' + memory.name : '', h = new Date().getHours();
  if (memory.birthdayToday()) return `Happy birthday${n}! Oh, this is the best day!`;
  const hi = h < 5 ? `Ooh, a midnight visit${n}!` : h < 12 ? `Good morning${n}!` : h < 17 ? `Good afternoon${n}!` : h < 22 ? `Good evening${n}!` : `Hello, night owl${n}!`;
  if (!visit.newDay) return [`Welcome back${n}!`, `Oh, you're back${n}!`, `Hello again${n}!`][Math.floor(Math.random() * 3)];
  return hi + (visit.away > 6 ? " I've missed you!" : '') + (today.holding ? ' Look what I made while you were away!' : " I've got something for you.");
}

const weatherHere = async () => placeAt() ? weather('').catch(() => null) : null;
const wait = ms => new Promise(r => setTimeout(r, ms));

/** The first visit of a day: the briefing, said by Claude after its hello (with the weather once the place is known). */
async function dailyBriefing(visit, asked) {
  await Promise.race([Promise.all([overnight, asked]), wait(7000)]);
  const wx = await Promise.race([weatherHere(), wait(4000).then(() => null)]);
  if (!today.surprise) return;
  for (let i = 0; i < 40 && brain.busy; i++) await wait(500);   // (they got talking first: after that turn)
  memory.once('surprise');
  memory.note('day', { line: today.holding ? `found ${today.holding} waiting, and ${today.surprise.show}` : `the day's surprise was ${today.surprise.show}` });
  brain.hear(briefingNote(memory, { weather: wx, surprise: today.surprise, firstToday: true, holding: today.holding, visit }), { at: performance.now(), news: true, keep: true });
}

/** A tool Claude used, for the records: things it made, and dice. */
function noted(name, input, r) {
  if (r?.error) return;
  if ((name === 'make' || name === 'change') && /^(Made|Changed)/.test(r.text) && world.held) memory.note('made', { what: world.held.short || input.words });
  else if (name === 'roll') memory.note('roll');
}

/** How a game ended, from its news (games/index.js), for the records: once a game. */
let lastEnd = '';
function gameNews(text) {
  const g = world.game, key = (g?.id || '') + ':' + (g?.round ?? '');
  let end = null;
  if (/^\[chess\]/.test(text)) end = /checkmate: they beat you/i.test(text) ? ['chess', { result: 'won' }] : /checkmate: you won/i.test(text) ? ['chess', { result: 'lost' }] : /stalemate|game is a draw/i.test(text) ? ['chess', { result: 'drawn' }] : null;
  else if (/^\[quiz\] That was the last question/.test(text)) { const m = /scored (\d+) out of (\d+)/.exec(text); if (m) end = ['quiz', { score: +m[1], of: +m[2] }]; }
  if (!end) return;
  // (the same ending can be told twice; a new round is a new game object start)
  const id = end[0] + JSON.stringify(end[1]) + key + Math.floor(performance.now() / 15000);
  if (id === lastEnd) return; lastEnd = id;
  memory.note(...end);
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
look.addEventListener('click', () => { if (!show) return; wakeUp(); if (show.open) show.close(); else show.open(); });
draw.addEventListener('click', () => { if (!pad) return; wakeUp(); if (pad.open) pad.hide(); else pad.show(); });
book.addEventListener('click', () => { if (!diary) return; if (diary.open) diary.hide(); else diary.show(); });
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
