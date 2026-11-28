// Pure state for Mood-Reactive Room Themes & Custom Presets (no Three.js).
const KEY = 'reverie.themes.v1';

export const BUILTIN_THEMES = {
  default: {
    name: 'Cosy Workshop',
    room: { reset: true },
    colours: { reset: true },
    window: { time: 'live', weather: 'live' },
    effect: null,
  },
  spaceship: {
    name: 'Starship Deck',
    room: { walls: '#2a3345', floor: '#1d222e', rug: '#26466b', wood: '#50607a' },
    colours: { body: '#c4d8f2', glow: '#38e8ff' },
    window: { time: 'night', weather: 'clear' },
    effect: 'magic',
  },
  cabin: {
    name: 'Cosy Cabin',
    room: { walls: '#8b5e3c', floor: '#5e3c24', rug: '#355c42', wood: '#6e4527' },
    colours: { glow: '#ff9638' },
    window: { time: 'night', weather: 'snow' },
    effect: 'snow',
    radio: 'fireplace',
  },
  underwater: {
    name: 'Underwater Lair',
    room: { walls: '#1f5a6e', floor: '#c9b48a', rug: '#2a8599', wood: '#4a7a85' },
    colours: { body: '#9de4eb', glow: '#30ffd6' },
    window: { time: 'dusk', weather: 'rain' },
    effect: 'bubbles',
    radio: 'waves',
  },
  halloween: {
    name: 'Spooky Workshop',
    room: { walls: '#362742', floor: '#261e2c', rug: '#6e3a1f', wood: '#3d2f45' },
    colours: { body: '#b39ddb', glow: '#ff7b1c' },
    window: { time: 'night', weather: 'storm' },
    wear: { put_on: ['wizard'] },
    effect: 'magic',
  },
  enchanted: {
    name: 'Enchanted Grove',
    room: { walls: '#44634c', floor: '#594534', rug: '#3c7a57', wood: '#6b553b' },
    colours: { body: '#c7edd0', glow: '#78ff9b' },
    window: { time: 'sunset', weather: 'clear' },
    effect: 'magic',
    radio: 'forest',
  },
  sakura: {
    name: 'Sakura Dawn',
    room: { walls: '#f2d9df', floor: '#c9a68a', rug: '#e6a5b8', wood: '#b88c74' },
    colours: { body: '#ffd6e2', glow: '#ff75a8' },
    window: { time: 'dawn', weather: 'clear' },
    effect: 'confetti',
  },
  cyberpunk: {
    name: 'Neon Loft',
    room: { walls: '#1e1b33', floor: '#181624', rug: '#521f5e', wood: '#2d2847' },
    colours: { body: '#b8b2f2', glow: '#ff38c7' },
    window: { time: 'night', weather: 'rain' },
    effect: 'magic',
    radio: 'lofi',
  },
};
export const THEME_NAMES = Object.keys(BUILTIN_THEMES);

export function themeKeyOf(raw, custom = {}) {
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return null;
  if (BUILTIN_THEMES[s]) return s;
  if (custom[s]) return s;
  if (/space|starship|sci.?fi|rocket|galaxy/.test(s)) return 'spaceship';
  if (/cabin|lodge|chalet|winter|cosy|cozy/.test(s)) return 'cabin';
  if (/water|ocean|sea|aqua|mermaid|submarine/.test(s)) return 'underwater';
  if (/spooky|halloween|haunt|witch|ghost/.test(s)) return 'halloween';
  if (/enchant|forest|fairy|woodland|jungle/.test(s)) return 'enchanted';
  if (/sakura|cherry|blossom|spring|pink/.test(s)) return 'sakura';
  if (/cyber|neon|synth|vapor|futur/.test(s)) return 'cyberpunk';
  if (/default|normal|reset|original|workshop/.test(s)) return 'default';
  const hit = Object.keys(custom).find(k => k.includes(s) || s.includes(k));
  return hit || null;
}

const memStore = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

export function makeThemesState({ store = typeof localStorage !== 'undefined' ? localStorage : memStore() } = {}) {
  let custom = {}, current = 'default';
  try {
    const raw = JSON.parse(store.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      if (raw.custom && typeof raw.custom === 'object') custom = raw.custom;
      if (typeof raw.current === 'string') current = raw.current;
    }
  } catch { /* fresh */ }

  const save = () => { try { store.setItem(KEY, JSON.stringify({ custom, current })); } catch { /* private */ } };

  function get(raw) {
    const k = themeKeyOf(raw, custom);
    if (!k) return null;
    return { key: k, theme: BUILTIN_THEMES[k] || custom[k], isCustom: !BUILTIN_THEMES[k] };
  }

  function savePreset(name, snapshot) {
    const key = String(name || '').toLowerCase().replace(/[^a-z0-9 _-]+/g, '').trim().slice(0, 32);
    if (!key) return { error: 'Give a short name for this room preset.' };
    if (BUILTIN_THEMES[key]) return { error: `"${key}" is a built-in theme — pick another name for your custom preset.` };
    if (Object.keys(custom).length >= 8 && !custom[key]) return { error: 'You already have 8 saved presets. Delete one first.' };
    custom[key] = { name: name.trim().slice(0, 32), ...snapshot };
    current = key; save();
    return { key, text: `Saved your current room look as the "${custom[key].name}" preset!` };
  }

  function removePreset(name) {
    const key = themeKeyOf(name, custom);
    if (!key || !custom[key]) return { error: `No custom preset called "${name}".` };
    const label = custom[key].name;
    delete custom[key];
    if (current === key) current = 'default';
    save();
    return { text: `Deleted the custom preset "${label}".` };
  }

  function markCurrent(key) { current = key; save(); }

  function list() {
    const customNames = Object.keys(custom);
    return `Built-in themes: ${THEME_NAMES.join(', ')}.${customNames.length ? ` Your saved presets: ${customNames.join(', ')}.` : ''}`;
  }

  return {
    get current() { return current; },
    get custom() { return { ...custom }; },
    get, savePreset, removePreset, markCurrent, list,
  };
}
