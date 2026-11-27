// Chess with Claude: a marble board on a little table in front of the creature, the engine's living stone pieces
// (gs.tabletop: chessman, eyes, ring, dot), the rules from chess.js and the engine's chess opponent thinking in a
// worker (gs.tabletop.Chess). You are white, at the camera's side; Claude is black, behind the board.
//
// Who picks Claude's moves: the engine does, at the level asked for, so every move is legal, quick (well under a
// second) and as strong as you want. Claude does the talking: each move it is told what happened in plain words
// (what moved, what was taken, check, who is ahead) and reacts out loud while its hands move the piece.
//
// A game here is an object the stage drives (see ./index.js for the shape every game has).
import gs from '../../engine/src/gamescroll.js';

const U = .06;                      // metres for one square
const TABLE_H = .3;                 // the board's top, in metres above the floor
const CENTRE = { x: 0, z: .66 };    // the board's middle on the floor (the creature stands at the origin)
const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const EYES = { p: [.68, .15, .07], r: [.76, .27, .09], n: [.86, .1, .12], b: [.93, .18, .07], q: [1.04, .2, .08], k: [1.0, .21, .08] };
const at = s => ({ x: s.charCodeAt(0) - 97 - 3.5, z: 3.5 - (+s[1] - 1) });   // 'e4' -> board units (white plays away from you)
const square = p => { const f = Math.round(p.x + 3.5), r = Math.round(3.5 - p.z); return f < 0 || f > 7 || r < 0 || r > 7 ? null : 'abcdefgh'[f] + (r + 1); };
const ease = k => k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

/** The camera while playing: from your side of the table, looking down at the board with the creature behind it. */
export const CAMERA = { pos: [0, 1.12, 1.62], look: [0, .27, .42] };

export function makeChess(stage) {
  const { THREE, scene, creature } = stage, { Chess, slab, chessman, eyes, ring, dot, wood, sounds } = gs.tabletop, { pbr, rbox } = gs.hd;
  let root, board, mats, dots, rings, selRing, checkRing, lastA, lastB, body;
  let game = null, men = new Map(), sel = null, moves = [], state = 'off', level = 2, tweens = [], epoch = 0, taken = { w: 0, b: 0 }, log = [], t = 0;

  function build() {
    root = new THREE.Group(); root.position.set(CENTRE.x, 0, CENTRE.z); root.name = 'game:chess';
    // a low wooden table, wide enough for the pieces each side has taken
    const top = wood('#7a5234', { repeat: [2, 1] }), legs = wood('#5d3d25');
    const tt = new THREE.Mesh(rbox(.82, .04, .62, .015), top); tt.position.y = TABLE_H - .03 - .02; root.add(tt);
    for (const [x, z] of [[-.36, -.26], [.36, -.26], [-.36, .26], [.36, .26]]) { const l = new THREE.Mesh(rbox(.04, TABLE_H - .05, .04, .01), legs); l.position.set(x, (TABLE_H - .05) / 2, z); root.add(l); }
    root.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    // the board, in board units (a square is 1), its top at TABLE_H
    board = new THREE.Group(); board.scale.setScalar(U); board.position.y = TABLE_H; root.add(board);
    board.add(slab({ w: 8, d: 8, thick: .5, rim: .5, wood: '#4a3526', rough: .35, paint(g, S) {
      const q = S / 8;
      for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
        const dark = (r + f) % 2 === 1;
        g.col.fillStyle = dark ? '#8a5a44' : '#ecdcc4'; g.col.fillRect(f * q, r * q, q, q);
        g.col.strokeStyle = dark ? '#b07a5e' : '#c9b79c'; g.col.lineWidth = S / 700; g.col.globalAlpha = .35;
        for (let i = 0; i < 3; i++) { g.col.beginPath(); const x = f * q + Math.random() * q, y = r * q + Math.random() * q; g.col.moveTo(x, y); g.col.bezierCurveTo(x + q * .3, y - q * .2, x + q * .1, y + q * .4, x + (Math.random() - .5) * q, y + (Math.random() - .5) * q); g.col.stroke(); }
        g.col.globalAlpha = 1;
      }
      g.h.strokeStyle = '#3a3a3a'; g.h.lineWidth = S / 300;
      for (let i = 0; i <= 8; i++) { g.h.beginPath(); g.h.moveTo(i * q, 0); g.h.lineTo(i * q, S); g.h.moveTo(0, i * q); g.h.lineTo(S, i * q); g.h.stroke(); }
    } }));
    // your pieces are ivory with sky-blue eyes; Claude's are plum stone with eyes the colour of its core
    mats = {
      w: pbr('#efe7d6', { rough: .3, clear: .6 }), b: pbr('#4a3a4c', { rough: .32, clear: .7 }),
      ew: pbr('#9fe0ff', { glow: 2, rough: .4 }), eb: pbr('#ffa24a', { glow: 2.2, rough: .4 }),
    };
    dots = Array.from({ length: 28 }, () => { const d = dot('#ffe08a', { r: .15 }); d.visible = false; board.add(d); return d; });
    rings = Array.from({ length: 8 }, () => { const r = ring('#ff6a52', { r: .42, w: .045, glow: 2 }); r.visible = false; board.add(r); return r; });
    selRing = ring('#ffe08a', { r: .44 }); checkRing = ring('#ff3524', { r: .47, w: .06, glow: 2.6 });
    lastA = ring('#ffb46a', { r: .46, w: .022, glow: 1 }); lastB = ring('#ffb46a', { r: .46, w: .022, glow: 1 });
    board.add(selRing, checkRing, lastA, lastB);
  }

  // ---- little animations, run from update(dt); a stop() drops them all
  function tween(dur, fn) {
    const my = epoch;
    return new Promise(res => tweens.push({ t: 0, dur, fn, done: () => res(my === epoch) }));
  }
  const wait = s => tween(s, () => {});
  // (the old round's animations end at once, each resolving false, so nothing awaiting one is left hanging: a spoken
  // move Claude is waiting on finishes, and the code after each await sees the game has moved on and stops)
  function drop() { const old = tweens; tweens = []; for (const tw of old) tw.done(); }
  const alive = my => my === epoch && state !== 'off';

  function man(type, color) {
    const m = chessman(type, mats[color]); m.rotation.y = color === 'w' ? Math.PI : 0;
    const [y, z, gap] = EYES[type]; m.add(eyes(mats[color === 'w' ? 'ew' : 'eb'], { y, z, gap }));
    m.userData.color = color; m.userData.type = type;
    return m;
  }
  function layout() {
    for (const m of men.values()) m.removeFromParent();
    for (const m of board.children.filter(c => c.userData.taken)) m.removeFromParent();
    men = new Map(); taken = { w: 0, b: 0 };
    for (const p of game.pieces()) { const m = man(p.type, p.color), q = at(p.square); m.position.set(q.x, 0, q.z); board.add(m); men.set(p.square, m); }
  }
  function choose(sq) {
    if (sel && men.get(sel)) men.get(sel).position.y = 0;
    sel = sq; moves = sq ? game.moves(sq) : [];
    let d = 0, r = 0;
    for (const x of dots) x.visible = false; for (const x of rings) x.visible = false;
    for (const m of moves) { const q = at(m.to), mark = m.captured ? rings[r++] : dots[d++]; if (!mark) continue; mark.position.set(q.x, mark.position.y, q.z); mark.visible = true; }
    selRing.visible = !!sq; if (sq) { const q = at(sq); selRing.position.set(q.x, .03, q.z); }
  }
  function marks(m) {
    const king = game.check ? game.pieces().find(p => p.type === 'k' && p.color === game.turn) : null;
    checkRing.visible = !!king; if (king) { const q = at(king.square); checkRing.position.set(q.x, .035, q.z); }
    lastA.visible = lastB.visible = !!m; if (m) { const a = at(m.from), b = at(m.to); lastA.position.set(a.x, .028, a.z); lastB.position.set(b.x, .028, b.z); }
  }
  const worldOf = (o, v = new THREE.Vector3()) => o.getWorldPosition(v);

  // A taken piece is lifted off and stood in a row beside the board: yours to your right, Claude's to its right.
  async function takeAway(mesh, byReverie) {
    const side = byReverie ? -1 : 1, n = taken[byReverie ? 'b' : 'w']++;
    const to = { x: side * (5.1 + (n % 2) * .8), z: side * (3.2 - Math.floor(n / 2) * .85) };
    const from = mesh.position.clone(); mesh.userData.taken = true;
    stage.sparks(worldOf(mesh), byReverie ? '#ffa24a' : '#9fe0ff');
    if (!await tween(.45, k => { const e = ease(k); mesh.position.set(from.x + (to.x - from.x) * e, Math.sin(k * Math.PI) * 2, from.z + (to.z - from.z) * e); mesh.scale.setScalar(1 - .25 * e); mesh.rotation.z = Math.sin(k * Math.PI) * .5; })) return;
    mesh.rotation.z = 0; sounds.clack(.5);
  }

  // Plays one move on the board. Yours glides where you sent it; Claude's is reached for, lifted with its glow, and
  // set down, its hand following the piece.
  async function act(m, byReverie) {
    const my = epoch, mesh = men.get(m.from), to = at(m.to), from = at(m.from);
    men.delete(m.from); mesh.position.y = 0;
    const victimSq = m.captured ? (m.enPassant ? m.to[0] + m.from[1] : m.to) : null, victim = victimSq && men.get(victimSq);
    if (victim) men.delete(victimSq);
    const far = Math.hypot(to.x - from.x, to.z - from.z), lift = m.piece === 'n' ? 1.6 : byReverie ? 1.1 : .5;
    if (byReverie) {
      creature.reach(worldOf(mesh)); creature.mood(victim ? 'excited' : 'curious');
      if (!await wait(.35) || !alive(my)) return;
      stage.sparks(worldOf(mesh), '#ffa24a', 14);
    }
    const dur = .3 + far * .07;
    await tween(dur, k => {
      const e = ease(k);
      mesh.position.set(from.x + (to.x - from.x) * e, Math.sin(k * Math.PI) * lift, from.z + (to.z - from.z) * e);
      if (byReverie) creature.reach(worldOf(mesh));
    });
    if (!alive(my)) return;
    sounds.clack(victim ? 1 : .7);
    if (victim) takeAway(victim, byReverie);
    if (m.castle) {
      const rank = m.from[1], [a, b] = m.castle === 'k' ? ['h', 'f'] : ['a', 'd'], rook = men.get(a + rank), rf = rook.position.clone(), rt = at(b + rank);
      men.delete(a + rank); men.set(b + rank, rook);
      if (!await tween(.3, k => { const e = ease(k); rook.position.set(rf.x + (rt.x - rf.x) * e, Math.sin(k * Math.PI) * .6, rf.z); }) || !alive(my)) return;
      sounds.clack(.7);
    }
    let piece = mesh;
    if (m.promotion) {
      mesh.removeFromParent(); piece = man(m.promotion, m.color); piece.position.set(to.x, 0, to.z); board.add(piece);
      stage.sparks(worldOf(piece), '#ffe08a', 30); sounds.chime();
      if (!await tween(.35, k => piece.scale.setScalar(1 + Math.sin(k * Math.PI) * .4)) || !alive(my)) return;
    }
    men.set(m.to, piece); marks(m);
    if (byReverie) creature.reach(null);
  }

  // ---- what Claude is told
  const ahead = () => {
    const b = game.balance;   // + is good for white (you), in pawns
    if (Math.abs(b) < .8) return 'The position is about even.';
    const n = Math.abs(b).toFixed(1).replace(/\.0$/, ''), p = n === '1' ? 'pawn' : 'pawns';
    return b > 0 ? `They are ahead by about ${n} ${p}.` : `You are ahead by about ${n} ${p}.`;
  };
  function said(m, who) {
    const whose = who === 'They' ? 'your' : 'their';
    let s = `${who} moved ${who === 'They' ? 'their' : 'your'} ${NAME[m.piece]} from ${m.from} to ${m.to} (${m.san})`;
    if (m.castle) s = `${who} castled ${m.castle === 'k' ? 'king' : 'queen'}side (${m.san})`;
    if (m.captured) s += `, taking ${whose} ${NAME[m.captured]}`;
    if (m.promotion) s += `, and it became a ${NAME[m.promotion]}`;
    return s;
  }
  function ending() {
    if (!game.over) return game.check ? (game.turn === 'w' ? ' Their king is in check.' : ' Your king is in check.') : '';
    if (game.mate) return game.turn === 'b' ? ' That is checkmate: they beat you! Be a good sport about it.' : ' That is checkmate: you won! Celebrate, kindly.';
    return game.stalemate ? ' Stalemate: the game is a draw.' : ' The game is a draw.';
  }

  /** Your move, then Claude's: the engine picks it while yours plays out, and Claude hears both. */
  async function turn(pick) {
    const m = game.move(pick); if (!m) return null;
    const my = epoch, mine = m;
    state = 'busy'; choose(null); log.push(m.san);
    const thinking = game.over ? null : game.think({ level });
    creature.state.thinking = true;
    await act(m, false);
    if (!alive(my)) return mine;
    if (game.over) { finish([said(mine, 'They') + '.']); return mine; }
    const [reply] = await Promise.all([thinking, wait(.4)]);
    creature.state.thinking = false;
    if (!alive(my)) return mine;
    const r = reply && game.move(reply);
    if (!r) { state = 'you'; return mine; }
    log.push(r.san);
    // something worth a reaction out loud: a capture, a check, castling, a promotion, the opening move, or a while
    const loud = !!(mine.captured || r.captured || mine.promotion || r.promotion || mine.castle || game.check || game.over || log.length <= 2 || log.length % 8 === 0);
    const news = `${said(mine, 'They')}. ${said(r, 'You')}; you are moving it now with your hands.${ending()} ${ahead()}`;
    stage.news(`[chess] ${news}`, loud);
    await act(r, true);
    if (!alive(my)) return mine;
    if (game.over) finish(null); else state = 'you';
    return mine;
  }
  function finish(extra) {
    state = 'done'; choose(null);
    const won = game.mate && game.turn === 'b', lost = game.mate && game.turn === 'w';
    if (extra) stage.news(`[chess] ${extra.join(' ')}${ending()}`, true);
    creature.mood(won ? 'sad' : lost ? 'excited' : 'surprised'); creature.gesture(won ? 'shrug' : lost ? 'tada' : 'shrug');
    sounds[game.mate ? 'gong' : 'chime']();
  }

  function parseMove(text) {
    const s = String(text || '').trim().replace(/\s+/g, '').replace(/[-x]/gi, m => m === 'x' || m === 'X' ? 'x' : '');
    const all = game.moves();
    const uci = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(s.replace(/x/g, ''));
    if (uci) return all.find(m => m.from === uci[1].toLowerCase() && m.to === uci[2].toLowerCase()) || null;
    const bare = x => x.replace(/[+#!?]/g, '').replace(/=/g, '').replace(/^0-0-0$/, 'O-O-O').replace(/^0-0$/, 'O-O');
    const want = bare(s);
    return all.find(m => bare(m.san) === want) || all.find(m => bare(m.san).toLowerCase() === want.toLowerCase()) || null;
  }

  return {
    id: 'chess', title: 'Chess', camera: CAMERA,
    get state() { return state; },
    get level() { return level; },
    /** Sets the board up and starts a new game (you are white). Resolves a sentence for Claude. */
    async start({ level: lv } = {}) {
      // the rules load the first time: until they're in, new Chess() throws with a promise to wait on
      for (let i = 0; ; i++) { try { game = new Chess(); break; } catch (e) { if (!e?.kitLoading || i > 20) throw e; await e.kitLoading; } }
      if (!root) build();
      // (a new game mid-move: its hand comes back and its thinking stops, as the old move is dropped)
      if (state === 'busy') { creature.reach(null); creature.state.thinking = false; }
      epoch++; drop(); log = []; sel = null;
      if (lv) level = Math.max(1, Math.min(5, Math.round(lv)));
      if (!root.parent) { scene.add(root); body = stage.physics?.box(null, .82, TABLE_H, .62, { fixed: true, at: { x: CENTRE.x, y: TABLE_H / 2, z: CENTRE.z } }); }
      layout(); choose(null); marks(null); state = 'you';
      for (const m of men.values()) m.scale.setScalar(.01);
      tween(.5, k => { for (const m of men.values()) m.scale.setScalar(Math.max(.01, 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2))); });
      stage.sparks(new THREE.Vector3(CENTRE.x, TABLE_H + .05, CENTRE.z), '#ffd27a', 40);
      return `The chess board is set up on a table in front of you. You play black at level ${level} of 5 (${Chess.LEVELS[level - 1].name}); they are white and move first, by tapping a piece and then a square, or by saying the move.`;
    },
    /** Takes the board away. */
    stop() {
      epoch++; drop(); state = 'off'; creature.reach(null); creature.state.thinking = false;
      if (root?.parent) { root.removeFromParent(); body?.remove?.(); body = null; }
    },
    update(dt) {
      if (state === 'off') return;
      t += dt;
      for (const tw of tweens) { tw.t += dt; tw.fn(Math.min(1, tw.t / tw.dur), tw.t); }
      const done = tweens.filter(tw => tw.t >= tw.dur); tweens = tweens.filter(tw => tw.t < tw.dur); for (const tw of done) tw.done();
      mats.ew.emissiveIntensity = 1.7 + Math.sin(t * 2.2) * .4;
      mats.eb.emissiveIntensity = creature.state.thinking ? 2.2 + Math.sin(t * 9) * 1.2 : 1.8 + Math.sin(t * 2.2 + 2) * .4;
      const m = sel && men.get(sel); if (m) m.position.y = .12 + Math.sin(t * 5) * .035;
    },
    /** A tap, as a ray from the camera. True when the board took it. */
    tap(ray) {
      if (state === 'off') return false;
      const hits = ray.intersectObjects([...men.values()], true), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_H), p = new THREE.Vector3();
      let sq = null;
      if (hits.length) { let o = hits[0].object; while (o && o.parent !== board) o = o.parent; sq = [...men].find(([, x]) => x === o)?.[0] || null; }
      const onBoard = ray.ray.intersectPlane(plane, p) && square(board.worldToLocal(p.clone()));
      if (!sq && !onBoard && !hits.length) return false;
      if (state !== 'you') return true;
      // the square under the finger first, then the piece it touched (a tall piece in front can hide the square behind)
      const tries = [onBoard, sq].filter(Boolean);
      const go = sel && tries.map(x => moves.find(m => m.to === x)).find(Boolean);
      if (go) { turn({ from: sel, to: go.to, promotion: 'q' }); return true; }
      const mine = tries.find(x => game.at(x)?.color === 'w' && x !== sel);   // (a tap on the chosen piece again lets go of it)
      if (mine) { choose(mine); sounds.tick(); } else choose(null);
      return true;
    },
    /** Plays the person's move said out loud ("e4", "Nf3", "e2e4"). Resolves a sentence for Claude. */
    async command(text) {
      if (state === 'off') return 'No game is being played.';
      if (state === 'done') return 'The game is over. Start a new one with play.';
      if (state !== 'you') return 'It is not their turn yet: wait for your own move to finish.';
      const m = parseMove(text);
      if (!m) return `"${text}" is not a legal move for them here. Their legal moves: ${game.moves().map(x => x.san).join(' ')}.`;
      turn({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
      return `Played ${m.san} for them. Your reply is being worked out; you will hear about it.`;
    },
    /** Takes back the last pair of moves (your move and Claude's reply). */
    undo() {
      if (state !== 'you' || log.length < 2) return false;
      game.undo(); game.undo(); log.splice(-2); epoch++; drop();
      choose(null); layout(); marks(null); sounds.flip();
      return true;
    },
    /** What Claude knows about the game, sent with each thing the person says while it is on. */
    context() {
      if (state === 'off') return '';
      const turnNow = state === 'done' ? 'The game is over.' + ending() : state === 'you' ? 'It is their move.' : 'Your move is being played.';
      const legal = state === 'you' ? ` Their legal moves: ${game.moves().map(x => x.san).join(' ')}.` : '';
      return `[chess, on the table: you are black at level ${level} (${Chess.LEVELS[level - 1].name}), they are white. Moves so far: ${log.join(' ') || 'none'}. ${turnNow} ${ahead()} Position (FEN): ${game.fen}.${legal}]`;
    },
    /** For the bar above the chat: a line of status and the buttons that make sense now. */
    bar() {
      if (!game) return null;
      const s = state === 'done' ? (game.mate ? (game.turn === 'b' ? 'Checkmate: you win!' : 'Checkmate: Reverie wins') : 'A draw') : state === 'busy' ? 'Reverie is moving…' : game.check ? 'Check! Your move' : sel ? 'Tap where it goes' : 'Your move: tap a piece';
      return { text: `Chess · level ${level} · ${s}`, buttons: [...(state === 'you' && log.length >= 2 ? [{ id: 'undo', label: 'Undo' }] : []), ...(state === 'done' ? [{ id: 'again', label: 'New game' }] : []), { id: 'leave', label: 'Done' }] };
    },
  };
}
