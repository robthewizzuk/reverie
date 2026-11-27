// How Reverie feels, kept on this device: it gets happier the more you play with it, and shows it with its whole body
// (bouncier idles, a brighter, quicker glow, a readier smile, a livelier voice). All worked out on the device.
//
// Two numbers. `joy` (0..1) is how happy it is overall: every bit of play nudges it up (making things, games, dice,
// drawings, patting it or its pet, just chatting), each nudge smaller the happier it already is, and it drifts slowly
// back to "content" while you are away, a little faster if you've been gone for days (it missed you). `spark` (0..1)
// is the fizz of the moment: up at once with each bit of fun, gone again in half a minute. `cheer` mixes the two and
// is what the body, glow and voice follow. No three.js here: the world and the tests read it.

const KEY = 'reverie.mood.v1';
export const LEVELS = [
  { id: 'glum', at: 0, about: 'a little low and quiet (nobody has played with you for a while)' },
  { id: 'content', at: .3, about: 'content' },
  { id: 'cheerful', at: .55, about: 'cheerful' },
  { id: 'overjoyed', at: .8, about: 'overjoyed (you have had loads of fun together)' },
];
// how much each kind of fun lifts it: [joy, spark]
export const FUN = {
  chat: [.008, .12], make: [.03, .5], change: [.015, .3], toss: [.012, .35], place: [.02, .3], colours: [.015, .3],
  room: [.015, .3], roll: [.02, .45], doodle: [.04, .6], game: [.04, .5], win: [.06, .8], move: [.006, .15],
  show: [.03, .5], poke: [.012, .35], pet: [.025, .5], newpet: [.08, 1], trick: [.015, .4], voice: [.01, .3],
  smash: [.015, .4], effect: [.012, .35], shake: [.01, .3], wear: [.015, .35],
  watch: [.03, .5],
};
const REST = .42;               // where joy settles back to on its own
const SETTLE_HOURS = 30;        // about how long it takes to drift most of the way back
const MISSED_AFTER = 10;        // hours away after which it says it missed you
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

const local = {
  load: () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  save: o => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* a private window */ } },
};

export const levelOf = x => LEVELS.reduce((a, l) => (x >= l.at ? l : a), LEVELS[0]);

/**
 * makeMood({ store, now }): fun(kind) when something fun happens, update(dt) each frame. cheer (0..1) is what the
 * body follows; level is 'glum' | 'content' | 'cheerful' | 'overjoyed'. onLevel(level, up) when it changes.
 */
export function makeMood({ store = local, now = () => Date.now(), onLevel = () => {} } = {}) {
  const kept = store.load() || {};
  let joy = Number.isFinite(kept.joy) ? clamp(kept.joy) : .5, spark = 0, played = kept.played | 0, saveIn = 0;
  const first = kept.first || now();
  // time away: joy drifts back towards REST, and more than half a day away it missed you
  const away = kept.last ? Math.max(0, (now() - kept.last) / 3.6e6) : 0;
  if (away > .05) joy = REST + (joy - REST) * Math.exp(-away / SETTLE_HOURS);
  if (away > 72) joy = Math.min(joy, .32);   // (days alone: a little low, until you play again)
  const missed = kept.last && away >= MISSED_AFTER ? away : 0;
  let level = levelOf(joy).id;

  const cheerNow = () => clamp(joy * .82 + spark * .28);
  function keep() { store.save({ joy: +joy.toFixed(4), played, first, last: now() }); saveIn = 20; }
  function check() {
    const l = levelOf(joy).id; if (l === level) return;
    const up = LEVELS.findIndex(x => x.id === l) > LEVELS.findIndex(x => x.id === level);
    level = l; onLevel(l, up);
  }

  const mood = {
    get joy() { return joy; },
    get spark() { return spark; },
    /** 0..1: how bouncy, bright and lively it is now. */
    get cheer() { return cheerNow(); },
    get level() { return level; },
    /** Bits of fun so far, ever. */
    get played() { return played; },
    /** Hours it was left alone before this visit, if that was long enough to miss you (else 0). */
    missed,
    /** Something fun happened (a FUN name). Returns the new joy. */
    fun(kind, k = 1) {
      const f = FUN[kind]; if (!f) return joy;
      joy = clamp(joy + f[0] * k * (1 - joy * .7));
      spark = clamp(spark + f[1] * k * (1 - spark * .5));
      played++; keep(); check();
      return joy;
    },
    update(dt) {
      spark *= Math.exp(-dt / 25);
      // (it drifts towards REST while you are here too, but only very slowly: an hour of nothing takes off a little)
      joy += (REST - joy) * (1 - Math.exp(-dt / (SETTLE_HOURS * 3600 * 2)));
      if ((saveIn -= dt) < 0) keep();
    },
    /** A line for Claude: how it feels. */
    line() {
      const l = LEVELS.find(x => x.id === level);
      return ` Your mood: ${l.about}.`;
    },
    /** Starts over from content (tests). */
    reset() { joy = .5; spark = 0; played = 0; level = levelOf(joy).id; keep(); },
    /** Sets joy directly (tests and tuning). */
    set(x) { joy = clamp(x); check(); keep(); },
  };
  return mood;
}

/** The voice's share of the mood: a happier Reverie speaks a touch livelier and brighter. In steps, so a line written
 * ahead (gs.sound.prepare) is said with the same options. */
export function toneOf(cheer) {
  const c = Math.round(clamp(cheer) * 10) / 10;
  return { lively: (c - .5) * .24, size: 1 - (c - .5) * .04, mood: c >= .85 ? 'happy' : null };
}
