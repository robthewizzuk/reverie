// Noughts and crosses on a little wooden board: you are the ivory crosses, Reverie the glowing noughts. Tap a square or
// say it ("top left", "middle", "bottom right", or 1 to 9 reading like a book). Rounds go on as long as you like, the
// first move swapping each round, with the score kept.
//
// Who picks Reverie's moves: the engine's game search (gs.solve.Search, which sees every way the game can go), with a
// mistake now and then at the lower levels; at level 5 it can't be beaten. Reverie reacts out loud to what matters
// (a block, a trap, the end of a round) from the news it is sent.
//
// A game here is an object the stage drives (see ./index.js for the shape every game has).
import gs from '../../engine/src/gamescroll.js';
import { table, clock, popIn, ease, words } from './parts.js';

const U = .095;                       // metres for one square
const TABLE_H = .3;
const CENTRE = { x: 0, z: .6 };       // the board's middle on the floor (the creature stands at the origin)
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const NAMES = ['top left', 'top middle', 'top right', 'middle left', 'centre', 'middle right', 'bottom left', 'bottom middle', 'bottom right'];
const SLIP = [.5, .28, .14, .05, 0];  // how often Reverie plays a random square instead of its best, by level
export const CAMERA = { pos: [0, 1.05, 1.32], look: [0, .3, .5] };

const winner = b => { for (const l of LINES) if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return { who: b[l[0]], line: l }; return null; };
const full = b => b.every(Boolean);
/** The squares where `who` would complete a line next move. */
const threats = (b, who) => LINES.filter(l => l.filter(i => b[i] === who).length === 2 && l.some(i => !b[i])).map(l => l.find(i => !b[i]));

// the game as the search sees it: b is the 9 squares (0 empty, 1 you, 2 Reverie), t whose turn it is
const brain = new gs.solve.Search({
  moves: s => winner(s.b) ? [] : s.b.map((x, i) => x ? -1 : i).filter(i => i >= 0),
  play: (s, i) => { const b = s.b.slice(); b[i] = s.t; return { b, t: 3 - s.t }; },
  turn: s => s.t,
  over: s => !!winner(s.b) || full(s.b),
  winner: s => winner(s.b)?.who ?? null,
  score: (s, p) => { const w = winner(s.b); return !w ? 0 : w.who === p ? 1 : -1; },
});

/** "top left", "the middle", "bottom right corner", "5": a square 0..8, or -1. */
export function squareOf(text) {
  const s = words(text).replace(/\b(the|square|one|corner|spot|please|go|i ll|ill|put|it|me|in|on|at|take|mine|there)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const n = /^(?:number )?([1-9])$/.exec(s); if (n) return +n[1] - 1;
  const num = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'].indexOf(s); if (num >= 0) return num;
  const row = /\b(top|upper|up)\b/.test(s) ? 0 : /\b(bottom|lower|down)\b/.test(s) ? 2 : /\b(middle|center|centre|mid)\b/.test(s) && /\b(left|right)\b/.test(s) ? 1 : null;
  const col = /\bleft\b/.test(s) ? 0 : /\bright\b/.test(s) ? 2 : /\b(middle|center|centre|mid)\b/.test(s) ? 1 : null;
  if (row === null && col === null) return -1;
  if (row === null) return col === 1 ? 4 : 3 + col;           // "left" alone: the middle of the left side
  return row * 3 + (col ?? 1);                                  // "top" alone: the top middle
}

export function makeNoughts(stage) {
  const { THREE, scene, creature } = stage, { slab, sounds } = gs.tabletop, { pbr, rbox } = gs.hd;
  let root, board, mats, glowLine, body = null;
  let b = Array(9).fill(0), pieces = [], state = 'off', level = 2, first = 1, score = { you: 0, me: 0, draw: 0 }, round = 0, t = 0;
  const clk = clock(), alive = my => my === clk.epoch && state !== 'off';
  const cellAt = i => ({ x: (i % 3) - 1, z: Math.floor(i / 3) - 1 });   // board units; row 0 is the far side

  function build() {
    root = table(THREE, { w: .62, d: .5, h: TABLE_H }); root.position.set(CENTRE.x, 0, CENTRE.z); root.name = 'game:noughts';
    board = new THREE.Group(); board.scale.setScalar(U); board.position.y = TABLE_H; root.add(board);
    board.add(slab({ w: 3.3, d: 3.3, thick: .3, rim: .22, wood: '#4a3526', rough: .5, strength: .5, paint(g, S) {
      const q = S / 3.3, o = .15 * q;
      g.col.fillStyle = '#ecdcc4'; g.col.fillRect(0, 0, S, S);
      g.col.strokeStyle = '#6b4a33'; g.col.lineCap = 'round'; g.col.lineWidth = S * .022;
      for (let i = 1; i < 3; i++) { g.col.beginPath(); g.col.moveTo(o + i * q, o + q * .12); g.col.lineTo(o + i * q, o + q * 2.88); g.col.moveTo(o + q * .12, o + i * q); g.col.lineTo(o + q * 2.88, o + i * q); g.col.stroke(); }
      g.h.strokeStyle = '#000'; g.h.lineWidth = S * .02;
      for (let i = 1; i < 3; i++) { g.h.beginPath(); g.h.moveTo(o + i * q, o); g.h.lineTo(o + i * q, o + 3 * q); g.h.moveTo(o, o + i * q); g.h.lineTo(o + 3 * q, o + i * q); g.h.stroke(); }
    } }));
    mats = { x: pbr('#efe7d6', { rough: .3, clear: .6 }), o: pbr('#ff9a4a', { rough: .35, clear: .5, glow: .9 }) };
    glowLine = new THREE.Mesh(rbox(3, .06, .1, .03), pbr('#ffe08a', { glow: 2.4 })); glowLine.visible = false; glowLine.position.y = .2; board.add(glowLine);
  }
  function piece(who) {
    const g = new THREE.Group();
    if (who === 1) { for (const a of [1, -1]) { const bar = new THREE.Mesh(rbox(.8, .16, .16, .07), mats.x); bar.rotation.y = a * Math.PI / 4; bar.position.y = .08; g.add(bar); } }
    else { const o = new THREE.Mesh(new THREE.TorusGeometry(.3, .085, 14, 36), mats.o); o.rotation.x = Math.PI / 2; o.position.y = .085; g.add(o); }
    g.traverse(m => { if (m.isMesh) m.castShadow = true; });
    return g;
  }
  const worldOf = i => { const c = cellAt(i), v = new THREE.Vector3(c.x, .1, c.z); return board.localToWorld(v); };

  function clearBoard() {
    for (const p of pieces) p.removeFromParent(); pieces = []; b = Array(9).fill(0);
    glowLine.visible = false;
  }

  /** Puts a piece down: yours drops in, Reverie's is reached for and set down by its hand. */
  async function put(i, who) {
    const my = clk.epoch, m = piece(who), c = cellAt(i);
    b[i] = who; m.position.set(c.x, 0, c.z); board.add(m); pieces.push(m);
    if (who === 2) {
      creature.reach(worldOf(i)); m.position.y = 1.6; m.scale.setScalar(.01);
      if (!await clk.wait(.3) || !alive(my)) return;
      stage.sparks(worldOf(i), '#ffa24a', 14);
      if (!await clk.tween(.35, k => { const e = ease(k); m.scale.setScalar(popIn(Math.min(1, k * 1.6))); m.position.y = 1.6 * (1 - e); creature.reach(board.localToWorld(m.position.clone())); })) return;
      creature.reach(null);
    } else {
      m.position.y = .8;
      await clk.tween(.22, k => { m.position.y = .8 * (1 - k * k); });
    }
    if (!alive(my)) return;
    sounds.clack(.8);
    await clk.tween(.15, k => m.scale.setScalar(1 + Math.sin(k * Math.PI) * .12));
  }

  const grid = () => [0, 1, 2].map(r => ['top', 'middle', 'bottom'][r] + ': ' + [0, 1, 2].map(c => ['X', 'O'][b[r * 3 + c] - 1] || '_').join(' ')).join(', ');
  const free = () => b.map((x, i) => x ? null : NAMES[i]).filter(Boolean);
  const tally = () => `Score: they have ${score.you}, you have ${score.me}${score.draw ? `, ${score.draw} drawn` : ''}.`;

  /** The end of a round: the line glows, and Reverie hears how it went. */
  function finish(lead) {
    const w = winner(b); state = 'done';
    if (w) {
      const [a, , z] = w.line, p = cellAt(a), q = cellAt(z);
      glowLine.position.set((p.x + q.x) / 2, .2, (p.z + q.z) / 2); glowLine.rotation.y = -Math.atan2(q.z - p.z, q.x - p.x); glowLine.scale.x = Math.hypot(q.x - p.x, q.z - p.z) / 2 + .1; glowLine.visible = true;
      stage.sparks(worldOf(w.line[1]), w.who === 1 ? '#9fe0ff' : '#ffa24a', 40);
    }
    if (w?.who === 1) { score.you++; creature.mood('surprised'); creature.gesture('shrug'); sounds.chime(); }
    else if (w?.who === 2) { score.me++; creature.mood('excited'); creature.gesture('tada'); sounds.gong(); }
    else { score.draw++; creature.mood('happy'); creature.gesture('shrug'); sounds.flip(); }
    const how = w?.who === 1 ? 'They won this round with three in a row! Be a good sport about it.' : w?.who === 2 ? 'You won this round with three in a row! Gloat kindly.' : 'It is a draw: the board is full.';
    stage.news(`[noughts] ${lead ? lead + ' ' : ''}${how} ${tally()} Offer another round (they press Again or say so).`, true);
  }

  /** Reverie's move: the search picks it (or, now and then at the lower levels, a slip). */
  async function reply(lead = '') {
    const my = clk.epoch; state = 'busy'; creature.state.thinking = true;
    const theirs = threats(b, 1), mine = threats(b, 2);
    const empty = b.map((x, j) => x ? -1 : j).filter(j => j >= 0);
    let i = Math.random() < SLIP[level - 1] ? empty[Math.floor(Math.random() * empty.length)] : brain.best({ b, t: 2 }, { time: 40 });
    if (i == null || i < 0 || b[i]) i = empty[0];
    if (!await clk.wait(.45) || !alive(my)) return;
    creature.state.thinking = false;
    await put(i, 2);
    if (!alive(my)) return;
    const did = `You put a nought ${NAMES[i]}.`;
    if (winner(b) || full(b)) return finish(`${lead} ${did}`.trim());
    state = 'you';
    // worth a word out loud: a block, a trap set, or a chance missed (theirs or its own)
    const blocked = theirs.includes(i), trap = threats(b, 2).length >= 2, missed = mine.length && !mine.includes(i), open = threats(b, 2).length === 1;
    const note = mine.includes(i) ? '' : blocked ? ' You blocked their line just in time!' : trap ? ' You have set a trap: two ways to win next move.' : missed ? ' (You missed a win there, oops.)' : open ? ' You have two in a row now: they must block it.' : '';
    stage.news(`[noughts] ${lead} ${did}${note} Board now: ${grid()}. Their move.`.replace(/\s+/g, ' '), !!note || !lead);
  }

  /** Their move on square i. */
  async function play(i) {
    if (state !== 'you' || i < 0 || i > 8 || b[i]) return false;
    const my = clk.epoch; state = 'busy';
    await put(i, 1);
    if (!alive(my)) return true;
    const lead = `They put a cross ${NAMES[i]}.`;
    if (winner(b) || full(b)) { finish(lead); return true; }
    reply(lead);
    return true;
  }

  function begin() {
    // (a new round mid-move: its hand comes back and its thinking stops, as the old move is dropped)
    if (state === 'busy') { creature.reach(null); creature.state.thinking = false; }
    clk.stop(); clearBoard(); round++;
    state = first === 1 ? 'you' : 'busy';
    if (first === 2) reply();
  }

  const api = {
    id: 'noughts', title: 'Noughts and crosses', camera: CAMERA,
    get state() { return state; },
    /** Sets the board up. level 1 (makes lots of slips) to 5 (can't be beaten). A new round swaps who goes first. */
    async start({ level: lv } = {}) {
      if (!root) build();
      if (lv) level = Math.max(1, Math.min(5, Math.round(lv)));
      const fresh = state === 'off';
      if (fresh) { score = { you: 0, me: 0, draw: 0 }; first = 1; round = 0; } else first = 3 - first;
      if (!root.parent) { scene.add(root); body = stage.physics?.box(null, .62, TABLE_H, .5, { fixed: true, at: { x: CENTRE.x, y: TABLE_H / 2, z: CENTRE.z } }); }
      begin();
      root.scale.setScalar(1);   // (a pop-in cut short by a quick new round ends full size)
      if (fresh) { root.scale.setScalar(.01); clk.tween(.45, k => root.scale.setScalar(popIn(k))); stage.sparks(new THREE.Vector3(CENTRE.x, TABLE_H + .1, CENTRE.z), '#ffd27a', 40); }
      return `The noughts and crosses board is set up on a table in front of you, at level ${level} of 5. They are crosses, you are noughts. ${first === 1 ? 'They go first: they tap a square or say it ("top left", "the middle").' : 'You go first this round: your hands are putting your nought down now.'}`;
    },
    stop() {
      clk.stop(); state = 'off'; creature.reach(null); creature.state.thinking = false;
      if (root?.parent) { root.removeFromParent(); body?.remove?.(); body = null; }
    },
    update(dt) {
      if (state === 'off') return;
      t += dt; clk.update(dt);
      mats.o.emissiveIntensity = creature.state.thinking ? 1.2 + Math.sin(t * 9) * .6 : .8 + Math.sin(t * 2.2) * .25;
      if (glowLine.visible) glowLine.material.emissiveIntensity = 2 + Math.sin(t * 6) * .8;
    },
    tap(ray) {
      if (state === 'off') return false;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_H), p = new THREE.Vector3();
      if (!ray.ray.intersectPlane(plane, p)) return false;
      const q = board.worldToLocal(p.clone()), c = Math.round(q.x) + 1, r = Math.round(q.z) + 1;
      if (c < 0 || c > 2 || r < 0 || r > 2 || Math.abs(q.x) > 1.65 || Math.abs(q.z) > 1.65) return ray.intersectObject(root, true).length > 0;
      if (state === 'done') { stage.again ? stage.again() : api.start(); return true; }
      play(r * 3 + c);
      return true;
    },
    /** Their move said out loud ("top left", "the middle", "7"). */
    async command(text) {
      if (state === 'off') return 'No game is on.';
      if (state === 'done') return 'This round is over. Say again (or call play) for another.';
      if (state !== 'you') return 'It is your move just now: wait for it.';
      const i = squareOf(text);
      if (i < 0) return `"${text}" is not a square. Free squares: ${free().join(', ')}.`;
      if (b[i]) return `The ${NAMES[i]} square is taken. Free squares: ${free().join(', ')}.`;
      play(i);
      return `Put their cross ${NAMES[i]}. Your reply is coming; you will hear about it.`;
    },
    again() { api.start(); },
    context() {
      if (state === 'off') return '';
      const now = state === 'done' ? 'The round is over.' : state === 'you' ? `Their move. Free squares: ${free().join(', ')}.` : 'You are making your move.';
      return `[noughts and crosses, on the table: they are X, you are O, at level ${level}. Round ${round}. Board: ${grid()}. ${now} ${tally()} The engine picks your moves; never invent them.]`;
    },
    bar() {
      if (state === 'off') return null;
      const s = state === 'done' ? (winner(b)?.who === 1 ? 'You win!' : winner(b) ? 'Reverie wins' : 'A draw') : state === 'you' ? 'Your move' : 'Reverie is thinking…';
      return { text: `Noughts and crosses · ${score.you}–${score.me} · ${s}`, buttons: [...(state === 'done' ? [{ id: 'again', label: 'Again' }] : []), { id: 'leave', label: 'Done' }] };
    },
  };
  return api;
}
