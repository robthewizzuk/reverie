// How Reverie sounds and looks, as it chose when asked ("talk like a pirate", "go purple"), kept on this device.
// The voice is one of the engine's built-in voices (voices.js) with the engine's size, liveliness and effects on top.
// The colours are its plush body and its glowing core.
import { byName, EFFECTS } from './voices.js';

// Its own voice: a British woman's, a little smaller and livelier than she is (the same one it always had).
export const DEFAULT_VOICE = { name: '', size: .92, lively: .65, effect: 'none' };
export const DEFAULT_COLOURS = { body: '#e8dccb', glow: '#ff5200' };

const KEY = 'reverie.looks.v1';
const num = (v, lo, hi) => Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : null;

/** A colour as '#rrggbb' from hex ('#abc', 'abc123') or a CSS colour name ('sky blue', 'hotpink'), or null. */
export function colourOf(s, THREE) {
  const t = String(s ?? '').trim().toLowerCase();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t);
  if (hex) { const h = hex[1]; return '#' + (h.length === 3 ? [...h].map(c => c + c).join('') : h); }
  const name = t.replace(/[\s-]+/g, '');
  const named = THREE?.Color?.NAMES?.[name];
  return named != null ? '#' + named.toString(16).padStart(6, '0') : null;
}

function load() {
  try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ voice: now.voice, colours: now.colours })); } catch { /* a private window: kept until it closes */ }
}

// what it is now (read once from the device, then changed by the tools)
const kept = load();
const now = {
  voice: { ...DEFAULT_VOICE, ...tidyVoice(kept.voice || {}, DEFAULT_VOICE).voice },
  colours: { ...DEFAULT_COLOURS, ...Object.fromEntries(Object.entries(kept.colours || {}).filter(([k, c]) => k in DEFAULT_COLOURS && /^#[0-9a-f]{6}$/.test(c))) },
};

/** The voice input checked against what is there: { voice } or { error }. Leaves out what wasn't given. */
function tidyVoice(input, base) {
  const out = { ...base };
  if (input.name != null) {
    const n = String(input.name).trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (n === '' || n === 'default' || n === 'own' || n === 'normal') out.name = '';
    else if (byName.has(n)) out.name = n;
    else return { error: `there is no voice called "${input.name}"` };
  }
  if (input.size != null) { const s = num(input.size, .7, 1.4); if (s == null) return { error: 'size must be a number' }; out.size = s; }
  if (input.lively != null) { const l = num(input.lively, 0, 1); if (l == null) return { error: 'lively must be a number' }; out.lively = l; }
  if (input.effect != null) { const e = String(input.effect).toLowerCase(); if (!EFFECTS.includes(e)) return { error: `effect must be one of ${EFFECTS.join(', ')}` }; out.effect = e; }
  return { voice: out };
}

// How its name is said, by every voice: REV-uh-ree. Only the sound changes: the bubble still reads "Reverie", and the
// engine maps each spoken word back to the written one, so the mouth stays in step ("Reverie's" is covered too).
export const SAY_AS = { Reverie: 'rev uh ree' };

// its mood's share of the voice (mood.js toneOf): { lively, size, mood } added to the voice it chose, or null
let tone = () => null;
/** Who says how its mood colours its voice: a function returning { lively, size, mood } (mood.js toneOf). */
export function setTone(fn) { tone = fn || (() => null); }

/** The options for gs.sound.say / prepare, for the voice it has now (and the mood it is in). */
export function sayOptions() {
  const v = now.voice, t = tone() || {};
  // (a voice by name: the fragment is its name as the engine lists it, "Jule (built in", so "jule" never finds "jules")
  const voice = v.name ? { like: [v.name.replace(/_/g, ' ') + ' (built in'] } : { kind: 'woman', lang: ['en-GB'], take: 2 };
  const size = Math.max(.7, Math.min(1.4, v.size * (t.size ?? 1))), lively = Math.max(0, Math.min(1, v.lively + (t.lively ?? 0)));
  return { voice, respell: SAY_AS, size: +size.toFixed(3), lively: +lively.toFixed(3), ...(t.mood ? { mood: t.mood } : {}), ...(v.effect !== 'none' ? { fx: v.effect } : {}) };
}

/** A sentence saying what a voice is, for Claude. */
const told = v => `${v.name ? `${v.name.replace(/_/g, ' ')} (${byName.get(v.name).about})` : 'your own voice'}, size ${v.size.toFixed(2)}, liveliness ${v.lively.toFixed(2)}, ${v.effect === 'none' ? 'no effect' : `the ${v.effect} effect`}`;

/** The voice tool: changes what was given, keeps the rest. Returns { text, error? }. */
export function setVoice(input = {}) {
  if (input.reset) now.voice = { ...DEFAULT_VOICE };
  else {
    const r = tidyVoice(input, now.voice);
    if (r.error) return { text: `Not changed: ${r.error}.`, error: true };
    now.voice = r.voice;
  }
  save();
  return { text: `Your voice is now ${told(now.voice)}. Everything you say from here on uses it, and it is remembered next time.` };
}

/** The colours it has now: { body, glow } as '#rrggbb'. */
export const colours = () => ({ ...now.colours });

/** The colour tool's input checked: { colours } or { error }. */
export function tidyColours(input = {}, THREE) {
  if (input.reset) return { colours: { ...DEFAULT_COLOURS } };
  const out = { ...now.colours };
  for (const k of ['body', 'glow']) {
    if (input[k] == null || input[k] === '') continue;
    if (/^(default|normal|own|original)$/i.test(String(input[k]).trim())) { out[k] = DEFAULT_COLOURS[k]; continue; }
    const c = colourOf(input[k], THREE);
    if (!c) return { error: `"${input[k]}" is not a colour I know: use #rrggbb` };
    out[k] = c;
  }
  return { colours: out };
}
/** Keeps colours that were applied. */
export function keepColours(c) { now.colours = { ...c }; save(); }
