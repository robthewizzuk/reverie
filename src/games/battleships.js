// Battleships 3D tabletop game: two glossy ocean grids (yours on the left with visible 3D ships, Reverie's radar
// board on the right where you tap or call coordinates A1–F6 to fire). Red pegs mark hits, white pegs mark misses,
// and sunken enemy ships rise into view with sparks! Integrates with Reverie's Tiny Brains adaptive skill dial.
import gs from '../../engine/src/gamescroll.js';
import { table, clock, popIn } from './parts.js';
import { GRID_SIZE, COLS, parseCoord, coordName, makeBattleshipsGame } from './battleships-logic.js';

export { GRID_SIZE, COLS, parseCoord, makeBattleshipsGame };

const TABLE_H = .3;
const CENTRE = { x: 0, z: .64 };
const BOARD_SZ = .255, CELL = BOARD_SZ / GRID_SIZE;
const CAMERA = { pos: [0, 1.06, 1.54], look: [0, .34, .56] };

export function makeBattleships(stage) {
  const { THREE, scene, creature } = stage, { decal, sounds } = gs.tabletop, { rbox, pbr } = gs.hd;
  const tw = clock();
  let root = null, pegGroup = null, shipGroup = null, targetGridMesh = null, game = null, level = 2, round = 0;

  const pegGeo = new THREE.CylinderGeometry(.008, .01, .024, 10);
  const hitMat = pbr('#f0483e', { rough: .35, glow: .35, glowCol: '#ff5244' });
  const missMat = pbr('#e8eef5', { rough: .45 });
  const ownShipMat = pbr('#7a8796', { rough: .45, metal: .35 });
  const sunkShipMat = pbr('#b84438', { rough: .55, metal: .25 });
  const disposables = [];

  function drawGridTex(c, W, H, title, tint) {
    c.fillStyle = tint; c.fillRect(0, 0, W, H);
    const pad = W * .09, inner = W - pad * 1.4, step = inner / GRID_SIZE;
    c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = W * .005;
    for (let i = 0; i <= GRID_SIZE; i++) {
      const p = pad + i * step;
      c.beginPath(); c.moveTo(p, pad); c.lineTo(p, pad + inner); c.stroke();
      c.beginPath(); c.moveTo(pad, p); c.lineTo(pad + inner, p); c.stroke();
    }
    c.fillStyle = '#e8f5ff'; c.font = `700 ${W * .048}px system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let i = 0; i < GRID_SIZE; i++) {
      c.fillText(COLS[i], pad + (i + .5) * step, pad * .5);
      c.fillText(String(i + 1), pad * .45, pad + (i + .5) * step);
    }
    c.fillStyle = 'rgba(255,255,255,.72)'; c.font = `600 ${W * .042}px system-ui, sans-serif`;
    c.fillText(title, W / 2, H - pad * .32);
  }

  // converts (boardOffsetX, r, c) to local table coordinates
  function cellPos(boardX, r, c) {
    const pad = BOARD_SZ * .09, inner = BOARD_SZ - pad * 1.4, step = inner / GRID_SIZE;
    const x = boardX - BOARD_SZ / 2 + pad + (c + .5) * step;
    const z = -BOARD_SZ / 2 + pad + (r + .5) * step;
    return [x, TABLE_H + .012, z];
  }

  function addShipMesh(ship, boardX, mat) {
    const [x0, y, z0] = cellPos(boardX, ship.cells[0][0], ship.cells[0][1]);
    const [x1, , z1] = cellPos(boardX, ship.cells.at(-1)[0], ship.cells.at(-1)[1]);
    const len = Math.hypot(x1 - x0, z1 - z0) + CELL * .62;
    const g = rbox(ship.horiz ? len : CELL * .55, .016, ship.horiz ? CELL * .55 : len, .006);
    disposables.push(g);
    const m = new THREE.Mesh(g, mat);
    m.position.set((x0 + x1) / 2, y + .004, (z0 + z1) / 2);
    m.castShadow = true; m.receiveShadow = true;
    shipGroup.add(m);
  }

  function rebuildPieces() {
    if (!pegGroup || !shipGroup || !game) return;
    pegGroup.clear();
    shipGroup.clear();
    // own ships on left board (x = -.155)
    for (const s of game.player.ships) addShipMesh(s, -.155, s.sunk ? sunkShipMat : ownShipMat);
    // sunk enemy ships revealed on right board (x = +.155)
    for (const s of game.ai.ships) if (s.sunk) addShipMesh(s, .155, sunkShipMat);
    // pegs on both boards
    for (let r = 0; r < GRID_SIZE; r++) for (let c = 0; c < GRID_SIZE; c++) {
      if (game.aiShots[r][c]) {
        const [x, y, z] = cellPos(-.155, r, c);
        const p = new THREE.Mesh(pegGeo, game.aiShots[r][c] === 2 ? hitMat : missMat);
        p.position.set(x, y + .008, z); pegGroup.add(p);
      }
      if (game.playerShots[r][c]) {
        const [x, y, z] = cellPos(.155, r, c);
        const p = new THREE.Mesh(pegGeo, game.playerShots[r][c] === 2 ? hitMat : missMat);
        p.position.set(x, y + .008, z); pegGroup.add(p);
      }
    }
  }

  function build() {
    root = new THREE.Group();
    const desk = table(THREE, { w: .68, d: .38, h: TABLE_H }); desk.position.set(CENTRE.x, 0, CENTRE.z); root.add(desk);
    const leftBoard = decal(BOARD_SZ, BOARD_SZ, (c, W, H) => drawGridTex(c, W, H, 'YOUR FLEET', '#1d4e73'), { px: 512, lift: .004, rough: .35 });
    leftBoard.position.set(-.155, TABLE_H + .004, 0); desk.add(leftBoard);
    const rightBoard = decal(BOARD_SZ, BOARD_SZ, (c, W, H) => drawGridTex(c, W, H, 'REVERIE (TAP TO FIRE)', '#163c5c'), { px: 512, lift: .004, rough: .35 });
    rightBoard.position.set(.155, TABLE_H + .004, 0); desk.add(rightBoard);
    targetGridMesh = rightBoard;
    disposables.push(leftBoard.geometry, leftBoard.material, leftBoard.material?.map, rightBoard.geometry, rightBoard.material, rightBoard.material?.map);
    shipGroup = new THREE.Group(); desk.add(shipGroup);
    pegGroup = new THREE.Group(); desk.add(pegGroup);
  }

  function doFire(r, c) {
    if (!game) return 'No Battleships match is on.';
    const res = game.fire(r, c);
    if (!res.ok) return res.text;
    rebuildPieces();
    const [px, py, pz] = cellPos(.155, r, c);
    if (res.player.hit) {
      stage.sparks({ x: CENTRE.x + px, y: py + .04, z: CENTRE.z + pz }, res.player.sunk ? '#ff9d3b' : '#ff5244', res.player.sunk ? 20 : 12);
      sounds.hit?.() || sounds.place?.();
    } else {
      stage.sparks({ x: CENTRE.x + px, y: py + .03, z: CENTRE.z + pz }, '#cbeeff', 6);
      sounds.place?.();
    }
    if (res.over) {
      const won = res.result === 'win';
      stage.onGameResult?.(won);
      creature.gesture(won ? 'tada' : 'bounce');
      creature.mood(won ? 'excited' : 'happy');
      if (won) sounds.win?.();
    }
    stage.news(`[battleships] ${res.text}`, res.over || !!res.player.sunk || !!res.ai?.sunk);
    return res.text;
  }

  return {
    id: 'battleships', title: 'Battleships', camera: CAMERA,
    get round() { return round; },
    get level() { return level; },
    async start(o = {}) {
      this.stop();
      level = o.level ?? level; round++;
      const skill = stage.skill?.() ?? null;
      game = makeBattleshipsGame({ level, skill });
      build(); scene.add(root);
      rebuildPieces();
      popIn(tw, root, .32);
      sounds.place?.();
      creature.gesture('wave');
      return `Battleships set up! 6x6 ocean grid (A1 to F6), 4 ships each. Tap Reverie's right-hand board or call out a square like B4 to fire!`;
    },
    stop() {
      tw.stop();
      for (const d of disposables) d?.dispose?.();
      disposables.length = 0;
      if (root) { scene.remove(root); root = null; pegGroup = null; shipGroup = null; targetGridMesh = null; }
      game = null;
    },
    update(dt) { tw.update(dt); },
    tap(ray) {
      if (!targetGridMesh || !game || game.state !== 'play') return false;
      const hits = ray.intersectObject(targetGridMesh, false);
      if (!hits.length) return false;
      const uv = hits[0].uv; if (!uv) return false;
      // uv.x goes 0..1 left-to-right, uv.y goes 0..1 bottom-to-top; grid is inside pad..pad+inner
      const pad = .09, inner = 1 - pad * 1.4;
      const gx = (uv.x - pad) / inner, gy = ((1 - uv.y) - pad) / inner;
      const c = Math.floor(gx * GRID_SIZE), r = Math.floor(gy * GRID_SIZE);
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) return false;
      doFire(r, c);
      return true;
    },
    async command(text) {
      if (!game) return 'No Battleships match is on.';
      const pt = parseCoord(text);
      if (!pt) return 'Call out a square from A1 to F6 (like "B4" or "C3")!';
      return doFire(pt.r, pt.c);
    },
    context() { return game ? `[battleships: ${game.summary()}]` : ''; },
    bar() {
      if (!game) return null;
      const pLeft = game.player.ships.filter(s => !s.sunk).length;
      const aLeft = game.ai.ships.filter(s => !s.sunk).length;
      const buttons = game.state === 'play'
        ? [{ id: 'leave', label: 'Done' }]
        : [{ id: 'again', label: 'Play again' }, { id: 'leave', label: 'Done' }];
      return { text: `Battleships · You ${pLeft} vs Reverie ${aLeft}${game.state === 'over' ? (game.result === 'win' ? ' · You win!' : ' · Reverie wins') : ''}`, buttons };
    },
  };
}
