// Draw and Guess: you get a word to draw, the clock runs, and Reverie guesses out loud as your drawing grows ("Is it a
// cloud? A sheep?") until it gets it. Five words a round, each one it guesses is a point, and at the end the drawing
// it got quickest is magicked into a real one in its hands.
//
// Who does what: the engine's doodle reader (gs.doodle, a tiny network on the device, a few milliseconds a look) does
// the guessing, and Reverie calls its guesses out at once in its own voice (no trip to Claude, so it keeps up with
// your pen). Claude hears how each word went, and reacts to the round at the end.
//
// The drawing happens on the pad (../doodle.js) the stage lends it: stage.pad. A game here is an object the stage
// drives (see ./index.js for the shape every game has).
import gs from '../../engine/src/gamescroll.js';

const ROUND = 5;
const TIME = [45, 35, 28, 22, 16];                  // seconds a word, by level
// words to draw, the simplest first (level 1 keeps to the first EASY of them); all are things the reader knows
const WORDS = ['sun', 'house', 'tree', 'star', 'moon', 'cloud', 'apple', 'fish', 'flower', 'smiley face', 'umbrella', 'ladder', 'cup', 'hat', 'eye',
  'lightning', 'rainbow', 'snowman', 'mountain', 'door', 'key', 'envelope', 'candle', 'clock', 'banana', 'car', 'cat', 'bird', 'snake', 'spider',
  'butterfly', 'ice cream', 'mushroom', 'light bulb', 'bicycle', 'sailboat', 'airplane', 'guitar', 'crown', 'tent', 'castle', 'pizza', 'snail',
  'octopus', 'rabbit', 'pig', 'shoe', 'eyeglasses', 'cactus', 'hot air balloon', 'palm tree', 'lollipop', 'hamburger', 'giraffe', 'whale', 'teapot'];
const EASY = 24;
const GUESS = ['Is it {a}?', 'Ooh, {a}?', 'Hmm... {a}?', '{A}?', 'Wait, is that {a}?', 'I think it is {a}!', 'Maybe {a}?'];
const GOT = ['{A}! I got it!', "It's {a}!", 'Yes! {A}!', 'Oh, {a}! Easy peasy.', '{A}! Am I right?'];
const an = n => (/^[aeiou]/.test(n) ? 'an ' : 'a ') + n;
const fill = (line, n) => line.replace('{a}', an(n)).replace('{A}', an(n).replace(/^./, c => c.toUpperCase()));
const one = list => list[Math.floor(Math.random() * list.length)];

/** Is the reader sure enough that it's the word? (Its top guess, or a close second it's fairly sure of.) */
export function gotIt(guesses, word) {
  const i = guesses.findIndex(g => g.name === word);
  return i === 0 ? guesses[0].sure >= .2 : i === 1 && guesses[1].sure >= .3;
}

export function makeDraw(stage) {
  const { creature } = stage, { sounds } = gs.tabletop;
  let state = 'off', rounds = 0, level = 2, list = [], n = 0, word = null, left = 0, results = [], said = new Set(), lastSay = 0, t = 0, wait = 0, seen = new Set();

  const pad = () => stage.pad;
  const title = () => {
    if (state === 'drawing') return `Draw ${an(word)}  ·  ${Math.ceil(left)}s  ·  ${n} of ${ROUND}`;
    if (state === 'between') return results.at(-1)?.got ? `Reverie got it: ${an(word)}!` : `Time's up! It was ${an(word)}`;
    return '';
  };
  function say(line) { return stage.say?.(line) ?? false; }

  function nextWord() {
    if (n >= ROUND) return finish();
    word = list[n++]; left = TIME[level - 1]; said = new Set(); lastSay = t; state = 'drawing';
    pad()?.clear(); sounds.flip(); creature.mood('curious'); creature.gesture('think');
  }
  function done(got) {
    const took = TIME[level - 1] - left;
    results.push({ word, got, took });
    state = 'between'; wait = 1.8;
    if (got) {
      say(fill(one(GOT), word)); sounds.chime(); creature.mood('excited'); creature.gesture(took < 8 ? 'tada' : 'bounce');
      const at = new gs.hd.THREE.Vector3(); creature.coreAt(at); stage.sparks(at, '#7dffa0', 30);
    } else { say(`Time's up! What was it? Oh, ${an(word)}!`); sounds.thud(); creature.mood('surprised'); creature.gesture('shrug'); }
    stage.news(`[draw and guess] Word ${n} of ${ROUND}: they drew ${an(word)} and ${got ? `you guessed it in ${Math.round(took)} seconds` : 'you did not guess it in time'}.`, false);
  }
  async function finish() {
    state = 'over'; pad()?.leave();
    const my = ++rounds;
    const got = results.filter(r => r.got), best = got.slice().sort((a, b) => a.took - b.took)[0];
    creature.mood(got.length >= 3 ? 'excited' : 'happy'); creature.gesture('tada'); sounds.gong();
    let made = '';
    if (best && stage.make) made = await stage.make(an(best.word));
    if (my !== rounds || state !== 'over') return;   // (put away, or a new round begun, while it was being made)
    const list = results.map(r => `${r.word} (${r.got ? Math.round(r.took) + ' s' : 'missed'})`).join(', ');
    stage.news(`[draw and guess] The round is over: you guessed ${got.length} of their ${ROUND} drawings: ${list}.${best ? ` You magicked their quickest one, the ${best.word}, into a real one: ${made}` : ''} Cheer them on, say what you thought of their drawings, and offer another round.`, true);
  }

  // the drawing as it grows: the reader's guesses, called out loud, and a word guessed
  function onDraw() {
    if (state !== 'drawing') return;
    const g = pad()?.guessNow() || [];
    if (!g.length) return;
    if (gotIt(g, word)) return done(true);
    const top = g[0];
    if (top.sure > .14 && !said.has(top.name) && t - lastSay > 2.2 && say(fill(one(GUESS), top.name))) { said.add(top.name); lastSay = t; }
  }
  const buttons = [{ id: 'clear', label: 'Clear' }, { id: 'skip', label: 'Skip' }, { id: 'stop', label: 'Stop' }];
  function onButton(id) {
    if (id === 'skip' && state === 'drawing') done(false);
    else if (id === 'stop') stage.stopGame?.();
  }

  const api = {
    id: 'draw_and_guess', title: 'Draw and Guess', camera: { pos: [0, .75, 2.3], look: [0, -.45, 0] },
    get state() { return state; },
    /** Five words to draw; level 1 simple things with lots of time, up to 5: harder things, quickly. */
    async start({ level: lv } = {}) {
      if (!pad()) throw new Error('there is no drawing pad');
      if (lv) level = Math.max(1, Math.min(5, Math.round(lv)));
      await pad().load();
      const pool = WORDS.slice(0, level === 1 ? EASY : level === 2 ? 40 : WORDS.length).filter(w => !seen.has(w));
      const from = pool.length >= ROUND ? pool : WORDS.slice();
      list = []; while (list.length < ROUND) { const w = from.splice(Math.floor(Math.random() * from.length), 1)[0]; list.push(w); seen.add(w); }
      n = 0; results = []; t = 0; rounds++;
      pad().take({ title: '', buttons, onDraw, onButton, onLeave: () => { if (state === 'drawing' || state === 'between') { state = 'off'; stage.stopGame?.(); } } });
      nextWord();
      return `Draw and Guess is on: the drawing pad is open on their screen with a word for them to draw (the first is ${an(word)}; never say it before you guess it), ${TIME[level - 1]} seconds a word, ${ROUND} words. A drawing reader on the device guesses out loud in your voice as they draw. Say one short, excited line to get them going.`;
    },
    stop() { const was = state; state = 'off'; if (was !== 'over') pad()?.leave(); },
    update(dt) {
      if (state === 'off' || state === 'over') return;
      t += dt;
      if (state === 'drawing') {
        left -= dt;
        if (left <= 0) { left = 0; done(false); }
        else if (left < 5 && Math.ceil(left) !== Math.ceil(left + dt)) sounds.tick(.6);
      } else if (state === 'between' && (wait -= dt) <= 0) nextWord();
      if (pad()) pad().title = title();
    },
    tap() { return false; },
    /** They said what they're drawing, or "skip". */
    async command(text) {
      if (state !== 'drawing') return 'No word is being drawn just now.';
      if (/skip|pass|next/i.test(text)) { done(false); return `Skipped: it was ${an(word)}.`; }
      return 'The drawing reader guesses from the drawing itself: let them keep drawing.';
    },
    context() {
      if (state === 'off') return '';
      if (state === 'over') { const g = results.filter(r => r.got).length; return `[draw and guess: the round is over; you guessed ${g} of ${ROUND}.]`; }
      return `[draw and guess, on their drawing pad: they are drawing ${an(word)} for you to guess (word ${n} of ${ROUND}, ${Math.ceil(left)} seconds left). The drawing reader calls out guesses for you; don't say the word until it is guessed. Guessed so far: ${results.filter(r => r.got).length}.]`;
    },
    bar() {
      if (state !== 'over') return null;
      const g = results.filter(r => r.got).length;
      return { text: `Draw and Guess · Reverie got ${g} of ${ROUND}`, buttons: [{ id: 'again', label: 'Again' }, { id: 'leave', label: 'Done' }] };
    },
  };
  return api;
}
