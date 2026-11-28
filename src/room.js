// Reverie's room as you made it: the colours of its walls, floor, rug and woodwork, and the things you asked it to
// keep in the room (made by the generator, then carried by Reverie to a spot you named). Kept on this device, so the
// room is as you left it next time. No three.js in here: world.js builds what this describes, and tests can read it.
import { colourOf } from './looks.js';
import { inside, backZ, sideX, WINDOW } from './shell.js';

const KEY = 'reverie.room.v1';
export const MAX_ITEMS = 16;

export const DEFAULT_ROOM = { walls: '#ebe4da', floor: '#c9a882', rug: '#d39a80', wood: '#c69c72' };
export const PARTS = Object.keys(DEFAULT_ROOM);

// The things fixed to the back wall, which curves round behind them (the room is a round capsule, shell.js): each a
// board that follows the curve, from x0 to x1 at height y (its top), d deep. The desk floats on the wall like the shelf
// (no legs: the floor curves up into the wall where they would stand).
export const DESK = { x0: .54, x1: 1.64, y: .70, d: .48 };
export const SHELF = { x0: -1.30, x1: -.58, y: .94, d: .22 };
export const SILL = { x0: -.38, x1: .38, y: .88, d: .16 };
// the ledge along the bottom of the big left window: from the glass (x0) to a little into the room (x1), its top at y,
// along the straight part of the window's bottom edge (z0 to z1)
export const LEDGE = { x0: WINDOW.x, x1: sideX((WINDOW.z0 + WINDOW.z1) / 2, WINDOW.y0) + .12, y: WINDOW.y0 + .012, z0: WINDOW.z0 + WINDOW.r - .06, z1: WINDOW.z1 - WINDOW.r + .06 };
/** A point on a board on the wall: at x, its middle out from the wall [x, y, z]. */
export const onBoard = (B, x) => [x, B.y, backZ(x, B.y - .02) + .012 + B.d / 2];

/**
 * The places in the room it can put things, in metres (the creature stands at 0, 0 facing the camera at +z; the
 * room is round, its back wall about z = -1.7 and its left wall x = -2.3: shell.js). y is the surface it stands on;
 * spread is the line further things go along when the first place is taken; board: on a board on the wall (z then
 * follows the curve).
 */
export const SPOTS = {
  'left of you': { at: [-.6, 0, .1], spread: [-.4, -.25], about: 'on the floor just to your left' },
  'right of you': { at: [.6, 0, .1], spread: [.4, -.25], about: 'on the floor just to your right' },
  'in front of you': { at: [0, 0, .5], spread: [.35, 0], about: 'on the rug in front of you' },
  'on the rug': { at: [-.45, .012, .45], spread: [.3, .1], about: 'on the rug' },
  'by the window': { at: [0, 0, -1.15], spread: [.32, 0], about: 'on the floor under the round window' },
  'on the windowsill': { at: onBoard(SILL, 0), board: SILL, spread: [.2, 0], small: true, about: 'on the windowsill' },
  'on the workbench': { at: onBoard(DESK, 1.36), board: DESK, spread: [-.22, 0], small: true, about: 'on the desk' },
  'on the shelf': { at: onBoard(SHELF, -.94), board: SHELF, spread: [.18, 0], small: true, about: 'on the shelf' },
  'back left corner': { at: [-1.55, 0, -.55], spread: [.3, .35], about: 'in the back left corner, by the pouf' },
  'by the plant': { at: [1.75, 0, .05], spread: [0, .4], about: 'on the right, by the plant' },
  'under the workbench': { at: [1.0, 0, -1.08], spread: [.35, 0], about: 'under the desk' },
  'by the left wall': { at: [-1.6, 0, .35], spread: [0, .4], about: 'against the left wall, under the big window' },
  'front left': { at: [-1.05, 0, .75], spread: [-.35, -.2], about: 'at the front on the left' },
  'front right': { at: [1.05, 0, .75], spread: [.35, -.2], about: 'at the front on the right' },
};
export const SPOT_NAMES = Object.keys(SPOTS);

/** The spot a name means ("window" → "by the window", "bench" or "desk" → "on the workbench"), or null. */
export function spotOf(name) {
  const t = String(name || '').toLowerCase().trim();
  if (SPOTS[t]) return t;
  const words = t.replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(w => w.length > 2 && !['the', 'you', 'your', 'and', 'next', 'put'].includes(w));
  let best = null, score = 0;
  for (const s of SPOT_NAMES) {
    const n = words.filter(w => s.includes(w) || ((w === 'bench' || w === 'desk' || w === 'table') && s.includes('workbench')) || (w === 'sill' && s.includes('windowsill'))).length;
    if (n > score) { best = s; score = n; }
  }
  return best;
}

function load() {
  try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}
const okItem = i => i && typeof i.words === 'string' && i.words && [i.x, i.y, i.z].every(Number.isFinite);
const cleanItem = ({ pivot, body, life, open, flexing, brushed, ...rest }) => rest;
const kept = load();
const now = {
  colours: { ...DEFAULT_ROOM, ...Object.fromEntries(Object.entries(kept.colours || {}).filter(([k, c]) => k in DEFAULT_ROOM && /^#[0-9a-f]{6}$/.test(c))) },
  items: (Array.isArray(kept.items) ? kept.items : []).filter(okItem).map(cleanItem).slice(0, MAX_ITEMS),
};
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(now)); } catch { /* a private window: kept until it closes */ }
}

/** The room's colours now: { walls, floor, rug, wood } as '#rrggbb'. */
export const roomColours = () => ({ ...now.colours });
/** The things kept in the room: [{ id, words, seed, sizeK, size, spot, x, y, z, ry, r, short }]. */
export const roomItems = () => now.items.map(i => ({ ...i }));

/** The room colour tool's input checked: { colours, changed } or { error }. */
export function tidyRoomColours(input = {}, THREE) {
  if (input.reset) return { colours: { ...DEFAULT_ROOM }, changed: PARTS };
  const out = { ...now.colours }, changed = [];
  for (const k of PARTS) {
    if (input[k] == null || input[k] === '') continue;
    if (/^(default|normal|own|original)$/i.test(String(input[k]).trim())) { out[k] = DEFAULT_ROOM[k]; changed.push(k); continue; }
    const c = colourOf(input[k], THREE);
    if (!c) return { error: `"${input[k]}" is not a colour I know: use #rrggbb` };
    out[k] = c; changed.push(k);
  }
  if (!changed.length) return { error: `give at least one of ${PARTS.join(', ')}` };
  return { colours: out, changed };
}
export function keepRoomColours(c) { now.colours = { ...c }; save(); }

/** Keeps a thing placed in the room (replacing one with the same id). */
export function keepItem(item) {
  now.items = now.items.filter(i => i.id !== item.id);
  now.items.push(cleanItem(item));
  while (now.items.length > MAX_ITEMS) now.items.shift();
  save();
}
export function forgetItem(id) { now.items = now.items.filter(i => i.id !== id); save(); }
export function forgetAll() { now.items = []; save(); }

// Fixed workshop props (desk aquarium, radio, lamp) so placed items don't clip into them.
export const FIXTURES = [
  { name: 'aquarium', x: .84,  y: DESK.y, z: -1.12, r: .24 },
  { name: 'radio',    x: 1.20, y: DESK.y, z: -1.16, r: .16 },
  { name: 'lamp',     x: 1.50, y: DESK.y, z: -1.25, r: .14 },
];

/**
 * Where a new thing of radius r goes at a spot, among what is already in the room: the spot itself if it is free,
 * else the next free place along its spread. near: a placed item to stand it beside instead. Returns { x, y, z }.
 */
export function freePlace(spot, r, items, near = null) {
  const S = SPOTS[spot];
  const obstacles = [...items, ...FIXTURES];
  const clear = (x, z) => obstacles.every(i => Math.abs(i.y - S.at[1]) > .2 || Math.hypot(i.x - x, i.z - z) > (i.r || .15) + r + .03);
  if (near) {
    // beside it, on the side towards the middle of the room first, then round it
    const a0 = Math.atan2(-near.z, -near.x);
    for (const da of [0, Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, Math.PI]) {
      const d = (near.r || .15) + r + .05, x = near.x + Math.cos(a0 + da) * d, z = near.z + Math.sin(a0 + da) * d;
      if (inRoom(x, z, r) && clear(x, z)) return { x, y: near.y, z };
    }
  }
  const [sx, sz] = S.spread;
  for (let k = 0; k < 10; k++) {
    // 0, +1, -1, +2, -2... steps along the spread
    const n = k === 0 ? 0 : Math.ceil(k / 2) * (k % 2 ? 1 : -1);
    const x = S.at[0] + sx * n, z = S.board ? onBoard(S.board, x)[2] : S.at[2] + sz * n;
    if (S.board && (x - r < S.board.x0 || x + r > S.board.x1)) continue;   // (off the end of the board)
    if ((S.board || inRoom(x, z, r, S.at[1])) && clear(x, z)) return { x, y: S.at[1], z };
  }
  return { x: S.at[0], y: S.at[1], z: S.at[2] };   // (all taken: it goes at the spot anyway, a little crowded)
}
/** Inside the walls, clear of the curve (at height y), not too near the camera, and off the creature's own patch. */
export function inRoom(x, z, r = 0, y = 0) { return inside(x, y + .03, z) > r + .02 && z + r < 1.3 && Math.hypot(x, z) > .3 + r; }

/** The placed thing words like "the lamp" or "teapot" mean (the newest that fits), or null. */
export function findItem(words, items) {
  const t = String(words || '').toLowerCase().replace(/^(the|a|an|my|that|this)\s+/, '').trim();
  if (!t) return null;
  const ws = t.split(/\s+/).filter(w => w.length > 2);
  for (let i = items.length - 1; i >= 0; i--) if (items[i].words.toLowerCase().includes(t) || items[i].short?.toLowerCase().includes(t)) return items[i];
  for (let i = items.length - 1; i >= 0; i--) if (ws.some(w => (items[i].words + ' ' + (items[i].short || '') + ' ' + (items[i].desc || '')).toLowerCase().includes(w))) return items[i];
  return null;
}

/** The room in a line for Claude. */
export function roomLine(items, colours = now.colours) {
  const where = items.map(i => `${i.short || i.words} (${i.spot})`);
  const changed = PARTS.filter(k => colours[k] !== DEFAULT_ROOM[k]).map(k => `${k} ${colours[k]}`);
  return (where.length ? ` In the room: ${where.join(', ')}.` : '') + (changed.length ? ` Room colours: ${changed.join(', ')}.` : '');
}
