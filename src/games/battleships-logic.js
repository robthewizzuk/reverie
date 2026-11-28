// Pure Battleships logic (6x6 ocean grid, 4 ships per fleet, smart hunt-and-target + parity AI).
// No Three.js — testable directly in Node.

export const GRID_SIZE = 6;
export const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const FLEET = [
  { id: 'carrier', name: 'Flagship', len: 4 },
  { id: 'cruiser', name: 'Cruiser', len: 3 },
  { id: 'destroyer', name: 'Destroyer', len: 2 },
  { id: 'patrol', name: 'Patrol Boat', len: 2 },
];

function makeRng(seed) {
  if (seed == null) return Math.random;
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const coordName = (r, c) => `${COLS[c]}${r + 1}`;

/** Parses a spoken or typed coordinate ("B4", "b 4", "fire at C3", "top left") into { r, c } or null. */
export function parseCoord(raw) {
  const s = String(raw || '').toLowerCase().trim();
  const m = /\b([a-f])\s*[-]?\s*([1-6])\b/.exec(s);
  if (m) return { r: parseInt(m[2], 10) - 1, c: COLS.indexOf(m[1].toUpperCase()) };
  if (/\btop\s+left\b/.test(s)) return { r: 0, c: 0 };
  if (/\btop\s+right\b/.test(s)) return { r: 0, c: GRID_SIZE - 1 };
  if (/\bbottom\s+left\b/.test(s)) return { r: GRID_SIZE - 1, c: 0 };
  if (/\bbottom\s+right\b/.test(s)) return { r: GRID_SIZE - 1, c: GRID_SIZE - 1 };
  if (/\b(centre|center|middle)\b/.test(s)) return { r: 2, c: 2 };
  return null;
}

function emptyGrid() { return Array.from({ length: GRID_SIZE }, () => new Array(GRID_SIZE).fill(0)); }

/** Places the fleet randomly on a 6x6 grid without overlaps. */
export function placeFleet(R = Math.random) {
  const grid = emptyGrid();
  const ships = [];
  for (const def of FLEET) {
    let placed = false;
    for (let tries = 0; tries < 200 && !placed; tries++) {
      const horiz = R() < .5;
      const r0 = Math.floor(R() * (horiz ? GRID_SIZE : GRID_SIZE - def.len + 1));
      const c0 = Math.floor(R() * (horiz ? GRID_SIZE - def.len + 1 : GRID_SIZE));
      const cells = [];
      let clear = true;
      for (let i = 0; i < def.len; i++) {
        const r = horiz ? r0 : r0 + i, c = horiz ? c0 + i : c0;
        if (grid[r][c]) { clear = false; break; }
        cells.push([r, c]);
      }
      if (!clear) continue;
      const ship = { ...def, horiz, cells, hits: 0, sunk: false };
      for (const [r, c] of cells) grid[r][c] = ship.id;
      ships.push(ship);
      placed = true;
    }
  }
  return { grid, ships };
}

/**
 * Pure Battleships match state.
 * level: 1 (playful/random) .. 5 (sharp hunt-target + checkerboard parity).
 * skill: optional 0..1 adaptive dial from Tiny Brains.
 */
export function makeBattleshipsGame({ seed = null, level = 2, skill = null } = {}) {
  const R = makeRng(seed);
  const player = placeFleet(R);
  const ai = placeFleet(R);
  // shots[r][c]: 0 = untouched, 1 = miss, 2 = hit
  const playerShots = emptyGrid();
  const aiShots = emptyGrid();
  let state = 'play', result = '', turns = 0;
  const aiQueue = [];

  const effSkill = skill != null ? Math.max(0, Math.min(1, skill)) : (Math.max(1, Math.min(5, level)) - 1) / 4;

  function applyShot(board, shots, r, c) {
    if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) return { ok: false, text: 'That coordinate is off the board (use A1 to F6).' };
    if (shots[r][c] !== 0) return { ok: false, text: `Already fired at ${coordName(r, c)}.` };
    const shipId = board.grid[r][c];
    if (!shipId) {
      shots[r][c] = 1;
      return { ok: true, hit: false, sunk: null, r, c, coord: coordName(r, c) };
    }
    shots[r][c] = 2;
    const ship = board.ships.find(s => s.id === shipId);
    ship.hits++;
    if (ship.hits >= ship.len) ship.sunk = true;
    const allSunk = board.ships.every(s => s.sunk);
    return { ok: true, hit: true, sunk: ship.sunk ? ship : null, allSunk, r, c, coord: coordName(r, c) };
  }

  function pickAiTarget() {
    // Use target queue around known hits (probability scales with skill)
    while (aiQueue.length && R() < .45 + effSkill * .55) {
      const [r, c] = aiQueue.shift();
      if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE && aiShots[r][c] === 0) return [r, c];
    }
    // Gather untouched cells; at higher skill prefer checkerboard parity
    const parity = [], other = [];
    for (let r = 0; r < GRID_SIZE; r++) for (let c = 0; c < GRID_SIZE; c++) {
      if (aiShots[r][c] !== 0) continue;
      if ((r + c) % 2 === 0) parity.push([r, c]); else other.push([r, c]);
    }
    const pool = (parity.length && R() < .25 + effSkill * .7) ? parity : (parity.length + other.length ? [...parity, ...other] : []);
    if (!pool.length) return null;
    return pool[Math.floor(R() * pool.length)];
  }

  function fire(r, c) {
    if (state !== 'play') return { ok: false, text: 'The battle is already over.' };
    const p = applyShot(ai, playerShots, r, c);
    if (!p.ok) return p;
    turns++;
    if (p.allSunk) {
      state = 'over'; result = 'win';
      return { ok: true, player: p, ai: null, over: true, result, text: `Direct hit at ${p.coord}! You sank Reverie's ${p.sunk.name} — fleet cleared, you win!` };
    }
    // Reverie fires back
    const target = pickAiTarget();
    let a = null;
    if (target) {
      a = applyShot(player, aiShots, target[0], target[1]);
      if (a.hit && !a.sunk) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of dirs) {
          const nr = a.r + dr, nc = a.c + dc;
          if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE && aiShots[nr][nc] === 0) aiQueue.push([nr, nc]);
        }
      }
      if (a.allSunk) { state = 'over'; result = 'lose'; }
    }
    const pDesc = p.sunk ? `You hit ${p.coord} and sank Reverie's ${p.sunk.name}!` : p.hit ? `Hit at ${p.coord}!` : `Splash — miss at ${p.coord}.`;
    const aDesc = !a ? '' : a.allSunk ? ` Reverie fired at ${a.coord}, sank your ${a.sunk.name}, and won the battle!`
      : a.sunk ? ` Reverie fired at ${a.coord} and sank your ${a.sunk.name}!`
      : a.hit ? ` Reverie hit your ship at ${a.coord}!`
      : ` Reverie missed at ${a.coord}.`;
    return { ok: true, player: p, ai: a, over: state === 'over', result, text: pDesc + aDesc };
  }

  function summary() {
    const pLeft = player.ships.filter(s => !s.sunk).length;
    const aLeft = ai.ships.filter(s => !s.sunk).length;
    return `Battleships (6x6, A1–F6): your ships left ${pLeft}/${FLEET.length}, Reverie's ships left ${aLeft}/${FLEET.length}, turn ${turns}.${state === 'over' ? ` Battle over: ${result}.` : ' Their shot (say a square like B4 or tap the right board).'}`;
  }

  return {
    level,
    get state() { return state; },
    get result() { return result; },
    get turns() { return turns; },
    get player() { return player; },
    get ai() { return ai; },
    get playerShots() { return playerShots; },
    get aiShots() { return aiShots; },
    fire, summary,
  };
}
