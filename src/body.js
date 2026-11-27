// Body language: what Reverie does with itself while nobody is talking, all on the device and at once, with no call
// to Claude. Simple rules choose a little move every few seconds (look about, peek at what it's holding, sway, hop,
// stretch), and it gets drowsy when left alone for a while. It perks up the moment you start talking, before Claude
// has heard a word.
//
// The engine's Tiny Brains Coach (gs.brains.Coach) sits on top of the rules. Poking it just after it did something is
// "I liked that": a couple of pokes for the same move in moments like this one (holding something, left alone a while,
// late at night...) and it does that move more in moments like that, and nowhere else. What it learns stays in this
// browser (localStorage), so it remembers what you like next time.
import gs from '../engine/src/gamescroll.js';
import { latenessAt } from './daylight.js';

/** The moves the rules (and the coach) choose between. 'perk' is not one: that is a reaction, always made. */
export const IDLES = ['rest', 'glance', 'peek', 'sway', 'hop', 'stretch'];
const LIKE_WINDOW = 4;           // seconds after a move in which a poke counts as liking it
const DROWSY_AFTER = 90;         // seconds alone before it gets drowsy (a fifth of that at bedtime)
const GAP = [2.5, 6];            // seconds between idle moves (longer the longer it's left alone)

// Reverie is a page, not a Game Scroll card, so the coach's corrections are kept in this browser's own storage
const store = {
  brains: {
    load: name => { try { return localStorage.getItem('reverie.brain.' + name); } catch { return null; } },
    save: (name, text) => { try { localStorage.setItem('reverie.brain.' + name, text); } catch { /* private window */ } },
  },
};

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const hourNow = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };

/** The rules' choice, as a list best first: a weighted shuffle, so it isn't the same move every time. */
function rules(s, r = Math.random) {
  // (its mood, 0..1: happy, it hops and sways more and rests less; low, the other way round)
  const c = s.cheer ?? .5;
  const w = {
    rest: 1.5 * (1.5 - c),
    glance: s.quiet < 30 ? 2.5 : 1.2,
    peek: s.holding ? 3 : s.props ? 1.2 : 0,
    sway: (s.quiet > 12 ? 2 : .6) * (.6 + c * .8),
    hop: (s.pokes > .3 ? 2.2 : .35) * (.3 + c * 1.8),
    stretch: s.holding ? 0 : s.quiet > 40 ? 1.6 + s.night + s.late * 2 : .15 + s.late * 1.2,   // (a stretch is its yawn: often at bedtime)
  };
  const left = IDLES.filter(a => w[a] > 0), out = [];
  while (left.length) {
    let sum = 0; for (const a of left) sum += w[a];
    let x = r() * sum, i = 0;
    for (; i < left.length - 1; i++) { x -= w[left[i]]; if (x <= 0) break; }
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

/**
 * makeBody({ creature, world }): call update(dt) every frame, poke() when the creature is tapped, notice() when the
 * person starts typing. `coach` is the Tiny Brains Coach, `last` the move it made last.
 */
export function makeBody({ creature, world, hour = hourNow, mood = null }) {
  const coach = new gs.brains.Coach(store, { name: 'idle', inputs: 5, actions: IDLES });
  let t = 0, quiet = 0, pokes = 0, next = 2, last = null, wasListening = false;

  // what it looks at, each about -1..1: how long it's been left alone, holding something, things on the floor,
  // poked lately, and how late it is (1 at 3 am, -1 at 3 pm)
  function look() {
    const night = Math.cos((hour() - 3) / 24 * Math.PI * 2);
    const props = world.props;
    const s = { quiet, holding: creature.holding, props, pokes, night: Math.max(0, night), late: latenessAt(hour()), cheer: mood ? mood.cheer : .5 };
    const see = [clamp(quiet / 60, 0, 1) * 2 - 1, s.holding ? 1 : -1, clamp(props / 3, 0, 1) * 2 - 1, clamp(pokes, 0, 1) * 2 - 1, night];
    return { s, see };
  }

  function perk() { quiet = 0; creature.drowsy = false; creature.idle('perk'); next = Math.max(next, 2); }

  return {
    coach,
    get last() { return last; },
    get quiet() { return quiet; },
    update(dt) {
      t += dt;
      const st = creature.state, busy = st.listening || st.thinking || st.speaking;
      pokes *= Math.exp(-dt / 20);
      // the instant reaction: your voice is heard, and it perks up before anything goes to Claude
      if (st.listening && !wasListening && !st.speaking) perk();
      wasListening = st.listening;
      // (a game on the table: it is busy playing, so no idle moves and no dozing off)
      if (busy || world.game) { quiet = 0; creature.drowsy = false; next = Math.max(next, 1.5); return; }
      quiet += dt;
      { const s = look().s; creature.drowsy = quiet > DROWSY_AFTER * Math.min(1 - .5 * s.night, 1 - .8 * s.late); }
      if (creature.busy) { next = Math.max(next, 1); return; }   // (a gesture Claude asked for comes first)
      if ((next -= dt) > 0) return;
      const { s, see } = look();
      const act = coach.pick(see, rules(s));
      creature.idle(act);
      last = { act, see, at: t, taught: !!coach.recalled && !coach.recalled.not };
      const g = GAP[0] + Math.random() * (GAP[1] - GAP[0]);
      next = g * (creature.drowsy ? 1.8 : 1) * (1.2 - s.cheer * .4) + (act === 'rest' ? 1 : 0);
    },
    /** A tap on it: a giggle, and "I liked that" for the move it has just made. True if it learnt something. */
    poke() {
      creature.poke();
      pokes = Math.min(1.5, pokes + .5);
      const liked = last && t - last.at < LIKE_WINDOW && last.act !== 'rest';
      if (liked) { coach.correct(last.see, last.act); console.info(`[reverie] liked: ${last.act}`); }
      quiet = 0; creature.drowsy = false;
      return !!liked;
    },
    /** The person has started typing: the same perk as being heard. */
    notice() { if (!creature.state.speaking && !creature.state.thinking) perk(); },
    /** Forgets everything it was taught. */
    forget() { coach.uncorrect(); },
  };
}

export { rules };
