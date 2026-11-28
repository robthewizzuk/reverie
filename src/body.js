// Body language: what Reverie does with itself while nobody is talking, all on the device and at once, with no call
// to Claude. Driven by Reverie's Multi-Brain Suite (tiny-brains.js):
//   - idleBrain (neural net) + idleCoach (instant poke-to-teach) over 8 rich context signals
//   - reactBrain for instant on-device micro-reactions
//   - skillDial & activityBrain for adaptive game skill and habit learning
// Focus mode keeps Reverie peacefully calm (gentle glances & breathing, no wild hops).
import { latenessAt } from './daylight.js';
import { makeTinyBrains, IDLE_ACTIONS } from './tiny-brains.js';

/** The moves the rules (and the tiny brains) choose between. 'perk' is not one: that is a reaction, always made. */
export const IDLES = IDLE_ACTIONS;
const LIKE_WINDOW = 4;           // seconds after a move in which a poke counts as liking it
const DROWSY_AFTER = 90;         // seconds alone before it gets drowsy (a fifth of that at bedtime)
const GAP = [2.5, 6];            // seconds between idle moves (longer the longer it's left alone)

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const hourNow = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };

/** The rules' choice, as a list best first: a weighted shuffle, so it isn't the same move every time. */
function rules(s, r = Math.random) {
  if (s.focus) return ['rest', 'glance'];
  const c = s.cheer ?? .5;
  const w = {
    rest: 1.5 * (1.5 - c),
    glance: s.quiet < 30 ? 2.5 : 1.2,
    peek: s.holding ? 3 : s.props ? 1.2 : 0,
    sway: (s.quiet > 12 || s.audio ? 2.2 : .6) * (.6 + c * .8),
    hop: (s.pokes > .3 ? 2.2 : .35) * (.3 + c * 1.8),
    stretch: s.holding ? 0 : s.quiet > 40 ? 1.6 + s.night + s.late * 2 : .15 + s.late * 1.2,
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
 * makeBody({ creature, world, hour, mood, audioOn }): call update(dt) every frame, poke() when tapped,
 * notice() when typing starts, setFocus(on) for Focus Buddy mode, react(kind) for instant micro-reactions.
 */
export function makeBody({ creature, world, hour = hourNow, mood = null, audioOn = () => false }) {
  const brains = makeTinyBrains();
  let t = 0, quiet = 0, pokes = 0, next = 2, last = null, lastReact = null, wasListening = false, focusing = false;

  // 8 context inputs in [-1..1]: quiet, holding, props, pokes, night, cheer, audioOn, focusMode
  function look() {
    const night = Math.cos((hour() - 3) / 24 * Math.PI * 2);
    const props = world.props;
    const cheer = mood ? mood.cheer : .5;
    const audio = !!audioOn();
    const s = { quiet, holding: creature.holding, props, pokes, night: Math.max(0, night), late: latenessAt(hour()), cheer, audio, focus: focusing };
    const see = [
      clamp(quiet / 60, 0, 1) * 2 - 1,
      s.holding ? 1 : -1,
      clamp(props / 3, 0, 1) * 2 - 1,
      clamp(pokes, 0, 1) * 2 - 1,
      night,
      cheer * 2 - 1,
      audio ? 1 : -1,
      focusing ? 1 : -1,
    ];
    return { s, see };
  }

  function reactSee() {
    const { s } = look();
    return [s.cheer * 2 - 1, s.night * 2 - 1, focusing ? 1 : -1, s.audio ? 1 : -1, s.holding ? 1 : -1, clamp(pokes, 0, 1) * 2 - 1];
  }

  function perk() {
    quiet = 0; creature.drowsy = false;
    if (!focusing) creature.idle('perk');
    next = Math.max(next, 2);
  }

  return {
    coach: brains.idleCoach,
    brains,
    get last() { return last; },
    get quiet() { return quiet; },
    setFocus(on) { focusing = !!on; if (focusing) { creature.drowsy = false; next = Math.max(next, 3); } },
    /** Instant on-device micro-reaction chosen by reactBrain before Claude replies. */
    react(kind = 'greet') {
      if (focusing || creature.busy) return null;
      const fallbacks = {
        greet: ['wave', 'bounce', 'nod'],
        tap: ['bounce', 'wave', 'nod'],
        win: ['tada', 'bounce', 'wave'],
        think: ['think', 'nod'],
      }[kind] || ['nod', 'wave'];
      const see = reactSee();
      const act = brains.pickReaction(see, fallbacks);
      creature.gesture?.(act);
      lastReact = { act, see, at: t };
      return act;
    },
    update(dt) {
      t += dt;
      const st = creature.state, busy = st.listening || st.thinking || st.speaking;
      pokes *= Math.exp(-dt / 20);
      if (st.listening && !wasListening && !st.speaking) perk();
      wasListening = st.listening;
      if (busy || world.game) { quiet = 0; creature.drowsy = false; next = Math.max(next, 1.5); return; }
      quiet += dt;
      { const s = look().s; creature.drowsy = !focusing && quiet > DROWSY_AFTER * Math.min(1 - .5 * s.night, 1 - .8 * s.late); }
      if (creature.busy) { next = Math.max(next, 1); return; }
      if ((next -= dt) > 0) return;
      const { s, see } = look();
      const picked = brains.pickIdle(see, rules(s), dt);
      creature.idle(picked.act);
      last = { act: picked.act, see, at: t, taught: picked.taught };
      const g = GAP[0] + Math.random() * (GAP[1] - GAP[0]);
      next = g * (focusing ? 2.2 : creature.drowsy ? 1.8 : 1) * (1.2 - s.cheer * .4) + (picked.act === 'rest' ? 1 : 0);
    },
    /** A tap on it: a giggle, and "I liked that" for the move/reaction it just made. */
    poke() {
      creature.poke();
      pokes = Math.min(1.5, pokes + .5);
      const liked = last && t - last.at < LIKE_WINDOW && last.act !== 'rest';
      if (liked) { brains.rewardIdle(last.see, last.act, { strong: true }); console.info(`[reverie] liked: ${last.act}`); }
      if (lastReact && t - lastReact.at < LIKE_WINDOW) brains.rewardReaction(lastReact.see, lastReact.act);
      quiet = 0; creature.drowsy = false;
      return !!liked;
    },
    /** The person has started typing: perk up and softly reward recent engaging idle moves. */
    notice() {
      if (last && t - last.at < LIKE_WINDOW && last.act !== 'rest') brains.rewardIdle(last.see, last.act, { strong: false });
      if (!creature.state.speaking && !creature.state.thinking) perk();
    },
    /** Forgets everything all tiny brains were taught. */
    forget() { brains.forgetAll(); },
  };
}

export { rules };
