// Pure state for Reverie's mini desk aquarium (no Three.js, testable in Node).
// Kept in localStorage: up to 5 aquatic friends, optional tank decor, and when they were last fed.
// Fish never die — if hungry (after ~18h), they swim near the surface looking hopeful until fed.

const KEY = 'reverie.aquarium.v1';
export const MAX_FISH = 5;
export const HUNGRY_MS = 18 * 3600e3;

export const SPECIES = {
  goldfish: { label: 'goldfish', col: '#ff8a2a', glow: false, size: 1.0, names: ['Bubbles', 'Goldie', 'Nugget', 'Marmalade'] },
  clownfish: { label: 'clownfish', col: '#ff5e28', stripe: '#ffffff', glow: false, size: .92, names: ['Coral', 'Nemo', 'Pip', 'Tangerine'] },
  betta: { label: 'betta', col: '#3a78ff', glow: false, size: 1.08, names: ['Indigo', 'Velvet', 'Splash', 'Sapphire'] },
  neon: { label: 'neon tetra', col: '#2be4ff', stripe: '#ff3b5c', glow: true, size: .75, names: ['Spark', 'Zippy', 'Flash', 'Pixel'] },
  seahorse: { label: 'seahorse', col: '#f2c14e', glow: false, size: 1.05, names: ['Clover', 'Curl', 'Barnaby', 'Saffron'] },
  jellyfish: { label: 'jellyfish', col: '#d17aff', glow: true, size: 1.15, names: ['Luna', 'Glimmer', 'Wobble', 'Aurora'] },
  puffer: { label: 'pufferfish', col: '#e8d06b', glow: false, size: 1.0, names: ['Puff', 'Bloop', 'Mochi', 'Squish'] },
};
export const SPECIES_NAMES = Object.keys(SPECIES);
export const DECORS = ['none', 'castle', 'pirate_ship', 'coral', 'treasure', 'plants'];

/** Matches a user's words to one of SPECIES_NAMES. */
export function speciesOf(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return 'goldfish';
  if (SPECIES[s]) return s;
  if (/jelly/.test(s)) return 'jellyfish';
  if (/sea\s*horse/.test(s)) return 'seahorse';
  if (/clown|nemo/.test(s)) return 'clownfish';
  if (/betta|fighter|siamese/.test(s)) return 'betta';
  if (/neon|tetra|glow/.test(s)) return 'neon';
  if (/puffer|blow/.test(s)) return 'puffer';
  return 'goldfish';
}

export function decorOf(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (!s || /none|clear|empty|remove/.test(s)) return 'none';
  if (/castle|tower|fort/.test(s)) return 'castle';
  if (/pirate|ship|boat|wreck/.test(s)) return 'pirate_ship';
  if (/coral|reef/.test(s)) return 'coral';
  if (/treasure|chest|gold/.test(s)) return 'treasure';
  if (/plant|kelp|weed|moss/.test(s)) return 'plants';
  return 'castle';
}

const memStore = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

export function makeAquariumState({ store = typeof localStorage !== 'undefined' ? localStorage : memStore(), clock = () => Date.now() } = {}) {
  let data = { fish: [], decor: 'plants', fedAt: 0, seq: 1 };
  try {
    const raw = JSON.parse(store.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      data.fish = Array.isArray(raw.fish) ? raw.fish.filter(f => f && f.kind && SPECIES[f.kind]).slice(0, MAX_FISH) : [];
      data.decor = DECORS.includes(raw.decor) ? raw.decor : 'plants';
      data.fedAt = Number.isFinite(raw.fedAt) ? raw.fedAt : 0;
      data.seq = Number.isFinite(raw.seq) ? raw.seq : data.fish.length + 1;
    }
  } catch { /* fresh tank */ }

  const save = () => { try { store.setItem(KEY, JSON.stringify(data)); } catch { /* private window */ } };
  const isHungry = (now = clock()) => data.fish.length > 0 && (!data.fedAt || now - data.fedAt >= HUNGRY_MS);

  function add({ species, name, colour } = {}) {
    if (data.fish.length >= MAX_FISH) return { error: `The tank is full (${MAX_FISH} creatures already: ${data.fish.map(f => f.name).join(', ')}). Remove one first if you want a new friend.` };
    const kind = speciesOf(species), spec = SPECIES[kind];
    const used = new Set(data.fish.map(f => f.name.toLowerCase()));
    const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 24)
      : (spec.names.find(n => !used.has(n.toLowerCase())) || `${spec.label} ${data.seq}`);
    const f = { id: 'f' + data.seq++, kind, name: cleanName, colour: colour || spec.col, added: clock() };
    data.fish.push(f);
    if (!data.fedAt) data.fedAt = clock();
    save();
    return { fish: f, text: `Added ${f.name} the ${spec.label} to the desk aquarium! (${data.fish.length}/${MAX_FISH} in the tank.)` };
  }

  function feed() {
    if (!data.fish.length) return { error: 'The aquarium has no fish yet — add one first!' };
    data.fedAt = clock(); save();
    return { text: `Sprinkled food flakes into the aquarium! ${data.fish.map(f => f.name).join(', ')} swam right up to nibble them.` };
  }

  function setDecor(raw) {
    const d = decorOf(raw);
    data.decor = d; save();
    return { decor: d, text: d === 'none' ? 'Cleared the decoration out of the aquarium.' : `Placed a tiny ${d.replace('_', ' ')} inside the desk aquarium.` };
  }

  function findFish(q) {
    const s = String(q || '').toLowerCase().trim();
    if (!s) return data.fish.at(-1) || null;
    return data.fish.find(f => f.name.toLowerCase() === s)
      || data.fish.find(f => f.name.toLowerCase().includes(s) || f.kind.includes(s))
      || null;
  }

  function rename({ which, name } = {}) {
    const f = findFish(which);
    if (!f) return { error: 'Could not find that fish in the tank.' };
    const n = String(name || '').trim().slice(0, 24);
    if (!n) return { error: 'Give a new name for the fish.' };
    const old = f.name; f.name = n; save();
    return { fish: f, text: `Renamed ${old} to ${n}.` };
  }

  function remove({ which } = {}) {
    const f = findFish(which);
    if (!f) return { error: 'No matching fish in the aquarium.' };
    data.fish = data.fish.filter(x => x.id !== f.id);
    save();
    return { fish: f, text: `Let ${f.name} the ${SPECIES[f.kind].label} swim off to a bigger pond.` };
  }

  function line() {
    if (!data.fish.length) return '';
    const who = data.fish.map(f => `${f.name} (${SPECIES[f.kind].label})`).join(', ');
    return ` Aquarium on the desk: ${who}${data.decor !== 'none' ? ` with a tiny ${data.decor.replace('_', ' ')}` : ''}${isHungry() ? ' (hungry!)' : ''}.`;
  }

  function greet() {
    if (!data.fish.length) return '';
    if (isHungry()) return `[aquarium] Your desk aquarium fish (${data.fish.map(f => f.name).join(', ')}) are swimming near the top hoping for food.`;
    return '';
  }

  return {
    get fish() { return data.fish; },
    get decor() { return data.decor; },
    get fedAt() { return data.fedAt; },
    isHungry, add, feed, setDecor, rename, remove, line, greet,
  };
}
