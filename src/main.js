// The page: runs the stage full screen with the engine's renderer, the chat bar (type, or talk where the device can
// listen on its own), and the creature's words as a caption. Wakes the creature with the first tap, which also
// lets the page make sound.
import gs, { loadParts } from '../engine/src/gamescroll.js';
import { speed, fpsFor, tick as tickHz, screenHz } from '../engine/src/kit/speed.js';
import { audio } from '../engine/src/sfx.js';
import { makeWorld } from './world.js';
import { makeLook } from './look.js';
import { makeBrain } from './brain.js';
import { makeBody } from './body.js';
import { Listener, sameWords } from './listen.js';
import { askPlace, placeAt, weather, contextLine } from './place.js';
import { makePad, madeFrom } from './doodle.js';
import { makeMood, toneOf } from './mood.js';
import { setTone, echoNow } from './looks.js';
import { makeShow } from './show.js';
import { makeMemory } from './memory.js';
import { surpriseFor, briefingNote, funDay } from './daily.js';
import { makeDiary } from './diary.js';
import { makeShaker } from './fun.js';
import { makeMusic } from './music.js';
import { makeHelpers, reportOf } from './helpers.js';
import { makeWisps } from './helper-wisps.js';
import { makeGoogle } from './google.js';
import { makeLearning } from './learn.js';
import { useLearning } from './games/lesson.js';
import { makeReminders } from './reminders.js';
import { makeTimers } from './timers.js';
import { makeRecapper } from './recap.js';
import { makeShop } from './shop.js';
import { makeAchievements, ICONS } from './achievements.js';
import { playCue } from './sounds.js';
import { makeTrophies } from './trophies.js';
import { roomColours } from './room.js';
import { makeGarden } from './garden.js';
import { makeWatch, makeWatchSheet, videoOf } from './watch.js';
import { makeKaraoke } from './karaoke.js';
import { makeLyrics } from './lyrics.js';
import { makeAquarium } from './aquarium.js';
import { makeCapsules } from './capsule.js';
import { makeStorytime } from './storytime.js';
import { makeJam } from './jam.js';

const $ = s => document.querySelector(s);
const stage = $('#stage'), canvas = $('#view'), ctx = canvas.getContext('2d');
const input = $('#say'), form = $('#bar'), mic = $('#mic'), caption = $('#caption'), status = $('#status'), wake = $('#wake'), timing = $('#timing');
const gamebar = $('#gamebar'), gameText = $('#gamebar span'), gameButtons = $('#gamebar div');
const draw = $('#draw'), book = $('#book'), look = $('#look'), recentre = $('#recentre'), helperList = $('#helpers'), tv = $('#tv');
const debug = new URLSearchParams(location.search).has('debug');

let W = 0, H = 0, world, brain, body, voice, pad, diary, mood, show, shaker, music, helpers, wisps, google, timers, shop, trophies, garden, watch, karaoke, aquarium, capsules, storytime, jam, last = 0, awake = false, captionT = 0, nextAt = 0;
// its diary, kept in this browser (memory.js), and today's surprise (daily.js): { surprise, holding, funDay }
const memory = makeMemory();
// what you are learning together (learn.js), kept beside the diary; the lessons write their days in the diary too
const learning = makeLearning();
useLearning(learning, { onDay: line => memory.note('day', { line }) });
// reminders and timers, kept in this browser too (reminders.js), with their chips, chime and notifications (timers.js)
const reminders = makeReminders();
// (now and then the chat is boiled down into the diary: recap.js)
const recapper = makeRecapper({ memory });
// its badges, kept in this browser too (achievements.js), and their trophies on the shelf (trophies.js)
const achievements = makeAchievements();
const today = { surprise: null, holding: null, funDay: funDay() };
let overnight = Promise.resolve();
// which kind of fun each of Claude's tools is, for its mood (mood.js FUN)
const FUN_OF = { make: 'make', change: 'change', toss: 'toss', place: 'place', room_colours: 'room', colours: 'colours', roll: 'roll', doodle: 'doodle', play: 'game', game_move: 'move', voice: 'voice', show: 'show', smash: 'smash', effect: 'effect', music: 'music', dance: 'dance', teach: 'game', wear: 'wear', watch: 'watch', karaoke: 'game', garden: 'plant', aquarium: 'aquarium', capsule: 'capsule', story: 'story', jam: 'jam' };

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

// On a computer, the 3D is drawn at that size itself, not at a phone's budget for its quality level and blown up to it.
// The engine's levels are sized for a phone's screen (high: 1.3 million pixels), so a laptop's 2.4 million pixel window
// had its 3D drawn with about half the pixels and upscaled, and the upscaler, which builds each frame on the last ones,
// stepped along the edges of a body that is always breathing and swaying: jagged outlines, and a dotted ring round the
// core under its glass. One creature in one room is light work for a computer's graphics chip; if it can't keep up, the
// engine still steps the size down, then the level, as it does for any game (and medium and low keep their own sizes).
// Phones and tablets keep the engine's sizes: their screens are about a level's size already, and there the heat
// counts. ?crisp tries it anywhere.
const COMPUTER = matchMedia('(any-pointer: fine)').matches && !matchMedia('(pointer: coarse)').matches;
const CRISP = COMPUTER || new URLSearchParams(location.search).has('crisp');
// (the engine's 3D loads on first use, so its levels are reached once it has: boot)
// (?direct: a test browser shows the 3D canvas itself as a real one does, instead of copying each frame onto the page's
// canvas, a read back from the chip that is slow in software and made timings say nothing: tests/startup.mjs)
const DIRECT = new URLSearchParams(location.search).has('direct');
const crisp = async () => { const { HD } = await import('../engine/src/kit/hd3d.js'); if (CRISP) HD.leastPx = MOST_PX; if (DIRECT) HD.direct = true; };

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
      // (and while a video plays, it hears the video: that is neither you nor its voice: watch.js)
      const heard = voice.text.trim(), film = !!heard && watch.isVideo(heard), h = heard && !film ? brain.yours(heard) : null, mine = h ? h.yours.length : 0;
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
      const next = voice.next(); let said = next?.text;
      if (said && watch.isVideo(said)) { watch.overheard(said); said = null; }
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
        if (ok && karaoke && !karaoke.heardOk(said)) console.info(`[reverie] a song is on: took "${said}" for singing (say Reverie's name, or stop)`);
        else if (ok && music && !music.heardOk(said)) console.info(`[reverie] music is on: took "${said}" for a lyric (say Reverie's name, or a music command)`);
        else if (ok) brain.hear(said, { more: next.more, at: next.at });
        else { console.info(`[reverie] ignored its own voice: "${said}" (yours: ${f.yours.join(' ') || 'none'})`); if (debug) timing.textContent = 'ignored echo: ' + said; }
      }
    }
    captionT -= dt; if (captionT < 0 && !brain?.speaking) caption.hidden = true;
    if (awake) { body.update(dt); shaker?.update(dt); }
    music.update(dt);
    karaoke.update(dt);
    jam?.update(dt);
    mood.update(dt);
    trophies?.update(dt);
    const c = world.creature; c.cheer += (mood.cheer - c.cheer) * (1 - Math.exp(-dt * 1.5));   // (its body follows its mood, gently)
    brain.update();
    showGame();
    if (recentre.hidden === looking.moved) recentre.hidden = !looking.moved;
    canvas.classList.toggle('looking', looking.dragging);
    world.update(dt);
    wisps?.update(dt); helpers?.tell();
    garden?.update(dt);
    aquarium?.update(dt);
    capsules?.update(dt);
    watch.update(dt);
    if (!document.hidden) world.draw(ctx);
  } catch (e) {
    if (!e?.kitLoading) { console.error(e); setStatus('error: ' + e.message); }
  }
}

async function boot() {
  fit(); new ResizeObserver(fit).observe(stage);   // (the stage changes size when the status line comes and goes, not only with the window)
  status.textContent = 'Waking up…';
  await loadParts(['hd', 'models', 'characters', 'physics3d', 'fx3d']);
  await crisp();
  world = makeWorld();
  await whenLoaded(() => world.reset());
  world.resize(W, H);
  world.look = looking;
  warmUp();
  trophies = makeTrophies({ gs, scene: world.view.scene, creature: world.creature, sparks: world.sparks, wood: roomColours().wood });
  trophies.show(achievements.earned());
  world.achievements = achievements;   // (for features that track their own: world.achievements.track('garden:plant'))
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
    onDrawn: async guesses => { const news = await madeFrom(guesses, world); console.info('[reverie] ' + news); if (world.held) { memory.note('doodle', { what: world.held.short }); achievements.track('doodle'); achievements.track('make'); } brain.notice(news, true); } });
  // show and tell: a camera window; what it spots, signs and barcodes stay on the device, a press of Show sends a photo
  show = makeShow({ el: $('#show'), world, onOpen: () => { world.creature.mood('curious'); world.creature.gesture('wave'); },
    onNews: (text, loud, image, now) => {
      console.info('[reverie] ' + text.slice(0, 160));
      // (a press of Show is them talking: it answers now, even mid-sentence)
      if (now) { achievements.track('show'); brain.interrupt('shown something'); brain.hear(text, { at: performance.now(), news: true, image }); } else brain.notice(text, loud, image);
    } });
  // shopping: a helper looks across UK shops, the offers come back as cards; buying is always their own tap through
  // (its results are said as soon as Reverie is free, however long that takes: a helper can come back mid-chat)
  shop = makeShop({ el: $('#shop'), world, onNews: async (text, loud) => {
    console.info('[reverie] ' + text.slice(0, 160));
    if (!loud) return brain.notice(text, false);
    for (let t = 0; t < 120 && (brain.busy || brain.speaking || world.creature.state.listening); t++) await new Promise(r => setTimeout(r, 500));
    brain.hear(text, { at: performance.now(), news: true });
  } });
  // Gmail and the calendar: read when asked; sending an email or adding an event only on a tap of Yes on its card
  google = makeGoogle({ el: $('#ask'), onNews: (text, loud) => { console.info('[reverie] ' + text); brain.notice(text, loud); } });
  google.check();
  diary = makeDiary({ el: $('#diary'), memory, achievements, today: () => today, google, extra: () => lessonsHtml(learning),
    onForget: what => { if (what === 'everything') { learning.wipe(); achievements.wipe(); trophies.show([]); } else if (what.startsWith('lesson:')) learning.forget(what.slice(7)); brain.refreshMemo(); } });
  learning.onChange(() => { if (diary.open) diary.show(); });
  // its mood: lifted by play, shown in its body, glow and voice, and told to Claude; a level up is a little burst of hearts
  mood = makeMood({ onLevel: (level, up) => {
    console.info(`[reverie] mood: ${level}`);
    if (up && level === 'overjoyed') achievements.track('overjoyed');
    if (!up) return;
    const c = world.creature, at = c.coreAt(new gs.hd.THREE.Vector3());
    world.floaties.burst({ x: at.x, y: at.y + .3, z: at.z }, { n: 6 }); gs.sound.sounds.heart?.(); if (!c.busy) c.gesture('bounce');
  } });
  world.mood = mood; world.addLine(() => mood.line());
  // music and dancing (music.js): Spotify plays, the mic hears the beat, and it dances
  music = makeMusic({ world, el: $('#music'), onNews: (text, loud) => brain?.notice(text, loud) });
  world.addLine(() => music.line());
  // its helpers (helpers.js): little agents it sends off to look into things, shown as wisps over its head and pills on
  // the stage; one that comes back is passed to Claude as news when Reverie is free, to tell you in its own words
  wisps = makeWisps({ scene: world.view.scene, creature: world.creature, floaties: world.floaties });
  helpers = makeHelpers({
    ready: () => awake && !!brain && !brain.busy && !brain.speaking && !world.creature.state.listening,
    onReport: h => { brain.hear(reportOf(h), { at: performance.now(), news: true }); if (h.status !== 'failed') mood.fun('chat'); return true; },
    context: () => contextLine().replace(/^\[From the device, not said aloud: |\]$/g, ''),
    onChange: list => { wisps.show(list); showHelpers(list); },
  });
  wisps.show(helpers.list); showHelpers(helpers.list);
  world.addLine(() => helpers.line());
  // karaoke (karaoke.js): it sings with the band, the words light up on screen, a mirror ball comes down; and the words
  // of their own Spotify songs, from LRC files they add with the mic button on the music bar (lyrics.js)
  karaoke = makeKaraoke({ world, el: $('#karaoke'), music, lyrics: makeLyrics(), memory, echo: echoNow, onNews: (text, loud) => brain?.notice(text, loud) });
  world.addLine(() => karaoke.line());
  jam = makeJam({ world, el: $('#jam'), music, karaoke, onNews: (text, loud) => brain?.notice(text, loud) });
  world.addLine(() => jam.line());
  $('#karaoke [data-id="stop"]')?.addEventListener('click', () => { const was = karaoke.tools.karaoke({ action: 'stop' }); was.then(t => brain?.notice(`[karaoke] They pressed stop. ${t}`, false)); });
  const lrc = $('#lrc');
  $('#music')?.addEventListener('click', e => { if (e.target.closest('button')?.dataset.id === 'lyrics') lrc?.click(); });
  lrc?.addEventListener('change', async () => { const f = lrc.files?.[0]; lrc.value = ''; if (f) brain?.notice(await karaoke.lyricsFor(f), true); });
  world.creature.cheer = mood.cheer;
  setTone(() => toneOf(mood.cheer));
  brain = makeBrain({ world, onCaption: say, onStatus: setStatus, onTiming: showTiming,
    memo: () => [memory.summary(), learning.summary(), achievements.summary()].filter(Boolean).join('\n'), context: () => watch?.context() || '', onHeard: (text, again) => { memory.said('you', text, again); recapper.poke(); if (!again) mood.fun('chat'); timers?.heard(); },
    onTool: (name, input, r) => { noted(name, input, r); earned(name, input, r); if (!r?.error && FUN_OF[name]) mood.fun(FUN_OF[name]); },
    tools: {
      window: input => world.daylight.set(input),
      doodle: async () => { if (world.game?.id === 'draw_and_guess') return { text: 'Not opened: the drawing pad is already in use for Draw and Guess.', error: true }; pad.show(); return 'The drawing pad is open on their screen. When they press Make it!, you will hear what they drew and it appears in your hands.'; },
      remember: async input => memory.remember(input),
      recall: async input => memory.recall(input),
      forget: async input => {
        // (lessons are kept in their own book: "forget my Spanish lessons", or everything)
        const lessons = /\b(lessons?|learning|learned|learnt|studies|words)\b/i.test(input.what || '') ? learning.forget(input.what) : '';
        if (/^\s*(everything|all|it all|all of it|everything about me|the whole diary|your whole diary)\s*$/i.test(input.what || '')) learning.wipe();
        const r = lessons ? `Forgot ${lessons}. They are gone from the diary.` : memory.forget(input);
        brain.refreshMemo(); return r;
      },
      teach: async input => {
        if (input.action === 'start') return world.play('lesson', { topic: input.topic, language: input.language, level: input.level });
        return world.game?.id === 'lesson' ? world.game.teach(input) : { text: 'No lesson is on: start one with action start and a topic first.', error: true };
      },
      briefing: async () => { today.surprise ||= await surpriseFor(); const [wx, day] = await Promise.all([weatherHere(), googleDay()]); return briefingNote(memory, { weather: wx, surprise: today.surprise, google: day, capsules: capsules?.briefingLine() }); },
      calendar: input => google.calendar(input),
      email: input => google.email(input),
      show: input => show.open({ find: typeof input?.find === 'string' ? input.find : '' }),
      effect: input => world.show(input.kind),
      smash: input => world.smash(input.how),
      ...music.tools,
      send_helper: input => helpers.send(input),
      helpers: input => helpers.manage(input),
      shop: input => shop.tool(input || {}),
      badges: async () => achievements.report(),
      karaoke: async input => { if (input?.action !== 'stop' && input?.action !== 'list' && jam?.playing) jam.stop(); return karaoke.tools.karaoke(input); },
      ...jam.tools,
      diary: async () => { diary.show(); return 'Your diary is open on their screen: everything you remember about them, and a way to forget any of it.'; },
      reminder: input => timers.tool(input),
      garden: input => garden.command(input),
      aquarium: input => aquarium.command(input),
      capsule: input => capsules.command(input),
      story: input => storytime.command(input),
      watch: input => watch.command(input),
    } });
  // reminders and timers: chips on the stage, a chime and Reverie saying so when one goes off (once it is free to talk)
  world.addLine(() => reminders.line());
  timers = makeTimers({ el: $('#timers'), reminders,
    canTalk: () => awake && !brain.busy && !brain.speaking && !world.creature.state.listening,
    announce: text => brain.hear(text, { at: performance.now(), news: true }),
    onRing: () => { const c = world.creature; if (!c.busy) c.gesture('wave'); c.mood('excited'); const at = c.coreAt(new gs.hd.THREE.Vector3()); world.floaties.burst({ x: at.x, y: at.y + .3, z: at.z }, { n: 4 }); } });
  body = makeBody({ creature: world.creature, world, mood });
  // the phone in their hands (fun.js): shaken, it gets dizzy and Claude hears of it; tilted, things on the floor roll
  shaker = makeShaker({ world: world.physics, creature: world.creature, floaties: world.floaties, floor: world.floorBodies, pet: () => world.keeper,
    onShaken: strength => { mood.fun('shake'); if (!world.game) brain.notice(`[phone] They just shook the phone ${strength > 220 ? 'really hard' : 'about'}: you are dizzy, and everything on the floor bounced.`, true); } });
  // its windowsill garden (garden.js): plants that grow over real days, watered by asking or by a tap on the pot
  garden = makeGarden({ world, onNews: (text, loud) => brain.notice(text, loud) });
  world.addLine(() => garden.line());
  // mini desk aquarium (aquarium.js), time capsule jars on the shelf (capsule.js), and bedtime storytime (storytime.js)
  aquarium = makeAquarium({ world, onNews: (text, loud) => brain.notice(text, loud) });
  world.addLine(() => aquarium.line());
  capsules = makeCapsules({ world, memory, onNews: (text, loud) => brain.notice(text, loud) });
  world.addLine(() => capsules.line());
  storytime = makeStorytime({ world, memory, onNews: (text, loud) => brain.notice(text, loud) });
  world.addLine(() => storytime.line());
  // watching a video together: a screen in the room; only words about it (title, captions) ever reach Claude
  const sheet = makeWatchSheet({ el: $('#watching'), onPick: v => { wakeUp(); startWatching(v); } });
  watch = makeWatch({ host: $('#screen'), sheet, world, memory, state: () => ({ speaking: brain.speaking, busy: brain.busy, listening: world.creature.state.listening }),
    onOpen: () => { pad?.hide(); if (show?.isOpen) show.close(); diary?.hide(); },
    onNews: (text, loud) => brain.notice(text, loud) });
  world.onNews = (text, loud) => { gameNews(text); gameBadges(text); if (/^\[(chess|quiz|noughts|twenty|draw and guess|quest|lesson|escape|cards|words)/.test(text)) mood.fun(/checkmate|you win|you won|they won|last question|well played|right!|guessed it|treasure|you escaped|spot on|solved/i.test(text) ? 'win' : 'move'); brain.notice(text, loud); };
  world.onSay = line => { if (brain.busy || brain.speaking) return false; brain.speak(line); return true; };
  world.pad = pad;
  voice = new Listener({ onProblem: () => listeningOff(), onNote: debug ? line => { timing.textContent = 'mic: ' + line; } : null });
  // (which games they play most, for the diary's habits)
  const play0 = world.play.bind(world);
  world.play = (game, o) => { memory.note('play', { game }); return play0(game, o); };
  window.__reverie = { world, brain, body, gs, voice, pad, memory, learning, diary, today, mood, show, shaker, music, helpers, google, reminders, timers, recapper, shop, achievements, trophies, garden, aquarium, capsules, storytime, watch, karaoke, jam };
  achievements.onUnlock(celebrateBadge);
  // its voice (about 48 MB the first time, then from the cache) loaded and its hello written while the light gets
  // ready, so the tap is answered at once: the web version of the engine otherwise loads it with the first line, and
  // a first visit's hello waited for the whole download (and went unsaid past 9 seconds)
  const seen = memory.peek();
  (seen.newDay && !seen.first ? Promise.race([overnight, wait(8000)]) : Promise.resolve())
    .then(() => { if (!awake) return brain.prepare(helloFor(seen)).then(ok => console.info(`[reverie] hello ${ok ? 'ready' : 'not written ahead'}`)); });
  requestAnimationFrame(frame);
  // every shader the room needs, built in the background (the driver's own threads), so none is built in the middle of
  // a chat: a whole room's shaders built in one frame was a stall of a second or more. It may be woken once everything
  // in view is drawn: the shaders of what isn't in view yet (the games' tables, the dice, what's behind the camera) go
  // on being built after, a few at a time, and anything shown before its shader is ready waits hidden a frame or two
  status.textContent = 'Waking up… (getting the light ready)';
  const t = performance.now();
  await Promise.race([world.view.prepare(), inView(world.view), wait(12000)]).catch(() => {});
  // (how long it took, in the console, and on screen with ?debug: test browsers draw in software, so only a real
  // device's numbers say how long the wait is)
  const line = `ready to wake in ${(performance.now() / 1000).toFixed(1)} s (the light ${((performance.now() - t) / 1000).toFixed(1)} s of it${world.view.ready ? '' : ', the rest of the shaders still building'})`;
  console.info('[reverie] ' + line); if (debug) timing.textContent = line;
  status.textContent = '';
  wake.hidden = false; wake.textContent = 'Tap to say hi';
}

/** Resolves once the frames show everything in view: drawn a few times running with nothing held back for its shader. */
function inView(v) {
  return new Promise(res => {
    let n = 0;
    const look = () => { n = v.drawnAt && !(gs.hd.HD.info.held > 0) ? n + 1 : 0; if (n >= 3) res(); else setTimeout(look, 150); };
    look();
  });
}

/** Reverie's hello, one picked each time: short, spoken aloud, and a quick tour of what it can do. */
const HELLOS = [
  "Hi, I'm Reverie! I can play chess, host a quiz, roll dice, or turn your doodles into real things. Ask me to paint the room, change my voice, or check the weather. Go on, try me!",
  "Hello, I'm Reverie! Fancy a game of chess, a quiz, or a roll of the dice? Draw me something and I'll make it real, or tell me where to put things and how to paint this place.",
  "Hey there, I'm Reverie! I magic up props, decorate the room, and play chess, quizzes and dice. I can even talk like a pirate, or tell you what the sky's up to. What shall we do?",
  "Hi! I'm Reverie, your little maker. Doodle it and I'll build it, ask and I'll paint the walls, or challenge me to chess, a quiz or the dice. I know the weather too!",
];

// (picked once a visit, so the hello written ahead while it wakes is the one it says)
const PICK = Math.random();
/** What it says when woken: the tour the first time, after that a hello by name. */
const helloFor = visit => visit.first ? HELLOS[Math.floor(PICK * HELLOS.length)] : welcome(visit);

function wakeUp() {
  if (awake) return; awake = true; wake.hidden = true;
  audio();   // (the page's sound started in the tap itself: a phone keeps it silent if it's only asked for later)
  const c = world.creature, visit = memory.visit();
  visited();
  c.gesture('wave'); c.mood('happy');
  // back after a long while: it missed them (Claude hears it with the first thing they say), and the pet runs to say hello
  if (mood.missed) {
    const d = mood.missed >= 36 ? `${Math.round(mood.missed / 24)} days` : `${Math.round(mood.missed)} hours`;
    brain.notice(`[mood] They are back after ${d} away. You missed them and are really glad to see them.`);
    world.floaties.burst({ x: 0, y: .75, z: .1 }, { n: 7 });
  }
  mood.fun('chat');
  world.keeper?.greet();
  garden.greet();   // (what grew, or wants a drink, while they were away)
  aquarium?.greet();
  world.daylight.sound(true);   // (the rain's patter, now the page may make sound)
  // (through its speaker, so the mic knows this is its voice): the tour the first time, after that a hello by name
  brain.speak(helloFor(visit));
  if (memory.birthdayToday() || [7, 30, 100].includes(memory.visits.streak) && visit.newDay) world.celebrate?.();
  // the browser's prompts, from this tap: the microphone, then where they are (for the weather and local things)
  const asked = startListening().finally(() => askPlace());
  if (visit.newDay && !visit.first) dailyBriefing(visit, asked).catch(e => console.warn('[reverie] briefing', e));
}

/**
 * While it wakes, Claude's prompt is read into the API's cache, so the first answer doesn't wait (the first turn then
 * reads it instead). Its voice and the hello are got ready in boot, once the brain is made.
 */
function warmUp() {
  fetch(API_WARM, { method: 'POST' }).then(r => r.json()).then(r => console.info(`[reverie] warmed the prompt cache: ${r.ms ?? '?'} ms${r.error ? ', ' + r.error : ''}`)).catch(() => {});
}
const API_WARM = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '') + '/api/warm';

/** Its hello on a later visit: by name if it knows it, for the time of day, and a hint of the surprise on a new day. */
function welcome(visit) {
  const n = memory.name ? ', ' + memory.name : '', h = new Date().getHours();
  if (memory.birthdayToday()) return `Happy birthday${n}! Oh, this is the best day!`;
  const hi = h < 5 ? `Ooh, a midnight visit${n}!` : h < 12 ? `Good morning${n}!` : h < 17 ? `Good afternoon${n}!` : h < 22 ? `Good evening${n}!` : `Hello, night owl${n}!`;
  if (!visit.newDay) return [`Welcome back${n}!`, `Oh, you're back${n}!`, `Hello again${n}!`][Math.floor(PICK * 3)];
  return hi + (visit.away > 6 ? " I've missed you!" : '') + (today.holding ? ' Look what I made while you were away!' : " I've got something for you.");
}

const weatherHere = async () => placeAt() ? weather('').catch(() => null) : null;
/** Today's calendar and new email, for the briefing ('' when Google isn't connected, or after 4 seconds). */
const googleDay = () => Promise.race([google.briefing().catch(() => ''), wait(4000).then(() => '')]);
const wait = ms => new Promise(r => setTimeout(r, ms));

/** The first visit of a day: the briefing, said by Claude after its hello (with the weather once the place is known). */
async function dailyBriefing(visit, asked) {
  await Promise.race([Promise.all([overnight, asked]), wait(7000)]);
  const [wx, day] = await Promise.all([Promise.race([weatherHere(), wait(4000).then(() => null)]), googleDay()]);
  if (!today.surprise) return;
  for (let i = 0; i < 40 && brain.busy; i++) await wait(500);   // (they got talking first: after that turn)
  memory.once('surprise');
  memory.note('day', { line: today.holding ? `found ${today.holding} waiting, and ${today.surprise.show}` : `the day's surprise was ${today.surprise.show}` });
  brain.hear(briefingNote(memory, { weather: wx, surprise: today.surprise, firstToday: true, holding: today.holding, visit, google: day, capsules: capsules?.briefingLine() }), { at: performance.now(), news: true, keep: true });
}

/** The diary sheet's section on what you are learning together (learn.js): each subject, its words, and a ✕ for it. */
function lessonsHtml(book) {
  const subs = book.list(); if (!subs.length) return '';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<section><h3>Learning together</h3><ul class="facts">${subs.map(s => {
    const due = s.kind === 'language' ? book.due(s.name, 99).length : 0;
    const bits = [`${s.lessons} lesson${s.lessons === 1 ? '' : 's'}`, s.quiz.asked ? `quiz ${s.quiz.right}/${s.quiz.asked}` : '', s.words.length ? `${s.words.length} words${due ? `, ${due} to review` : ''}` : ''].filter(Boolean).join(' · ');
    const more = s.kind === 'language' && s.words.length ? s.words.slice(-10).map(w => `${w.word} (${w.meaning})`).join(', ') : s.points.slice(-4).join(' · ');
    return `<li><span><b>${esc(s.name)}</b> · ${esc(bits)}${more ? `<br><small>${esc(more)}</small>` : ''}${s.next ? `<br><small>Next time: ${esc(s.next)}</small>` : ''}</span><button type="button" data-unlearn="${esc(s.name)}" aria-label="Forget these lessons">✕</button></li>`;
  }).join('')}</ul></section>`;
}

/** A tool Claude used, for the records: things it made, and dice. */
function noted(name, input, r) {
  if (r?.error) return;
  if ((name === 'make' || name === 'change') && /^(Made|Changed)/.test(r.text) && world.held) memory.note('made', { what: world.held.short || input.words });
  else if (name === 'roll') memory.note('roll');
}

// ---- badges: what earns them, and the fuss when one is

/** A tool Claude used, for the badges. */
function earned(name, input = {}, r) {
  if (r?.error) return;
  const text = typeof r === 'string' ? r : r?.text || '';
  const A = achievements;
  if ((name === 'make' || name === 'change') && /^(Made|Changed)/.test(text)) A.track('make');
  else if (name === 'place' && /^Carried/.test(text)) A.track('place');
  else if (name === 'room_colours') A.track('paint');
  else if (name === 'colours') A.track('colours');
  else if (name === 'roll') A.track('roll');
  else if (name === 'window' && !/\blive\b/i.test(JSON.stringify(input))) A.track('sky');
  else if (name === 'pet' && input.action === 'make' && /^Made/.test(text)) A.track('pet');
  else if (name === 'remember' && input.name) A.track('name');
  else if (name === 'voice') A.track('voices', { add: [input.name, input.effect, input.accent].filter(x => x && x !== 'none').join(' ') || 'own' });
  else if (name === 'play' && input.game && !/could not start|no game called/i.test(text)) { A.track('game'); A.track('games', { add: input.game }); }
  if (/They got it!|They guessed it/.test(text)) A.track('win:twenty');
}

/** A game's news, for the badges: who won, and quiz scores. */
let badgeKey = '';
function gameBadges(text) {
  let ev = null;
  if (/^\[chess\].*checkmate: they beat you/i.test(text)) ev = ['win:chess'];
  else if (/^\[noughts\].*They won this round/.test(text)) ev = ['win:noughts'];
  else if (/^\[quest\].*they won the quest/i.test(text)) ev = ['win:quest'];
  else if (/^\[draw and guess\].*you guessed it in/.test(text)) ev = ['guessed'];
  else if (/^\[quiz\] That was the last question/.test(text)) { const m = /scored (\d+) out of (\d+)/.exec(text); if (m) ev = ['quiz', { best: Math.round(+m[1] * 10 / +m[2]), count: true }]; }
  if (!ev) return;
  // (the same news told twice in a moment is one win)
  const key = text.slice(0, 120) + Math.floor(performance.now() / 10000);
  if (key === badgeKey) return; badgeKey = key;
  achievements.track(...ev);
}

/** This visit, for the badges: days in a row, days together, and the time of day. */
function visited() {
  const v = memory.visits, h = new Date().getHours();
  achievements.track('streak', { at: v.streak }); achievements.track('days', { at: v.days });
  if (h < 4) achievements.track('night'); else if (h >= 5 && h < 7) achievements.track('dawn');
}

/** A new badge: a trophy pops up and flies to the shelf, confetti, a fanfare, a card on screen, and Reverie cheers. */
const badgeQueue = [];
function celebrateBadge(a) {
  badgeQueue.push(a); if (badgeQueue.length > 1) return;
  (async () => {
    while (badgeQueue.length) {
      const b = badgeQueue[0];
      console.info(`[reverie] badge: ${b.title}`);
      trophies.award(b, achievements.earned());
      world.celebrate?.(); playCue(b.tier === 'gold' ? 'fanfare' : 'level_up');
      toast(b);
      memory.note('day', { line: `earned the ${b.title} badge` });
      brain.notice(achievements.line(b), true);
      await wait(3400);
      badgeQueue.shift();
    }
  })();
}

/** The badge card that slides down from the top for a few seconds. */
let toastEl = null;
function toast(a) {
  toastEl ||= Object.assign(document.createElement('div'), { id: 'badge-toast', role: 'status' });
  if (!toastEl.isConnected) stage.append(toastEl);
  toastEl.className = 'tier-' + a.tier;
  toastEl.innerHTML = `<span class="medal" aria-hidden="true">${ICONS[a.family] || '🏆'}</span><span><b></b><small></small></span>`;
  toastEl.querySelector('b').textContent = a.title; toastEl.querySelector('small').textContent = `You ${a.about}!`;
  toastEl.classList.remove('show'); void toastEl.offsetWidth; toastEl.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove('show'), 4200);
}

/** A tap on a trophy on the shelf: what it was for, as a caption. */
let trophyRay = null;
function tapTrophy(x, y) {
  if (!trophies) return false;
  trophyRay ||= new gs.hd.THREE.Raycaster();
  const ndc = new gs.hd.THREE.Vector2(x / W * 2 - 1, -(y / H) * 2 + 1);
  trophyRay.setFromCamera(ndc, world.view.cam);
  const b = trophies.hit(trophyRay); if (!b) return false;
  const got = achievements.earned().find(x => x.id === b.id);
  caption.textContent = `${b.title}: you ${b.about}${got?.day ? ` (${new Date(got.day + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})` : ''}.`;
  caption.hidden = false; captionT = 4;
  gs.sound.sounds.bell?.();
  return true;
}

/** How a game ended, from its news (games/index.js), for the records: once a game. */
let lastEnd = '';
function gameNews(text) {
  const g = world.game, key = (g?.id || '') + ':' + (g?.round ?? '');
  let end = null;
  if (/^\[chess\]/.test(text)) { const level = g?.level; end = /checkmate: they beat you/i.test(text) ? ['chess', { result: 'won', level }] : /checkmate: you won/i.test(text) ? ['chess', { result: 'lost', level }] : /stalemate|game is a draw/i.test(text) ? ['chess', { result: 'drawn', level }] : null; }
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

form.addEventListener('submit', async e => {
  e.preventDefault();
  let text = input.value.trim(); if (!text || !brain) return;
  const at = performance.now();
  input.value = ''; wakeUp();
  // a YouTube link: it goes up on the screen at once, and Claude hears it is on
  const v = videoOf(text);
  if (v) {
    const r = await watch.open(v);
    text += `\n(The video was put on the screen straight away when they pasted it: ${typeof r === 'string' ? r : r.text} Don't call watch open; just react.)`;
    return brain.hear(text, { at });
  }
  brain.hear(text, { at });
});

/** A video picked on the sheet (a link or a file): on the screen now, and Reverie told it's on. */
async function startWatching(v) {
  const r = await watch.open(v);
  brain.hear(`[watch] They picked ${v.kind === 'file' ? 'a video file from their device' : 'a video'} to watch together. ${typeof r === 'string' ? r : r.text}`, { at: performance.now(), news: true });
}
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
look.addEventListener('click', () => { if (!show) return; wakeUp(); if (show.isOpen) show.close(); else show.open(); });
draw.addEventListener('click', () => { if (!pad) return; wakeUp(); if (pad.open) pad.hide(); else pad.show(); });
book.addEventListener('click', () => { if (!diary) return; if (diary.open) diary.hide(); else diary.show(); });
tv.addEventListener('click', () => { if (!watch) return; wakeUp(); if (watch.on) watch.close(); else watch.open(null); });
// (any tap lets Spotify's player make sound, on browsers that want one first)
addEventListener('pointerdown', () => music?.tapped(), { capture: true });
// a press on the room: a tap pokes Reverie, tosses what it holds or plays a game; a drag, pinch or scroll looks around
// (look.js), and the button in the corner looks back at Reverie
const looking = makeLook({
  el: canvas,
  onTap(x, y) {
    if (!world) return;
    if (!awake) return wakeUp();
    const hit = world.tap(x, y);
    if (hit === 'game') return;
    if (!hit && tapTrophy(x, y)) return;
    if (!hit && garden.tap(x, y, W, H)) return;
    if (!hit && aquarium?.tap(x, y, W, H)) return;
    if (!hit && capsules?.tap(x, y, W, H)) return;
    if (hit === 'pet') achievements.track('pat');
    if (hit === 'creature') { body.poke(); mood.fun('poke'); gs.sound.sounds.boing?.(); achievements.track('poke'); }
    else if (hit === 'prop') world.toss();
  },
  onMove() { speed.inputAt = performance.now(); },
});
canvas.addEventListener('pointerdown', () => { speed.inputAt = performance.now(); });
recentre.addEventListener('click', () => looking.recentre());

/** The helpers' pills on the stage: who is out and what each is doing; one with news can be tapped to hear it. */
function showHelpers(list) {
  const now = list.filter(h => h.status === 'working' || (!h.told && h.status !== 'stopped')).slice(-4);
  helperList.hidden = !now.length;
  helperList.replaceChildren(...now.map(h => {
    const li = document.createElement('li'), dot = document.createElement('i'), name = document.createElement('b'), what = document.createElement('span');
    li.className = h.status === 'working' ? 'working' : h.status === 'failed' ? 'failed news' : 'news';
    li.style.setProperty('--c', h.colour || '#7fd8ff'); li.dataset.name = h.name;
    name.textContent = h.name;
    what.textContent = h.status === 'working' ? h.doing : h.status === 'failed' ? 'came back empty-handed' : 'is back: tap to hear';
    li.title = h.task; li.append(dot, name, what); return li;
  }));
}
helperList.addEventListener('click', e => {
  const li = e.target.closest('li.news'); if (!li || !brain) return;
  wakeUp(); helpers.tell();
});

// The line above the chat bar while a game is on: how it stands, and its buttons (Undo, New game, Done).
let barKey = '';
function showGame() {
  const g = world.game, b = g ? g.bar() : (watch?.bar() || storytime?.bar());
  gamebar.hidden = !b; if (!b) { barKey = ''; return; }
  if (gameText.textContent !== b.text) gameText.textContent = b.text;
  // (the buttons are made again only when they change: a video's clock changes the text every second)
  const key = b.buttons.map(x => x.id + ':' + x.label).join();
  if (key === barKey) return; barKey = key;
  gameButtons.replaceChildren(...b.buttons.map(x => { const el = document.createElement('button'); el.type = 'button'; el.textContent = x.label; el.dataset.id = x.id; return el; }));
}
gamebar.addEventListener('click', e => {
  const id = e.target.closest('button')?.dataset.id, g = world?.game; if (!id) return;
  if (!g && watch?.on) { watch.button(id); barKey = ''; return; }
  if (!g && storytime?.on) { storytime.button(id); barKey = ''; return; }
  if (!g) return;
  // (Claude hears about both: a new round out loud, as when it calls play; a game put away with the next thing said)
  if (id === 'leave') { const t = g.title; world.stopGame(); brain.notice(`[game] They pressed Done: ${t} is put away.`); }
  else if (id === 'again') world.again();
  else g[id]?.();
  barKey = null;   // (shown afresh next frame, hidden too when that was Done)
});

boot().catch(e => { console.error(e); setStatus('error: ' + (e?.message || e)); });
