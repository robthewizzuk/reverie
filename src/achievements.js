// Achievements: badges for what you do together (games won, things made, days in a row, the room, the pet...), each a
// little trophy on Reverie's shelf (trophies.js draws them). Kept in this browser only, like the diary.
//
// Everything that happens is a named event: track('make'), track('win:chess'), track('quiz', { best: 7 }),
// track('voice', { add: 'pirate' }). Events add to counts, keep bests and collect sets, and each badge asks for one of
// those to reach a number. Features that come later (the garden, lessons, karaoke, the escape room...) only call track
// with their own names: their badges are listed already, and show once that feature's first event comes in.
// No three.js and no engine here: the page, the diary sheet and the tests read it.

const KEY = 'reverie.achievements.v1';

/** The families badges come in, in the order they are shown, with the trophy shape for each. */
export const FAMILIES = {
  games: { title: 'Games', shape: 'cup' },
  making: { title: 'Making', shape: 'star' },
  friends: { title: 'Friends', shape: 'heart' },
  room: { title: 'Home', shape: 'house' },
  // (features that may come later: shown once they've been used)
  garden: { title: 'Garden', shape: 'leaf', later: true },
  learn: { title: 'Learning', shape: 'book', later: true },
  music: { title: 'Music', shape: 'note', later: true },
  escape: { title: 'Puzzles', shape: 'key', later: true },
};
/** An emoji for each family, for the badge card and the diary. */
export const ICONS = { games: '🏆', making: '⭐', friends: '💛', room: '🏠', garden: '🌱', learn: '📚', music: '🎵', escape: '🔑' };
export const TIERS = { bronze: 1, silver: 2, gold: 3 };

// Each: id, title, about (what you did, said after "you"), family, tier, and need: [kind, name, at]
//   kind 'count': that event happened `at` times; 'best': its best value reached `at`; 'set': `at` different ones.
const A = (id, title, about, family, tier, need, more = {}) => ({ id, title, about, family, tier, need, ...more });
export const ACHIEVEMENTS = [
  // games
  A('first_game', 'Game on', 'played your first game with Reverie', 'games', 'bronze', ['count', 'game', 1]),
  A('games_all', 'Games night', 'played every game in the room', 'games', 'gold', ['set', 'games', 6]),
  A('chess_win', 'Checkmate!', 'beat Reverie at chess', 'games', 'gold', ['count', 'win:chess', 1]),
  A('chess_3', 'Grandmaster', 'beat Reverie at chess three times', 'games', 'gold', ['count', 'win:chess', 3], { secret: true }),
  A('quiz_round', 'Quiz whiz', 'finished a quiz', 'games', 'bronze', ['count', 'quiz', 1]),
  A('quiz_7', 'Brain box', 'scored 7 or more in a quiz', 'games', 'silver', ['best', 'quiz', 7]),
  A('quiz_10', 'Perfect ten', 'got every quiz question right', 'games', 'gold', ['best', 'quiz', 10]),
  A('noughts_win', 'Three in a row', 'won at noughts and crosses', 'games', 'silver', ['count', 'win:noughts', 1]),
  A('quest_win', 'Treasure hunter', 'found the treasure on a quest', 'games', 'silver', ['count', 'win:quest', 1]),
  A('twenty_win', 'Mind reader', 'stumped Reverie, or guessed its secret, in twenty questions', 'games', 'silver', ['count', 'win:twenty', 1]),
  A('draw_5', 'Picture perfect', 'had five drawings guessed in draw and guess', 'games', 'silver', ['count', 'guessed', 5]),
  A('dice_1', 'Roll the dice', 'rolled the dice', 'games', 'bronze', ['count', 'roll', 1]),
  // making
  A('make_1', 'Abracadabra', 'had Reverie magic something up', 'making', 'bronze', ['count', 'make', 1]),
  A('make_10', 'Prop factory', 'had ten things made', 'making', 'silver', ['count', 'make', 10]),
  A('make_50', 'Master maker', 'had fifty things made', 'making', 'gold', ['count', 'make', 50]),
  A('doodle_1', 'Drawn to life', 'turned a drawing into a real thing', 'making', 'bronze', ['count', 'doodle', 1]),
  A('doodle_10', 'Sketchbook', 'turned ten drawings into real things', 'making', 'gold', ['count', 'doodle', 10]),
  A('show_1', 'Show and tell', 'showed Reverie something on the camera', 'making', 'bronze', ['count', 'show', 1]),
  // friends
  A('name', 'Nice to meet you', 'told Reverie your name', 'friends', 'bronze', ['count', 'name', 1]),
  A('streak_3', 'Three days running', 'visited three days in a row', 'friends', 'silver', ['best', 'streak', 3], { passive: true }),
  A('streak_7', 'A week of fun', 'visited seven days in a row', 'friends', 'gold', ['best', 'streak', 7], { passive: true }),
  A('days_30', 'Old friends', 'spent thirty days together', 'friends', 'gold', ['best', 'days', 30], { passive: true }),
  A('pet_1', 'Pet pal', 'gave Reverie a pet', 'friends', 'bronze', ['count', 'pet', 1]),
  A('pat_20', 'Head scratches', 'patted the pet twenty times', 'friends', 'silver', ['count', 'pat', 20]),
  A('poke_10', 'Boop!', 'booped Reverie ten times', 'friends', 'bronze', ['count', 'poke', 10]),
  A('overjoyed', 'Best of friends', 'made Reverie overjoyed', 'friends', 'gold', ['count', 'overjoyed', 1]),
  A('voices_3', 'Many voices', 'heard Reverie in three different voices', 'friends', 'silver', ['set', 'voices', 3]),
  A('night_owl', 'Night owl', 'visited after midnight', 'friends', 'silver', ['count', 'night', 1], { secret: true }),
  A('early_bird', 'Early bird', 'visited before seven in the morning', 'friends', 'silver', ['count', 'dawn', 1], { secret: true }),
  // the room
  A('place_1', 'Home sweet home', 'had something kept in the room', 'room', 'bronze', ['count', 'place', 1]),
  A('place_10', 'Full house', 'had ten things put in the room', 'room', 'silver', ['count', 'place', 10]),
  A('paint_1', 'Interior designer', 'repainted the room', 'room', 'bronze', ['count', 'paint', 1]),
  A('colours_1', 'New look', 'gave Reverie new colours', 'room', 'bronze', ['count', 'colours', 1]),
  A('sky_1', 'Weather wizard', 'changed the sky outside the window', 'room', 'bronze', ['count', 'sky', 1]),
  // later features: they track these names
  A('garden_plant', 'Green thumb', 'planted a seed in the garden', 'garden', 'bronze', ['count', 'garden:plant', 1]),
  A('garden_bloom', 'In full bloom', 'grew a plant until it flowered', 'garden', 'silver', ['count', 'garden:bloom', 1]),
  A('garden_5', 'Garden of plenty', 'grew five plants to bloom', 'garden', 'gold', ['count', 'garden:bloom', 5]),
  A('learn_1', 'Bright spark', 'finished a lesson with Reverie', 'learn', 'bronze', ['count', 'learn:lesson', 1]),
  A('learn_10', 'Top of the class', 'finished ten lessons', 'learn', 'gold', ['count', 'learn:lesson', 10]),
  A('sing_1', 'Superstar', 'sang a song with Reverie', 'music', 'bronze', ['count', 'music:song', 1]),
  A('dance_1', 'Dance party', 'danced with Reverie', 'music', 'bronze', ['count', 'music:dance', 1]),
  A('escape_1', 'Escape artist', 'escaped the room', 'escape', 'gold', ['count', 'escape:win', 1]),
];
export const BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

const blank = () => ({ v: 1, got: {}, counts: {}, best: {}, sets: {}, seen: {} });
/** A badge's about, as Claude hears it (Claude is Reverie): "told Reverie your name" → "told you their name". */
const forClaude = s => s.replace(/\byour\b/g, 'their').replace(/\bReverie\b/g, 'you');
const clean = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9:_ -]+/g, '').trim().slice(0, 40);

/** How far along a badge is: { have, at } (have stops at at). */
export function progressOf(a, s) {
  const [kind, name, at] = a.need;
  const have = kind === 'count' ? s.counts[name] | 0 : kind === 'best' ? +s.best[name] || 0 : (s.sets[name] || []).length;
  return { have: Math.min(have, at), at };
}

/**
 * makeAchievements({ store, clock }): track(event, o) when something happens; returns the badges it just earned.
 * onUnlock(fn(badge)) hears each new one. has(id), earned(), list(), summary() for Claude, and line(badge).
 */
export function makeAchievements({ store = globalThis.localStorage, clock = () => new Date() } = {}) {
  let s = load();
  const listeners = new Set(), changes = new Set();

  function load() {
    try {
      const o = JSON.parse(store?.getItem(KEY) || 'null');
      if (!o || o.v !== 1) return blank();
      const b = blank(), obj = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
      return { ...b, got: obj(o.got), counts: obj(o.counts), best: obj(o.best), seen: obj(o.seen),
        sets: Object.fromEntries(Object.entries(obj(o.sets)).filter(([, v]) => Array.isArray(v))) };
    } catch { return blank(); }
  }
  function save() { try { store?.setItem(KEY, JSON.stringify(s)); } catch { /* a private window: kept until it closes */ } }
  const day = () => { const d = clock(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const family = name => name.includes(':') ? name.split(':')[0] : null;

  /** Badges whose need is met and not yet earned: earned now, in list order. */
  function check() {
    const fresh = [];
    for (const a of ACHIEVEMENTS) {
      if (s.got[a.id]) continue;
      const p = progressOf(a, s);
      if (p.have >= p.at) { s.got[a.id] = { day: day(), n: Object.keys(s.got).length + 1 }; fresh.push(a); }
    }
    return fresh;
  }
  function tell(fresh) {
    if (fresh.length) save();
    for (const a of fresh) for (const f of listeners) try { f(a); } catch (e) { console.warn('[reverie] achievement listener', e); }
    for (const f of changes) try { f(); } catch { /* a listener's problem */ }
    return fresh;
  }

  const api = {
    /**
     * Something happened. o: { by: n } (counted n times, default 1), { best: x } (a score: the best is kept),
     * { add: 'name' } (one of a set: voices tried, games played), { at: n } (a running total, like days: kept as a best).
     * Returns the badges earned by it (usually none).
     */
    track(event, o = {}) {
      const name = clean(event); if (!name) return [];
      const fam = family(name); if (fam && FAMILIES[fam]) s.seen[fam] = true;
      if (Number.isFinite(o.best) || Number.isFinite(o.at)) s.best[name] = Math.max(+s.best[name] || 0, +(o.best ?? o.at));
      if (o.add != null) { const set = s.sets[name] ||= [], v = clean(o.add); if (v && !set.includes(v)) { set.push(v); if (set.length > 60) set.shift(); } }
      if (o.best == null && o.at == null && o.add == null || o.count) s.counts[name] = (s.counts[name] | 0) + (Number.isFinite(o.by) ? o.by : 1);
      save();
      return tell(check());
    },
    /** Hears each new badge as it is earned: fn(badge). Returns a function that stops it. */
    onUnlock(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Hears any change at all (for the diary sheet). */
    onChange(fn) { changes.add(fn); return () => changes.delete(fn); },
    /** Has this badge been earned? (other features, such as outfits, unlock things with this) */
    has: id => !!s.got[id],
    /** The badges earned, in the order they were: [{ ...badge, day, n }]. */
    earned() { return Object.entries(s.got).filter(([id]) => BY_ID[id]).map(([id, g]) => ({ ...BY_ID[id], day: g.day, n: g.n })).sort((a, b) => a.n - b.n); },
    /** Every badge that can be shown now (later features only once used), with whether it is earned and how far along. */
    list() {
      return ACHIEVEMENTS.filter(a => !FAMILIES[a.family].later || s.seen[a.family] || s.got[a.id])
        .map(a => ({ ...a, got: !!s.got[a.id], day: s.got[a.id]?.day || null, ...progressOf(a, s) }));
    },
    /** How many there are to earn now, and how many are earned. */
    get tally() { const l = this.list(); return { got: l.filter(a => a.got).length, of: l.length }; },
    /** A raw number, for tests and the diary: counts, bests and set sizes. */
    stat(name) { return s.counts[name] ?? s.best[name] ?? s.sets[name]?.length ?? 0; },
    /** The nearest badges not yet earned (most of the way there first), not secret ones, nor ones that come with time. */
    next(n = 3) {
      return this.list().filter(a => !a.got && !a.secret && !a.passive).sort((a, b) => b.have / b.at - a.have / a.at || TIERS[a.tier] - TIERS[b.tier]).slice(0, n);
    },
    /** For Claude, at the top of a chat: a line, or '' when there's nothing yet. */
    summary() {
      const got = this.earned(); if (!got.length) return '';
      const t = this.tally, near = this.next(2).filter(a => a.have > 0);
      return `[Badges they have earned with you: ${t.got} of ${t.of}, a trophy for each on your shelf. Latest: ${got.slice(-4).map(a => `"${a.title}"`).join(', ')}.`
        + `${near.length ? ` Nearly there: ${near.map(a => `"${a.title}" (${forClaude(a.about)}, ${a.have} of ${a.at})`).join('; ')}.` : ''}]`;
    },
    /** What Claude hears when one is earned. */
    line(a) {
      const t = this.tally;
      return `[achievement] They just earned the "${a.title}" badge: they ${forClaude(a.about)}. A ${a.tier} ${FAMILIES[a.family].shape === 'cup' ? 'cup' : FAMILIES[a.family].shape} trophy has appeared on your trophy shelf (${t.got} of ${t.of} now). Celebrate it in one short, excited line, with a sound cue if it fits.`;
    },
    /** The badges tool: what they have and what's next, for Claude to say. */
    report() {
      const got = this.earned(), t = this.tally, near = this.next(3);
      if (!got.length) return `No badges yet (${t.of} to earn). Easy first ones: ${near.map(a => `"${a.title}" (${forClaude(a.about)})`).join('; ')}. The trophy shelf is waiting.`;
      return `They have ${t.got} of ${t.of} badges: ${got.map(a => `"${a.title}" (${a.tier})`).join(', ')}. Next to aim for: ${near.map(a => `"${a.title}" (${forClaude(a.about)}${a.have ? `, ${a.have} of ${a.at}` : ''})`).join('; ') || 'nothing left, they have them all!'}. The badges are in your diary (the book button) and the trophies are on your shelf.`;
    },
    /** Everything gone (Forget everything in the diary). */
    wipe() { s = blank(); try { store?.removeItem(KEY); } catch { /* fine */ } tell([]); },
  };
  return api;
}
