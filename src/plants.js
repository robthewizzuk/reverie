// Reverie's windowsill garden, as numbers: what is planted in each of the three pots, how grown it is, how much water
// it has, and how long it has gone without. Plants grow in real time (days, not minutes) while they have water, and
// droop when they run dry, but never die: a drink and they perk straight back up. Kept on this device. No three.js in
// here: garden.js draws what this describes, and the tests read it.

const KEY = 'reverie.garden.v1';
const HOUR = 3.6e6;
export const POTS = ['left', 'middle', 'right'];

/**
 * The plants it knows. days: watered days from seed to first flower. drink: hours one watering lasts. Each draws in
 * its own shape (garden.js): its height in metres, leaves, and flower head. pick: what a picked one becomes in its
 * hands (made by the generator). ripen: days after flowering until its fruit is ready to pick.
 */
export const KINDS = {
  daisy: { days: 3, drink: 36, words: ['daisy', 'daisies', 'marguerite', 'chamomile', 'flower'], petals: '#fbf7ef', pick: 'a little bunch of daisies', about: 'a daisy' },
  tulip: { days: 4, drink: 36, words: ['tulip', 'rose', 'poppy', 'lily', 'crocus'], petals: '#f2788e', pick: 'a tulip', about: 'a tulip' },
  strawberry: { days: 4, drink: 30, ripen: 2, words: ['strawberry', 'strawberries', 'berry', 'berries', 'fruit'], petals: '#fffaf2', pick: 'a strawberry', about: 'a strawberry plant' },
  sunflower: { days: 5, drink: 30, words: ['sunflower', 'sun flower', 'big flower', 'tall flower'], petals: '#ffc93a', pick: 'a sunflower', about: 'a sunflower' },
  glowbloom: { days: 6, drink: 40, words: ['glowbloom', 'glow', 'magic', 'star', 'glowing', 'night', 'fairy', 'moon'], petals: '#c8b6ff', pick: 'a glowing magic flower', about: 'a glowbloom (a magic flower that glows softly at night)' },
  cactus: { days: 7, drink: 120, words: ['cactus', 'cacti', 'succulent', 'aloe', 'prickly'], petals: '#ff8fb8', pick: 'a pink cactus flower', about: 'a little round cactus' },
};
export const KIND_NAMES = Object.keys(KINDS);

// how far through growing (0..1) each stage starts; past 1 it is in flower
export const STAGES = [[0, 'a seed'], [.06, 'a sprout'], [.3, 'growing leaves'], [.6, 'in bud'], [.8, 'opening'], [1, 'in flower']];
export const stageOf = g => STAGES.reduce((a, s) => (g >= s[0] ? s[1] : a), STAGES[0][1]);
const THIRSTY = .25;              // water left below which it would like a drink
const WILT_HOURS = 30;            // hours dry until fully drooped

const capital = n => { const t = String(n || '').trim().slice(0, 24); return t.charAt(0).toUpperCase() + t.slice(1); };
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

/** The kind words like "a pink tulip", "some magic seeds" or "strawberries" mean, or null. */
export function kindOf(words) {
  const t = String(words || '').toLowerCase();
  if (!t.trim()) return null;
  if (KINDS[t.trim()]) return t.trim();
  for (const k of KIND_NAMES) if (KINDS[k].words.some(w => w !== 'flower' && new RegExp(`\\b${w}\\b`).test(t))) return k;
  return /\b(flowers?|seeds?|plants?|something)\b/.test(t) ? 'daisy' : null;
}

/** How droopy (0..1) a pot is: from how long it has been dry. */
export const droopOf = p => p ? clamp(p.dry / WILT_HOURS) : 0;

/**
 * Moves a pot on to time `now` (ms): water drains, it grows while it has some, and dry hours pile up when it has none.
 * Returns what changed on the way: [{ id, what: 'sprouted' | 'budded' | 'bloomed' | 'ripe' | 'thirsty' | 'drooping' }].
 */
export function advance(p, now) {
  const out = [], k = KINDS[p.kind];
  let hours = Math.max(0, (now - p.at) / HOUR);
  p.at = now;
  while (hours > 1e-6) {
    const h = Math.min(hours, 1); hours -= h;
    const g0 = p.g, w0 = p.water, d0 = droopOf(p), r0 = p.ripe || 0;
    if (p.water > 0) {
      // a drooping plant grows slower until it has had a drink (and water now means it is perking up)
      p.g = Math.min(1, p.g + h / 24 / k.days);
      if (p.g >= 1 && k.ripen) p.ripe = Math.min(1, (p.ripe || 0) + h / 24 / k.ripen);
      p.water = Math.max(0, p.water - h / k.drink);
    } else p.dry += h;
    const passed = at => g0 < at && p.g >= at;
    if (passed(.06)) out.push({ id: p.id, what: 'sprouted' });
    if (passed(.6)) out.push({ id: p.id, what: 'budded' });
    if (passed(1)) out.push({ id: p.id, what: 'bloomed' });
    if (r0 < 1 && (p.ripe || 0) >= 1) out.push({ id: p.id, what: 'ripe' });
    if (w0 >= THIRSTY && p.water < THIRSTY) out.push({ id: p.id, what: 'thirsty' });
    if (d0 < .5 && droopOf(p) >= .5) out.push({ id: p.id, what: 'drooping' });
  }
  return out;
}

/** A pot in a few words for Claude: "Sunny the sunflower, in bud (day 4), would love a drink". */
export function potLine(p, now = Date.now()) {
  if (!p) return 'empty';
  const k = KINDS[p.kind], day = Math.floor((now - p.planted) / (24 * HOUR)) + 1;
  const stage = p.g >= 1 && k.ripen ? (p.ripe >= 1 ? 'with ripe strawberries to pick' : 'in flower, strawberries coming') : stageOf(p.g);
  const thirst = droopOf(p) >= .5 ? ', drooping: it badly needs water' : p.water <= 0 ? ', dry: it needs water' : p.water < THIRSTY ? ', would love a drink soon' : p.water > .85 ? ', just watered' : '';
  return `${p.name ? `${p.name} the ${p.kind}` : `a ${p.kind}`}, ${stage} (day ${day})${thirst}`;
}

/** Names a pot: "left", "the middle one", "Sunny", "the tulip" → its index, or -1. */
export function potIndex(words, pots) {
  const t = String(words || '').toLowerCase();
  if (!t.trim()) return -1;
  const byName = pots.findIndex(p => p?.name && t.includes(p.name.toLowerCase()));
  if (byName >= 0) return byName;
  if (/\bleft\b|\bfirst\b/.test(t)) return 0;
  if (/\bmiddle\b|\bcent(re|er)\b|\bsecond\b/.test(t)) return 1;
  if (/\bright\b|\bthird\b|\blast\b/.test(t)) return 2;
  const k = kindOf(t);
  return k ? pots.findIndex(p => p?.kind === k) : -1;
}

const local = {
  load: () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  save: o => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* a private window: kept until it closes */ } },
};
const okPot = p => p && KINDS[p.kind] && [p.g, p.water, p.dry, p.at, p.planted].every(Number.isFinite);

/**
 * The garden's numbers: makePlants({ store, now }). pots: three (null when empty). Every change is saved. The time
 * away is caught up when it is made: `away` lists what happened meanwhile (advance's events).
 */
export function makePlants({ store = local, now = () => Date.now() } = {}) {
  const kept = store.load() || {};
  const pots = POTS.map((_, i) => okPot(kept.pots?.[i]) ? { ...kept.pots[i] } : null);
  let ids = 0;
  const save = () => store.save({ pots });
  const away = [];
  for (const p of pots) if (p) away.push(...advance(p, now()));
  save();

  return {
    pots,
    /** What happened while they were away (caught up on load). */
    away,
    /** Catches every pot up to now; returns what changed. */
    tick() { const out = []; for (const p of pots) if (p) out.push(...advance(p, now())); if (out.length) save(); return out; },
    /** Plants a seed of `kind` in pot i (or the first empty one). Returns the pot, or null if there is no room. */
    plant(kind, { pot = -1, name = '', colour = null } = {}) {
      const i = pot >= 0 ? pot : pots.findIndex(p => !p);
      if (i < 0 || !KINDS[kind]) return null;
      const t = now();
      pots[i] = { id: `p${t.toString(36)}${(ids++).toString(36)}`, kind, name: capital(name), colour, planted: t, at: t, g: 0, water: 1, dry: 0, ripe: 0, picked: 0, seed: Math.floor(Math.random() * 1e6) };
      save(); return pots[i];
    },
    /** Waters pot i. Returns how much it needed (0..1). */
    water(i) { const p = pots[i]; if (!p) return 0; advance(p, now()); const need = 1 - p.water; p.water = 1; p.dry = 0; save(); return need; },
    /** Picks pot i's flower or fruit: it goes back to a bud (or an unripe berry) and grows another. */
    pick(i) { const p = pots[i]; if (!p) return false; advance(p, now()); const k = KINDS[p.kind]; if (k.ripen ? p.ripe < 1 : p.g < 1) return false; if (k.ripen) p.ripe = 0; else p.g = .82; p.picked++; save(); return true; },
    /** Empties pot i. */
    dig(i) { const p = pots[i]; pots[i] = null; save(); return p; },
    rename(i, name) { const p = pots[i]; if (!p) return null; p.name = capital(name); save(); return p; },
    /** Time passes faster, for tests: moves every pot `hours` on. */
    skip(hours) { const out = []; for (const p of pots) if (p) { p.at -= hours * HOUR; p.planted -= hours * HOUR; out.push(...advance(p, now())); } save(); return out; },
    save,
  };
}
