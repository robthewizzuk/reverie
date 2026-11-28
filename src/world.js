// The stage: a cosy workshop corner in the engine's Next Gen view, the creature in the middle of it, props made by
// the engine's 3D generator held in its hands, and a physics floor for props it throws. Built the way a Game Scroll
// game is (make, reset, update, draw), so the engine's kits load and run as they do in the app.
import gs from '../engine/src/gamescroll.js';
import { makeCreature } from './creature.js';
import { makeOutfits } from './outfits.js';
import { colours, tidyColours, keepColours } from './looks.js';
import { describe } from './describe.js';
import { GAMES, loadGameMaker, prefetchGames } from './games/index.js';
import { lightRoom, WINDOW, LAMP } from './light.js';
import { SHELL, shellR, backZ, wallNormal, buildShell, roundRect, circle } from './shell.js';
import { makeDaylight } from './daylight.js';
import { makeParty } from './party.js';
import { makeSleepy } from './sleepy.js';
import { makeDice } from './dice.js';
import { makePet } from './pet.js';
import { makeFloaties } from './floaties.js';
import { breakApart, makeShows } from './fun.js';
import { makeMotion, flexFor } from './motion.js';
import { DESK, SHELF, SILL, LEDGE, FIXTURES, onBoard, SPOTS, SPOT_NAMES, spotOf, roomColours, roomItems, tidyRoomColours, keepRoomColours, keepItem, forgetItem, forgetAll, freePlace, findItem, roomLine, inRoom, MAX_ITEMS } from './room.js';
import { plasterMaps, weaveMaps, brushedBrassMaps, ceramicBump } from './photoreal-mats.js';
import { makeFloorMirror } from './floor-mirror.js';

const HOLD_SIZE = .4;            // metres: the longest side of a prop in its hands
const SIZE_WORDS = [[/\b(giant|huge|enormous)\b/, 1.8], [/\b(bigger|big|large)\b/, 1.4], [/\b(smaller|small|little)\b/, .7], [/\b(tiny|teeny)\b/, .5]];
const article = w => w.replace(/^(a|an|the|some)\s+/i, '');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

let v, light, creature, outfits, fx, world, room, embers, motes, body, daylight, sleepy, floaties, party, floorMirror;
// the room's recolourable parts: the meshes made of each, and the recipe they are made from
const ROOM_LOOK = { walls: null, floor: ['wood', [8, 8]], rug: null, wood: ['wood', [1, 1]] };
const roomParts = { walls: [], floor: [], rug: [], wood: [] }, relight = [];
// soft woven wool/felt, with tactile yarn weave bump/roughness and plush sheen (for the rug and the pouf)
const felt = (colour, repeat = [10, 10]) => {
  const { THREE } = gs.hd;
  const c = new THREE.Color(colour);
  const w = weaveMaps(THREE, repeat);
  return Object.assign(gs.hd.pbr(colour, { rough: .95, sheen: .72, sheenColor: '#' + c.clone().lerp(new THREE.Color('#ffffff'), .55).getHexString(), sheenRoughness: .62 }), {
    bumpMap: w.bumpMap, bumpScale: .009, roughnessMap: w.roughnessMap,
  });
};
// walls get subtle limewash plaster micro-grain; rug gets woven wool; floor/wood get satin oiled oak
const roomMat = (part, colour) => {
  if (ROOM_LOOK[part]) {
    const m = gs.models.material(ROOM_LOOK[part][0], { colour, repeat: ROOM_LOOK[part][1] });
    if (part === 'floor' || part === 'wood') { m.clearcoat = .22; m.clearcoatRoughness = .42; }
    return m;
  }
  if (part === 'rug') return Object.assign(felt(colour, [14, 14]), { name: 'room:rug' });
  const pm = plasterMaps(gs.hd.THREE);
  return Object.assign(gs.hd.pbr(colour, { rough: .92 }), {
    name: 'room:' + part, bumpMap: pm.bumpMap, bumpScale: .006, roughnessMap: pm.roughnessMap,
  });
};

function setup() {
  const { HDView, pbr, rbox, THREE } = gs.hd, { material, prop } = gs.models;
  // parts that may still be loading go first: if one throws StillLoading, setup runs again from the top with nothing made
  const w3 = new gs.physics3d.World3D({ gravity: -9.81 });
  v = new HDView({ bg: '#2a1d16', fog: 0, fov: 36 });   // (its light, mood and finish: light.js)
  // Use GSSR (SGSR 2 temporal anti-aliasing and upscaling) on the room view
  v.upscaler = 'sgsr2';
  room = new THREE.Group(); v.scene.add(room);
  const shade = o => { o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
  // A calm modern room in Reverie's own style: soft rounded shapes, matte warm-white walls, pale oak, one soft rug and
  // a plant, lit by daylight from a big window. Floor, walls, rug and woodwork are in the colours you chose (room.js).
  const rc = roomColours(), part = (k, m) => { roomParts[k].push(m); return m; };
  const add = (m, shadow = true) => { if (shadow) shade(m); else m.receiveShadow = true; room.add(m); return m; };
  const floor = part('floor', new THREE.Mesh(new THREE.PlaneGeometry(10, 10), roomMat('floor', rc.floor)));
  floor.rotation.x = -Math.PI / 2; add(floor, false);
  // the rug: thick and soft, its edge rounded over (a lathe), not a flat disc
  const rugShape = [[0, 0], [1.02, 0], [1.05, .006], [1.06, .014], [1.05, .021], [1.02, .024], [0, .024]].map(([x, y]) => new THREE.Vector2(x, y));
  const rug = part('rug', new THREE.Mesh(new THREE.LatheGeometry(rugShape, 64), roomMat('rug', rc.rug))); add(rug, false);
  const wallMat = roomMat('walls', rc.walls), wood = roomMat('wood', rc.wood);
  // The room is a round capsule, like the inside of a ball: one smooth shell, the floor curving up into the walls,
  // the walls curving over into a dome above a soft seam round the middle, and no corners anywhere (shell.js). Its
  // two windows are cut cleanly into the curve: a long rounded one in the left wall (the daylight) and a round one in
  // the back wall, each with a deep reveal out to the glass, as in a thick moulded wall.
  const W0 = WINDOW, wz = (W0.z0 + W0.z1) / 2, wy = (W0.y0 + W0.y1) / 2;
  const PORT = { x: 0, y: 1.24, r: .28 };
  const portOut = Math.min(
    backZ(PORT.x - PORT.r, PORT.y),
    backZ(PORT.x + PORT.r, PORT.y),
    backZ(PORT.x, PORT.y - PORT.r),
    backZ(PORT.x, PORT.y + PORT.r),
  ) - .04;
  const cut = buildShell(THREE, [
    { wall: 'side', sdf: roundRect(wz, wy, (W0.z1 - W0.z0) / 2, (W0.y1 - W0.y0) / 2, W0.r), at: [wz, wy], out: W0.x },
    { wall: 'back', sdf: circle(PORT.x, PORT.y, PORT.r), at: [PORT.x, PORT.y], out: portOut },
  ]);
  add(part('walls', new THREE.Mesh(cut.shell, wallMat)));
  for (const g of cut.reveals) add(part('walls', new THREE.Mesh(g, wallMat)));
  // a slim rounded frame where each window meets the wall, and one at the side window's glass
  const rimTube = (pts, r, push = .006) => {
    const at = pts.map(p => { const n = wallNormal(...p); return new THREE.Vector3(p[0] + n[0] * push, p[1] + n[1] * push, p[2] + n[2] * push); });
    return add(part('wood', new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(at, true), at.length * 2, r, 10, true), wood)));
  };
  cut.outlines.forEach(rim => rimTube(rim, .02));
  const glassRim = (pts, toOut) => add(part('wood', new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...toOut(p))), true), pts.length * 2, .016, 8, true), wood)));
  glassRim(cut.outlines[0], p => [W0.x + .02, p[1], p[2]]);
  // (no bead at the seam where the dome meets the wall: a moulding a centimetre thick is thinner than a pixel from the
  // seat, so the upscaler drew it as a broken line of dashes across the wall; the curve itself shows where the dome starts)

  // (the day outside the side window: a soft bright sky the room's reflections and bounce light pick up; it throws
  // no shadow. daylight.js paints it with the real sky outside: day, dusk, night with stars, cloud, fog)
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.4), pbr('#eef0ec', { glow: 1.05, glowCol: '#f4f2ea', rough: 1 }));
  sky.position.set(W0.x - .8, 1.6, wz); sky.rotation.y = Math.PI / 2; room.add(sky);
  // the round window's glass at the end of its reveal (matte, so the sky painted in it by daylight.js reads: the stars
  // and moon at night, not the room mirrored over them), and a sill under it
  const glass = new THREE.Mesh(new THREE.CircleGeometry(PORT.r + .035, 40), pbr('#eef0ec', { rough: 1, glow: .9, glowCol: '#f2f0e8' }));
  glass.position.set(PORT.x, PORT.y, portOut + .002); room.add(glass);
  const GLASS = { x: PORT.x, y: PORT.y, z: portOut + .002, r: PORT.r };
  // boards that follow the curve of the back wall: the sill under the round window, the desk (where it makes things)
  // and a floating shelf, all pale oak, softly rounded
  const board = (B, thick) => {
    const sh = new THREE.Shape(), xs = [], N = 28, y = B.y - thick / 2;
    for (let i = 0; i <= N; i++) xs.push(B.x0 + (B.x1 - B.x0) * i / N);
    xs.forEach((x, i) => { const z = backZ(x, y) + .012; i ? sh.lineTo(x, -z) : sh.moveTo(x, -z); });
    for (let i = N; i >= 0; i--) sh.lineTo(xs[i], -(backZ(xs[i], y) + .012 + B.d));
    const g = new THREE.ExtrudeGeometry(sh, { depth: thick - .012, bevelEnabled: true, bevelThickness: .006, bevelSize: .008, bevelSegments: 3, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);
    // (the grain laid along the board on every face: the extruder's own UVs on a curved edge flip between two ways
    // round from one facet to the next, which striped the front of each board like a row of bricks)
    const P = g.attributes.position, nm = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < P.count; i++) uv.setXY(i, P.getX(i), Math.abs(nm.getY(i)) > .5 ? P.getZ(i) : P.getY(i) + P.getZ(i) * .3);
    uv.needsUpdate = true;
    const m = part('wood', new THREE.Mesh(g, wood)); m.position.y = B.y - thick + .006; return add(m);
  };
  board(SILL, .04); board(DESK, .045); board(SHELF, .04);
  // a ledge along the bottom of the big window, out over the curve, to sit things on
  { const m = part('wood', new THREE.Mesh(rbox(LEDGE.x1 - LEDGE.x0, .035, LEDGE.z1 - LEDGE.z0, .012), wood)); m.position.set((LEDGE.x0 + LEDGE.x1) / 2, LEDGE.y - .0175, (LEDGE.z0 + LEDGE.z1) / 2); add(m); }
  const cb = ceramicBump(THREE), bb = brushedBrassMaps(THREE);
  const brassMat = Object.assign(pbr('#d4af6a', { metal: .9, rough: .24 }), { bumpMap: bb.bumpMap, bumpScale: .002, roughnessMap: bb.roughnessMap });
  const globeMat = pbr('#fff6e8', { rough: .35, glow: 1.4, glowCol: '#ffe2b8' });

  // Actual 3D brass picture-bar wall sconce lights mounted cleanly above both shelves
  const addShelfSconce = (sx, sy, barW) => {
    const g = new THREE.Group();
    const sz = backZ(sx, sy) + .018;
    const n = wallNormal(sx, sy, sz);
    g.position.set(sx, sy, sz);
    g.lookAt(sx + n[0], sy + n[1] * .2, sz + n[2]);
    // Backplate mounted flush on the wall
    const plate = new THREE.Mesh(rbox(.09, .036, .014, .004), brassMat);
    g.add(plate);
    // Two slim brass arms reaching out over the shelf
    for (const dx of [-.028, .028]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(.0045, .0045, .13, 8), brassMat);
      arm.rotation.x = Math.PI / 2; arm.position.set(dx, 0, .065);
      g.add(arm);
    }
    // Sleek brass shade hood angled down toward the shelf
    const hood = new THREE.Mesh(rbox(barW, .02, .034, .006), brassMat);
    hood.position.set(0, .004, .132); hood.rotation.x = .25;
    g.add(hood);
    // Warm glowing frosted LED diffuser bar underneath the hood
    const bulb = new THREE.Mesh(rbox(barW - .02, .009, .016, .003), globeMat);
    bulb.position.set(0, -.006, .134); bulb.rotation.x = .25;
    g.add(bulb);
    room.add(g);
  };
  addShelfSconce(-.94, 1.19, .36);   // above the left floating shelf
  addShelfSconce(1.09, 1.56, .46);   // above the right trophy shelf

  // little desk accent lamp on the far right end of the workbench
  const pale = pbr('#ece6dd', { rough: .55 });
  const [dlx, dly, dlz] = onBoard(DESK, 1.50);
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(.05, .058, .016, 24), pale); lampBase.position.set(dlx, dly + .008, dlz); add(lampBase, false);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(.005, .005, .19, 10), pale); stem.position.set(dlx, dly + .105, dlz); add(stem, false);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(.058, 24, 16), globeMat); globe.position.set(dlx, dly + .22, dlz); room.add(globe);

  const vaseShape = [[0, 0], [.045, 0], [.055, .03], [.05, .09], [.03, .13], [.026, .16], [.032, .17], [0, .17]].map(([x, y]) => new THREE.Vector2(x, y));
  const vaseMat = Object.assign(pbr('#d9b8a4', { rough: .34, clear: .65 }), { bumpMap: cb, bumpScale: .003 });
  const vase = new THREE.Mesh(new THREE.LatheGeometry(vaseShape, 28), vaseMat); vase.position.set(...onBoard(SHELF, -1.18)); add(vase);
  // workshop dressing: cloth-bound books + framed sketch on the floating shelf, ceramic coffee mug on the workbench
  {
    const bookCols = ['#7b3f36', '#3d5a52', '#c89b52'];
    const [bx0, by0, bz0] = onBoard(SHELF, -.70);
    let yAcc = by0;
    bookCols.forEach((col, i) => {
      const bw = .15 - i * .012, bh = .026, bd = .11 - i * .008;
      const bm = new THREE.Mesh(rbox(bw, bh, bd, .003), pbr(col, { rough: .82, sheen: .35 }));
      bm.position.set(bx0 + (i - 1) * .006, yAcc + bh / 2, bz0);
      bm.rotation.y = (i - 1) * .08;
      add(bm);
      yAcc += bh;
    });
    // leaning framed botanical print on the shelf
    const [fx, fy, fz] = onBoard(SHELF, -.94);
    const frameG = new THREE.Group();
    frameG.position.set(fx, fy + .10, fz - .02);
    frameG.rotation.set(-.12, .12, 0);
    const outerF = new THREE.Mesh(rbox(.14, .19, .016, .004), wood);
    const matBoard = new THREE.Mesh(new THREE.PlaneGeometry(.11, .16), pbr('#f5f0e6', { rough: .9 }));
    matBoard.position.z = .0085;
    const leafArt = new THREE.Mesh(new THREE.CircleGeometry(.034, 20), pbr('#6e8c68', { rough: .88 }));
    leafArt.scale.set(.7, 1.35, 1); leafArt.position.set(0, .005, .0092);
    frameG.add(outerF, matBoard, leafArt);
    room.add(frameG);
    // warm ceramic coffee mug on the workbench
    const [mx0, my0, mz0] = onBoard(DESK, .62);
    const mugMat = Object.assign(pbr('#e9dfd1', { rough: .28, clear: .7 }), { bumpMap: cb, bumpScale: .002 });
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(.036, .032, .08, 22), mugMat);
    mug.position.set(mx0, my0 + .04, mz0 + .06);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(.032, 18), pbr('#2c1810', { rough: .08, clear: .9 }));
    coffee.rotation.x = -Math.PI / 2; coffee.position.set(mx0, my0 + .076, mz0 + .06);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(.022, .0055, 8, 16, Math.PI), mugMat);
    handle.position.set(mx0 + .034, my0 + .042, mz0 + .06); handle.rotation.z = -Math.PI / 2;
    add(mug); room.add(coffee); add(handle, false);
  }
  // freestanding arched brass cheval floor mirror angled toward Reverie and the room, with real-time planar reflection
  floorMirror = makeFloorMirror({ brassMat, woodMat: wood, x: -1.05, z: -.42, ry: .80 });
  room.add(floorMirror.group);
  // a round pouf in the back left corner, soft woven linen like Reverie
  const pouf = new THREE.Mesh(new THREE.SphereGeometry(.26, 32, 18), felt('#b4bfa8', [8, 8]));
  pouf.scale.set(1, .62, 1); pouf.position.set(-1.48, .16, -.82); add(pouf);
  // a plant on the right, in a tall matte ceramic pot
  const potShape = [[0, 0], [.13, 0], [.16, .04], [.17, .38], [.165, .4], [0, .4]].map(([x, y]) => new THREE.Vector2(x, y));
  const potMat = Object.assign(pbr('#efeae3', { rough: .72, clear: .18 }), { bumpMap: cb, bumpScale: .003 });
  const pot = new THREE.Mesh(new THREE.LatheGeometry(potShape, 32), potMat); pot.position.set(1.85, 0, -.6); add(pot);
  const plant = gs.models.tree('fan', { seed: 7 }); fitTo(plant, 1.05); standAt(plant, 1.85, .37, -.6); shade(plant); room.add(plant);
  // a little dust drifting in the daylight
  motes = new gs.fx3d.Particles3D(v.scene);
  // (where the sun's beams cross the room, between the window and the creature)
  const dust = motes.make({ x: -.9, y: 1.1, z: .2 }, { loop: true, rate: 3, life: [6, 10], speed: [.01, .04], size: [.004, .008], colors: ['#ffe6c0', '#ffd09a'], radius: 1.2, gravity: -.004, glow: false, shrink: false });
  creature = makeCreature(); v.scene.add(creature.root);
  creature.setColours(colours());   // (the colours it was asked for last time, kept on this device)
  outfits = makeOutfits({ rig: creature.rig });   // (what it wore last time, and the season's hat)
  // the light: the sun through the window, the bench lamp, its core, ray-traced bounce light and reflections
  // (made once the creature is in the room, so the reflections reach its eyes, glass dome and mirror)
  light = lightRoom(v, creature, { min: [SHELL.cx - SHELL.a, 0, SHELL.cz - SHELL.b], max: [SHELL.cx + SHELL.a, SHELL.top, SHELL.cz + SHELL.b] });
  v.reflect?.(floorMirror.glass);
  relight.push(light.bounce, light.room);   // (both baked again when the room is repainted)
  // the real day outside: the sun, the sky in the windows, the lamp, rain on the glass (daylight.js)
  daylight = makeDaylight({ v, light, outside: { side: sky.material, round: glass.material }, glass: GLASS, side: W0, globe: globeMat, motes: dust });
  party = makeParty(v);   // (karaoke's mirror ball and coloured lights, put away until a song starts)
  sleepy = makeSleepy({ scene: v.scene, creature });   // (Z's over its head when it dozes off late at night)
  fx = new gs.fx3d.Particles3D(v.scene);
  floaties = makeFloaties(v.scene);   // (hearts, and a sleepy pet's "z")
  // embers drifting up from its core: a few when idle, more while listening, a stream while thinking
  embers = makeEmbers();
  world = w3;
  world.floor(0, { friction: .8 });
  // (the walls, as four flat sides just behind the curve: things thrown roll up the cove and back)
  world.box(null, 6, 3, .2, { fixed: true, at: { x: 0, y: 1.5, z: SHELL.cz - SHELL.b - .1 } });
  world.box(null, 6, 3, .2, { fixed: true, at: { x: 0, y: 1.5, z: SHELL.cz + SHELL.b + .1 } });
  world.box(null, .2, 3, 6, { fixed: true, at: { x: SHELL.cx - SHELL.a - .1, y: 1.5, z: .6 } });
  world.box(null, .2, 3, 6, { fixed: true, at: { x: SHELL.cx + SHELL.a + .1, y: 1.5, z: .6 } });
  body = world.box(null, .48, .66, .42, { moving: true, at: { x: 0, y: .33, z: 0 } });   // (the creature: props bounce off it, not through, and it goes where it walks)
  // (the desk and the shelf, near enough as boxes: things thrown land on them)
  for (const B of [DESK, SHELF]) { const [x, , z] = onBoard(B, (B.x0 + B.x1) / 2); world.box(null, B.x1 - B.x0, .04, B.d, { fixed: true, at: { x, y: B.y - .02, z } }); }
  // the camera: just above eye level with it, close enough to see its face
  v.cam.position.set(0, .78, 1.95); v.cam.lookAt(0, .4, 0);
  gs.models.generate.load().catch(() => {});   // (the generator's workers warmed up while it wakes)
}

const makeEmbers = () => fx.make({ x: 0, y: .26, z: .3 }, { loop: true, rate: 2, life: [.9, 1.8], speed: [.03, .1], size: [.008, .018], colors: ['#ffd8a0', '#ff6a20'].map(creature.glowed), radius: .03, gravity: .18 });
const tmp = {};
function boxOf(o) { const { THREE } = gs.hd; o.updateMatrixWorld(true); return (tmp.b ||= new THREE.Box3()).setFromObject(o); }
function fitTo(o, size) { const { THREE } = gs.hd; o.scale.setScalar(1); const s = boxOf(o).getSize(tmp.v ||= new THREE.Vector3()); o.scale.setScalar(size / Math.max(.01, s.x, s.y, s.z)); return o; }
function standAt(o, x, y, z) { const { THREE } = gs.hd; o.position.set(x, y, z); const b = boxOf(o), c = b.getCenter(tmp.c ||= new THREE.Vector3()); o.position.x += x - c.x; o.position.y += y - b.min.y; o.position.z += z - c.z; }

/**
 * The stage, as a game-shaped object: reset(), update(dt), draw(c), resize(w, h), tap(x, y), plus what Claude's tools
 * do (make, change, toss, clear, act). Each tool returns a promise of a sentence saying what really happened.
 */
export function makeWorld() {
  const { THREE } = gs.hd;
  let W = 360, H = 640, lastAspect = 0, held = null, loose = [], seed = 1, t = 0, motion = null;
  const emberAt = { x: 0, y: 0, z: 0 };
  const every = [];   // (held, loose and placed, gathered each frame for their own small movements)
  // things kept in the room (room.js has what is saved), what it is doing with its legs now, and carrying jobs in a queue
  let placed = [], acts = [], carrying = Promise.resolve(), restored = false;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), at = new THREE.Vector3();
  // a game on the stage (./games): the one being played, the ones made so far, and where the camera is heading
  let game = null, onNews = () => {}, onSay = () => false, onGameResult = () => {}, getSkill = () => null, pad = null, dice = null;
  // its pet (pet.js), made once the room is; its mood (mood.js, set by the page); more lines for Claude's scene line
  let keeper = null, mood = null;
  // looking around (look.js, set by the page): drags and pinches swing the camera off its seat
  let look = null;
  // broken bits on the floor (gs.destruction's Rubble: they fade away after a while) and little shows (fun.js)
  let rubble = null, shows = null;
  const lines = [() => outfits?.line() || ''];
  // a camera seat set from outside (watching a video together: watch.js), used when no game has one
  let seat = null;
  const games = {}, HOME = { pos: [0, .78, 1.95], look: [0, .4, 0] }, WIDE = { pos: [0, .86, 2.05], look: [0, .6, 0] }, camAt = { pos: [...HOME.pos], look: [...HOME.look] };
  const stage = {
    THREE, get scene() { return v.scene; }, get creature() { return creature; }, get physics() { return world; },
    sparks(p, color = '#ffd27a', count = 24) { fx.sparks({ x: p.x, y: p.y, z: p.z }, { color, count, power: .7, light: false }); },
    news: (text, loud) => onNews(text, loud),
    /** Says a line straight away in its own voice (not from Claude); false when it is busy talking. */
    say: line => onSay(line),
    /** Makes a prop in its hands from words (as the make tool does). Resolves what was made. */
    make: words => makeProp(words),
    /** The drawing pad (../doodle.js), for games drawn on it. */
    get pad() { return pad; },
    /** Throws real six-sided dice from its hands. Resolves the faces that came up. */
    throwDice: n => dice.throw(n),
    /** Takes the dice away. */
    clearDice: () => dice?.clear(),
    /** A game putting itself away (its own Stop button): Claude hears it with the next thing said. */
    stopGame() { if (game) { const t = game.title; endGame(); onNews(`[game] They stopped ${t}: it is put away.`, false); } },
    /** A fresh round of the game on (a tap on a finished board): Claude hears it at once. */
    again: () => api.again(),
    /** Adaptive Tiny Brains skill dial (0..1 or null) and result reporter. */
    skill: () => getSkill(),
    onGameResult: won => onGameResult(won),
  };
  // the game on is put away: its things off the table (each game's stop), and Reverie's hands and mood back to normal
  let playSeq = 0;
  function endGame() {
    playSeq++;
    light?.setDof?.(true);
    if (!game) return;
    const g = game; game = null;
    try { g.stop(); } catch (e) { console.warn('[reverie] a game would not stop:', e); }
    creature.reach(null); creature.mood('calm');
  }
  // a game's table goes up in front of it: props lying where it stands are cleared away first (a fixed table body
  // appearing round one would fling it across the room), and what it holds is put down to one side
  function clearTheTable() {
    for (const e of loose) {
      const p = e.pivot.position;
      if (Math.abs(p.x) < .55 && p.z > .2 && p.z < 1.05) { poof(e.pivot, '#ffffff'); remove(e); e.gone = true; }
    }
    loose = loose.filter(e => !e.gone);
    if (held) release(held, 'aside');
  }

  // a prop sits in a pivot whose middle is the prop's middle, so it can be held, spun and given a box body
  function pivotFor(thing, size) {
    const p = new THREE.Group();
    fitTo(thing, size); const b = boxOf(thing), c = b.getCenter(new THREE.Vector3());
    thing.position.sub(c);
    thing.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    p.userData.size = b.getSize(new THREE.Vector3());
    flexFor(p, thing, p.userData.size);   // (in a group at its base, so it squashes and rocks on what it stands on: motion.js)
    return p;
  }
  function hold(entry) {
    held = entry; creature.hold.add(entry.pivot); entry.pivot.position.set(0, entry.pivot.userData.size.y * .3, 0); entry.pivot.rotation.set(0, 0, 0);
    creature.holding = true; motion.life(entry);
  }
  function poof(o, color = '#ffd27a') {
    o.getWorldPosition(at);
    fx.sparks({ x: at.x, y: at.y, z: at.z }, { color, count: 36, power: 1.4, light: true });
  }
  function release(entry, throwIt) {
    const p = entry.pivot, s = p.userData.size;
    p.getWorldPosition(at); const q = p.getWorldQuaternion(new THREE.Quaternion());
    v.scene.add(p); p.position.copy(at); p.quaternion.copy(q);
    // ('aside': set down on the rug at its left or right with a puff, clear of a game's table in front of it)
    const aside = throwIt === 'aside', dir = Math.random() < .5 ? -1 : 1;
    if (aside) { poof(p, '#ffffff'); p.position.set(dir * .62, s.y / 2 + .04, .05); p.quaternion.identity(); poof(p, '#ffffff'); }
    // thrown off to one side and a little back, so it lands on the rug in view (not at the camera)
    const side = aside ? dir * .05 : throwIt ? dir * (.45 + Math.random() * .15) : (Math.random() - .5) * .6;
    const up = aside ? 0 : throwIt ? 2.6 : .8, back = aside ? 0 : throwIt ? -.1 - Math.random() * .2 : .4;
    entry.body = world.box(p, Math.max(.04, s.x), Math.max(.04, s.y), Math.max(.04, s.z), { density: entry.density, friction: .7, bounce: .25, vel: { x: side, y: up, z: back } });
    if (!aside) entry.body.twist((Math.random() - .5) * 6, (Math.random() - .5) * 6, (Math.random() - .5) * 4);
    loose.push(entry); creature.holding = false; held = null;
  }
  function remove(entry) { motion?.stop(entry); if (entry.body) entry.body.remove(); entry.body = null; entry.pivot.removeFromParent(); }
  // it shrinks away (motion.js), then goes in a puff of sparkles; its body goes at once, so nothing lands on what is leaving
  function vanish(entry, color = '#ffffff', delay = 0) {
    entry.body?.remove?.(); entry.body = null;
    if (!entry.pivot.parent) return;
    if (entry.pivot.parent !== v.scene) toWorld(entry.pivot);
    motion.vanish(entry, () => { poof(entry.pivot, color); gs.sound.sounds.pop(); remove(entry); }, delay);
  }

  // its real weight per cubic metre of its box, so an anvil thuds and a balloon floats down
  function densityOf(thing) {
    try {
      const f = gs.models.fits(thing), mass = f.body?.mass ?? f.drive?.mass ?? null;
      const s = boxOf(thing).getSize(new THREE.Vector3()), vol = Math.max(1e-4, s.x * s.y * s.z);
      return mass ? clamp(mass / vol, 25, 9000) : 300;
    } catch { return 300; }
  }

  async function makeProp(words, o = {}) {
    words = String(words || '').trim().slice(0, 80);
    if (!words) return 'Nothing was made: no words.';
    const s = o.seed ?? ++seed;
    creature.gesture('tada');
    let thing;
    try { thing = await gs.models.generate.make(words, { seed: s }); }
    catch (e) { gs.sound.sounds.deny(); return `It could not make "${words}" (${String(e?.message || e).slice(0, 80)}).`; }
    if (!thing) return `Nothing came out for "${words}".`;
    const density = densityOf(thing);
    let k = o.sizeK ?? 1;
    for (const [re, f] of SIZE_WORDS) if (re.test(words.toLowerCase())) { k = f; break; }
    if (held) release(held, false);
    // what it really is, in words: Claude can't see it, so it hears the recipe the generator used
    let read = null; try { read = gs.models.generate.understood(words); } catch { /* still loading: none */ }
    const d = describe(thing, words, { size: HOLD_SIZE * k, read, asked: o.asked ?? words });
    const entry = { words, seed: s, sizeK: k, density, short: d.short, desc: d.text, pivot: pivotFor(thing, HOLD_SIZE * k), body: null };
    hold(entry); motion.appear(entry); poof(entry.pivot); gs.sound.sounds.pop();
    return o.said ?? `Made ${d.text}`;
  }

  // ---- the room: things carried to a spot and kept there
  const SIZES = { small: .25, medium: .45, large: .8, huge: 1.2 };
  const roomUndo = [];
  const pushUndo = u => { roomUndo.push(u); if (roomUndo.length > 12) roomUndo.shift(); };
  let ids = 0;
  const newId = () => `i${Date.now().toString(36)}${(ids++).toString(36)}`;
  const footprint = p => Math.max(p.userData.size.x, p.userData.size.z) * p.scale.x / 2;
  // a thing kept in the room stands still, with a fixed box so thrown props land on it and bounce off
  function settle(e) {
    const s = e.pivot.userData.size, k = e.pivot.scale.x;
    e.body?.remove?.();
    e.body = world.box(null, Math.max(.04, s.x * k), Math.max(.04, s.y * k), Math.max(.04, s.z * k), { moving: true, at: { x: e.x, y: e.pivot.position.y, z: e.z } });
    e.body.place(e.x, e.pivot.position.y, e.z, e.pivot.quaternion);
  }
  async function restoreRoom() {
    let n = 0;
    for (const raw of roomItems()) {
      let i = raw;
      let thing = null;
      try { thing = await gs.models.generate.make(i.words, { seed: i.seed }); } catch { /* the generator could not: leave it out this time */ }
      if (!thing) continue;
      let desc = i.desc, short = i.short, dirty = false;
      if (!desc) {
        try {
          const d = describe(thing, i.words, { size: i.size });
          desc = d.text; short ||= d.short;
          dirty = true;
        } catch { /* fine */ }
      }
      // If the room layout moved (e.g. lowered desk/shelf/sill or relocated window), re-seat saved items onto their surface
      const S = SPOTS[i.spot];
      if (S) {
        const r = i.r || .12;
        const offY = Math.abs(i.y - S.at[1]) > .025;
        const offBoard = S.board && (i.x < S.board.x0 + .02 || i.x > S.board.x1 - .02 || Math.abs(i.z - onBoard(S.board, i.x)[2]) > .14);
        const hitsFixture = S.board && FIXTURES.some(f => Math.abs(f.y - S.at[1]) < .2 && Math.hypot(f.x - i.x, f.z - i.z) < (f.r || .15) + r);
        if (offY || offBoard || hitsFixture) {
          const p = freePlace(i.spot, r, placed);
          i = { ...i, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) };
          dirty = true;
        }
      }
      if (dirty) keepItem({ ...i, short, desc });
      const pivot = pivotFor(thing, i.size), e = { ...i, short, desc, pivot, body: null };
      pivot.position.set(i.x, i.y + pivot.userData.size.y / 2, i.z); pivot.rotation.set(0, i.ry || 0, 0);
      v.scene.add(pivot); settle(e); placed.push(e);
      motion.life(e, { still: true }); motion.appear(e, Math.min(n++, 8) * .09);   // (each pops in where it was left, one after another)
      seed = Math.max(seed, i.seed || 0);
    }
  }
  // its legs: walk to (x, z), turn, wait, each a step run by update() one at a time
  const SPEED = .85;
  const walkTo = (x, z) => new Promise(done => acts.push(dt => {
    const r = creature.root, dx = x - r.position.x, dz = z - r.position.z, d = Math.hypot(dx, dz);
    if (d < .02) { r.position.x = x; r.position.z = z; creature.walk(0, null); done(); return true; }
    const step = Math.min(d, SPEED * dt);
    r.position.x += dx / d * step; r.position.z += dz / d * step;
    creature.walk(Math.min(1, d / .15), Math.atan2(dx, dz)); return false;
  }));
  const pause = (s, face) => new Promise(done => { let k = 0; acts.push(dt => { creature.walk(0, face); if ((k += dt) < s) return false; done(); return true; }); });
  // a thing moved along an arc from where it is to a point (world space) over s seconds, growing to scale k
  const glide = (o, to, s, k = o.scale.x, also = () => {}) => new Promise(done => {
    const from = o.position.clone(), k0 = o.scale.x; let u = 0;
    acts.push(dt => {
      u = Math.min(1, u + dt / s); const e = u * u * (3 - 2 * u);
      o.position.lerpVectors(from, to, e); o.position.y += Math.sin(e * Math.PI) * .12; o.scale.setScalar(k0 + (k - k0) * e); also(e);
      if (u < 1) return false; done(); return true;
    });
  });
  // where it stands to reach a point: on its way from the middle, just short of it, inside the room
  function standFor(x, z, r) {
    const d = Math.hypot(x, z), back = .32 + r;
    if (d < back + .15) return [0, 0];
    let sx = x - x / d * back, sz = z - z / d * back;
    sx = clamp(sx, -1.7, 1.9); sz = clamp(sz, -.95, 1.1);
    if (sx > DESK.x0 - .1 && sz < -.85) sz = -.85;   // (not under the desk)
    return [sx, sz];
  }
  function toWorld(o) { o.getWorldPosition(at); const q = o.getWorldQuaternion(new THREE.Quaternion()); v.scene.add(o); o.position.copy(at); o.quaternion.copy(q); }
  async function goHome() { await walkTo(0, 0); creature.walk(0, null); }

  async function placeIt(input = {}) {
    if (game) return { text: 'Not done: a game is on the table. Put the game away first.', error: true };
    const want = String(input.spot || '').toLowerCase().trim(), words = String(input.item || '').trim();
    const toHands = /\b(hands?|me|you|here)\b/.test(want) && !spotOf(want), away = /^(away|gone|nowhere|out)\b/.test(want);
    const spot = toHands || away ? null : spotOf(want);
    if (!toHands && !away && !spot) return { text: `Not done: "${input.spot}" is not a place in the room. Places: ${SPOT_NAMES.join(', ')}.`, error: true };
    // which thing: one kept in the room it names, else the one in its hands, else a new one made from the words
    let entry = null, from = null;
    const isHeld = !words || /^(it|that|this|the held|held|what you.?re holding)$/i.test(words) || (held && findItem(words, [held]));
    if (!isHeld) { entry = findItem(words, placed); if (entry) from = 'room'; }
    if (!entry && held && (isHeld || !words)) { entry = held; from = 'hands'; }
    if (!entry && words && !isHeld) {
      if (placed.length >= MAX_ITEMS && !toHands) return { text: `Not done: the room is full (${MAX_ITEMS} things). Take something away first.`, error: true };
      const r = await makeProp(words);
      if (!held) return { text: r, error: true };
      entry = held; from = 'hands';
    }
    if (!entry) return { text: 'Not done: nothing is in your hands and nothing in the room matches that. Make it first, or name it.', error: true };
    const name = entry.short || entry.words;

    // a thing in the room: walk over, pick it up
    if (from === 'room') {
      if (away) { pushUndo({ kind: 'removed', item: { id: entry.id, words: entry.words, seed: entry.seed, sizeK: entry.sizeK, density: entry.density, size: entry.size, spot: entry.spot, x: entry.x, y: entry.y, z: entry.z, ry: entry.ry, r: entry.r, short: entry.short, desc: entry.desc } }); vanish(entry); placed = placed.filter(e => e !== entry); forgetItem(entry.id); return `Took ${name} out of the room.`; }
      if (held) release(held, false);
      const [sx, sz] = standFor(entry.x, entry.z, entry.r || .15);
      await walkTo(sx, sz); await pause(.15, Math.atan2(entry.x - sx, entry.z - sz));
      creature.reach(entry.pivot.position);
      entry.body?.remove?.(); entry.body = null; motion.stop(entry); motion.lift(entry);
      placed = placed.filter(e => e !== entry); forgetItem(entry.id);
      creature.hold.updateMatrixWorld(true);
      const hp = creature.hold.localToWorld(new THREE.Vector3(0, entry.pivot.userData.size.y * .3, 0));
      await glide(entry.pivot, hp, .4, Math.min(entry.pivot.scale.x, 1));
      creature.reach(null);
      const e2 = { words: entry.words, seed: entry.seed, sizeK: entry.sizeK, density: entry.density ?? 300, short: entry.short, desc: entry.desc, pivot: entry.pivot, body: null };
      e2.pivot.scale.setScalar(1); hold(e2); entry = e2;
      if (toHands) { await goHome(); return `Fetched ${name} back into your hands.`; }
    } else if (away) { held = null; creature.holding = false; vanish(entry); return `Made ${name} vanish.`; }
    else if (toHands) return `${name} is already in your hands.`;

    // carry it to the spot and put it down
    const S = SPOTS[spot], size0 = Math.max(entry.pivot.userData.size.x, entry.pivot.userData.size.y, entry.pivot.userData.size.z);
    let size = SIZES[input.size] ?? Math.max(size0, .3);
    if (S.small) size = Math.min(size, .3);
    const k = size / size0, r = Math.max(entry.pivot.userData.size.x, entry.pivot.userData.size.z) * k / 2;
    const near = input.near ? findItem(input.near, placed) : null;
    const p = freePlace(spot, r, placed, near);
    const [sx, sz] = standFor(p.x, p.z, r), face = Math.atan2(p.x - sx, p.z - sz);
    gs.sound.sounds.whoosh?.();
    await walkTo(sx, sz); await pause(.2, face);
    const ry = face + Math.PI;   // (its front, as it held it, turned to face the room)
    creature.reach(new THREE.Vector3(p.x, p.y + .1, p.z));
    const pivot = entry.pivot; held = null; creature.holding = false; motion.stop(entry);
    toWorld(pivot);
    const goal = new THREE.Vector3(p.x, p.y + entry.pivot.userData.size.y * k / 2, p.z);
    const q0 = pivot.quaternion.clone(), q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0));
    await glide(pivot, goal, .45, k, e => pivot.quaternion.slerpQuaternions(q0, q1, e));   // (turned upright as it goes)
    pivot.quaternion.copy(q1);
    creature.reach(null); gs.sound.sounds.pop(); fx.sparks({ x: p.x, y: p.y + .02, z: p.z }, { color: '#ffe2b0', count: 14, power: .4, light: false });
    const item = { id: entry.id || newId(), words: entry.words, seed: entry.seed, sizeK: entry.sizeK, density: entry.density, size, spot, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), ry: +ry.toFixed(3), r: +r.toFixed(3), short: entry.short, desc: entry.desc };
    const e = { ...item, pivot, body: null }; settle(e); placed.push(e); keepItem(item);
    pushUndo({ kind: 'placed', id: item.id });
    motion.land(e); motion.life(e, { still: true }); if (near) motion.wobble(near, motion.FEEL.bump);   // (it squashes down onto the spot, and its neighbour rocks)
    await pause(.25, face); await goHome(); creature.gesture('nod');
    return `Carried ${name} over and put it ${S.about}${near ? `, next to ${near.short || near.words}` : ''}, at ${Math.round(size * 100)} cm. It stays in the room, and is remembered next time.`;
  }

  const api = {
    get view() { return v; },
    /** The room's light (light.js). */
    get light() { return light; },
    /** Karaoke's party lights (party.js): on, beat(phase). */
    get party() { return party; },
    /** The day outside and its weather (daylight.js). */
    get daylight() { return daylight; },
    get creature() { return creature; },
    get held() { return held; },
    /** The physics world (the engine's World3D): props, tables and dice are bodies in it. */
    get physics() { return world; },
    /** Loose props on the floor: [{ short, at: { x, y, z } }] (for tests). */
    get floor() { return loose.map(e => ({ short: e.short, at: { x: e.pivot.position.x, y: e.pivot.position.y, z: e.pivot.position.z } })); },
    /** How many props there are, held or on the floor. */
    get props() { return loose.length + (held ? 1 : 0); },
    /** What is in its hands and on the floor, in a line for Claude. */
    scene() {
      const floor = loose.map(e => e.short).slice(-6);
      if (dice?.onFloor) floor.push(dice.onFloor);
      if (rubble?.count) floor.push('some broken bits');
      const out = daylight?.line();
      return `In your hands: ${held ? held.short : 'nothing'}.${floor.length ? ` On the floor: ${floor.join(', ')}.` : ''}${roomLine(placed)}${out ? ` Outside: ${out}.` : ''}${keeper?.line() || ''}${lines.map(f => { try { return f() || ''; } catch { return ''; } }).join('')}`;
    },
    reset() {
      if (!v) setup();
      motion ||= makeMotion({ view: v, fx });
      keeper ||= makePet({ scene: v.scene, camera: v.cam, creature, world: api, floaties, sparks: stage.sparks, mood: { fun: (k, n) => mood?.fun(k, n) }, news: text => onNews(text, false) });
      if (!restored) { restored = true; restoreRoom(); keeper.restore(); }
      for (const e of loose) remove(e); loose = []; if (held) remove(held); held = null; creature.holding = false;
      fx.clear(); for (const e of placed) motion.life(e, { still: true }); embers = makeEmbers(); creature.mood('calm');
      rubble ||= new gs.destruction.Rubble(v.scene, { max: 60, life: 9, shrink: .8 }); rubble.clear();
      shows ||= makeShows({ fx, creature, floaties }); shows.clear();
      dice ||= makeDice({ THREE, scene: v.scene, physics: world, creature, sparks: stage.sparks }); dice.clear();
      endGame();
    },
    resize(w, h) {
      W = w; H = h; look?.size(w, h);
      if (v?.cam && W > 0 && H > 0) {
        // a tall screen sees as wide as a square one would, so the creature never crops at the sides
        const a = W / H;
        v.cam.fov = a < 1 ? 2 * Math.atan(Math.tan(21 * Math.PI / 180) / a) * 180 / Math.PI : 36;
        v.cam.aspect = a;
        v.cam.updateProjectionMatrix();
        lastAspect = a;
      }
    },
    /** Looking around the room (look.js): the page's drags, pinches and scrolls. */
    get look() { return look; },
    set look(l) { look = l; l?.size(W, H); },
    update(dt) {
      t += dt;
      const a = W / H;
      if (a !== lastAspect && W > 0 && H > 0) {
        v.cam.fov = a < 1 ? 2 * Math.atan(Math.tan(21 * Math.PI / 180) / a) * 180 / Math.PI : 36;
        v.cam.aspect = a; v.cam.updateProjectionMatrix();
        lastAspect = a;
      }
      // the camera eases to the game's seat and back
      // (a wide window looks a little higher, so the shelves and windows on the back wall are in the picture, not cut off at the top)
      const goal = game?.camera || seat || (a > 1.05 ? WIDE : HOME), ck = 1 - Math.exp(-dt * 3);
      for (let i = 0; i < 3; i++) {
        camAt.pos[i] += (goal.pos[i] - camAt.pos[i]) * ck;
        camAt.look[i] += (goal.look[i] - camAt.look[i]) * ck;
      }
      const seen = look ? look.view(camAt, dt, goal) : camAt;
      v.cam.position.set(...seen.pos); v.cam.lookAt(...seen.look);
      game?.update(dt);
      if (acts.length) { if (acts[0](dt)) acts.shift(); body.place(creature.root.position.x, .33, creature.root.position.z); }
      creature.update(dt, v.cam); outfits.update(dt);
      daylight.update(dt); sleepy.update(dt);
      light.update(dt, t);
      floorMirror?.upgrade(v);
      party.update(dt); v.exposure *= party.dim;   // (the room a little darker while the party lights are up)
      creature.coreAt(at);
      emberAt.x = at.x; emberAt.y = at.y; emberAt.z = at.z + .03;
      const st = creature.state; embers.at(emberAt); embers.rate = st.thinking ? 14 : st.listening ? 6 : st.speaking ? 4 : 2; embers.on = true;
      // props springing (popping in, landing, wobbling, vanishing) and their own small movements; a thing it brushes past rocks
      every.length = 0; if (held) every.push(held); for (const e of loose) every.push(e);
      const cr = creature.root.position;
      for (const e of placed) {
        every.push(e);
        const d = Math.hypot(cr.x - e.x, cr.z - e.z), r = (e.r || .15) + .3;
        if (!e.brushed && d < r && acts.length) { e.brushed = true; motion.wobble(e, motion.FEEL.bump); } else if (d > r + .15) e.brushed = false;
      }
      motion.update(dt, every);
      if (held) { held.pivot.rotation.y += dt * .5; held.pivot.position.y = held.pivot.userData.size.y * .3 + Math.sin(t * 2.4) * .01; }
      // Only step Rapier WASM physics when dynamic bodies (loose props, dice, rubble) or walking body are active
      if (loose.length || (rubble?.count || 0) > 0 || dice?.active || acts.length) world.step(dt);
      dice?.update(dt);
      if (loose.length) {
        let fallen = false;
        for (const e of loose) if (e.pivot.position.y < -4) { remove(e); fallen = true; }
        if (fallen) loose = loose.filter(e => e.pivot.position.y >= -4);
        while (loose.length > 14) remove(loose.shift());
      }
      keeper?.update(dt);
      rubble?.update(dt); shows?.update(dt);
      fx.update(dt); motes.update(dt); floaties.update(dt);
    },
    draw(c) { v.render(c, W, H); },
    /** What a tap at (x, y) in CSS pixels hit: 'game' (the game used it), 'creature', 'prop' or null. */
    tap(x, y) {
      ndc.set(x / W * 2 - 1, -(y / H) * 2 + 1); ray.setFromCamera(ndc, v.cam);
      if (game?.tap(ray)) return 'game';
      if (held && ray.intersectObject(held.pivot, true).length) return 'prop';
      if (keeper?.tap(ray)) return 'pet';
      // a thing in the room rocks when tapped (and a box, a chest or a laptop opens or shuts)
      const hit = placed.find(e => !motion.going(e) && ray.intersectObject(e.pivot, true).length);
      if (hit) {
        motion.wobble(hit); gs.sound.sounds.boing?.();
        if (hit.life?.parts?.some(m => /lid|hatch|door/.test(m.userData.part))) { hit.open = !hit.open; hit.life.open('lid', +hit.open); hit.life.open('hatch', +hit.open); hit.life.open('doors', +hit.open); }
        return 'thing';
      }
      if (ray.intersectObject(creature.root, true).length) return 'creature';
      return null;
    },

    // ---- games
    /** The game being played, or null. */
    get game() { return game; },
    /** Who hears what a game says happened (the brain). */
    set onNews(fn) { onNews = fn; },
    /** Who says a game's own lines out loud at once (the brain's speak), returning false when busy. */
    set onSay(fn) { onSay = fn; },
    /** Adaptive Tiny Brains skill getter & win/loss reporter for tabletop games. */
    set skill(fn) { getSkill = fn; },
    set onGameResult(fn) { onGameResult = fn; },
    /** The drawing pad, lent to games drawn on it. */
    set pad(p) { pad = p; },
    /** Starts a game by name ('chess'), or a fresh round of the one on. Resolves a sentence for Claude. */
    async play(name, o = {}) {
      const def = GAMES[name];
      if (!def) return `There is no game called "${name}". Games here: ${Object.keys(GAMES).join(', ')}.`;
      if (game && game.id !== name) endGame();
      clearTheTable();   // (hands free to play, and room on the floor for its table)
      const seq = ++playSeq;
      let makeFn;
      try { makeFn = games[name] ? null : await loadGameMaker(name); } catch (e) {
        return `The game could not load (${String(e?.message || e).slice(0, 80)}).`;
      }
      if (seq !== playSeq) return `The ${def.title.toLowerCase()} was put away before it finished loading.`;
      const g = game = games[name] ||= makeFn(stage);
      light?.setDof?.(false);
      creature.gesture('tada'); creature.mood('excited');
      let r;
      try { r = await g.start(o); } catch (e) {
        if (game === g) endGame(); else try { g.stop(); } catch { /* already away */ }
        return `The game could not start (${String(e?.message || e).slice(0, 80)}).`;
      }
      // (put away, or swapped for another game, while it was still setting up, which can take a while the first time
      // its rules or questions load: what it set up after that goes away too, so nothing is left on the floor)
      if (game !== g) { try { g.stop(); } catch { /* already away */ } return `The ${g.title.toLowerCase()} was put away before it finished setting up.`; }
      return r;
    },
    /** A fresh round of the game on, as its Again button does; Claude hears what the new round is, out loud. */
    async again() {
      const g = game; if (!g) return '';
      const r = await api.play(g.id);
      if (game === g) onNews(`[${GAMES[g.id].tag}] They asked for another round. ${r}`, true);
      return r;
    },
    /** Puts the game away. */
    async stopGame() {
      if (!game) return 'No game was being played.';
      const t = game.title; endGame();
      return `Put the ${t.toLowerCase()} away.`;
    },

    // ---- Claude's hands
    make: words => makeProp(words),
    async change(words) {
      if (!held) return 'Nothing is being held, so nothing changed. Make something first.';
      const ch = String(words || '').trim().replace(/^make it\s+/i, '').slice(0, 60);
      const base = article(held.words);
      const prompt = /^(made of|with|without|no|covered in)\b/i.test(ch) ? `a ${base} ${ch}` : `a ${ch} ${base}`;
      let k = held.sizeK;
      if (/\b(bigger|larger)\b/i.test(ch)) k *= 1.35; else if (/\b(smaller)\b/i.test(ch)) k *= .7;
      else for (const [re, f] of SIZE_WORDS) if (re.test(ch.toLowerCase())) { k = f; break; }
      const old = held; held = null; creature.holding = false; vanish(old, '#9fd8ff');
      const r = await makeProp(prompt, { seed: old.seed, sizeK: clamp(k, .3, 2.2), asked: ch });
      return r.startsWith('Made') ? r.replace(/^Made/, 'Changed it into') : r;
    },
    async toss() {
      if (!held) return 'Nothing is being held to throw.';
      creature.gesture('point'); const w = held.words; gs.sound.sounds.whoosh();
      release(held, true); return `Threw ${w} onto the floor.`;
    },
    async clear(o = {}) {
      const n = loose.length + (held ? 1 : 0) + (dice?.clear() || 0), m = o.room ? placed.length : 0;
      [...(held ? [held] : []), ...loose, ...(o.room ? placed : [])].forEach((e, i) => vanish(e, '#ffffff', Math.min(i, 12) * .06));
      const bits = rubble?.count || 0; rubble?.clear();
      loose = []; held = null; creature.holding = false;
      if (!n && bits && !o.room) { gs.sound.sounds.pop(); return 'Swept up the broken bits.'; }
      if (o.room) { placed = []; forgetAll(); }
      const kept = placed.length ? ` The ${placed.length} thing${placed.length > 1 ? 's' : ''} kept in the room stayed.` : '';
      return n + m ? `Cleared ${n + m} prop${n + m > 1 ? 's' : ''}.${kept}` : `There was nothing to clear.${kept}`;
    },
    /** Its body and glow colours ({ body, glow, reset }), kept for next time. */
    async recolour(input) {
      const r = tidyColours(input, THREE);
      if (r.error) return { text: `Not changed: ${r.error}.`, error: true };
      creature.setColours(r.colours); keepColours(r.colours);
      light.recolour();
      embers.remove(); embers = makeEmbers();
      creature.gesture('tada'); poof(creature.core, creature.glowed('#ffd27a')); gs.sound.sounds.pop();
      return { text: `Your body is now ${r.colours.body} and your glow ${r.colours.glow}. It is remembered next time.` };
    },
    /** What it wears (outfits.js). */
    get outfits() { return outfits; },
    /** The wear tool ({ put_on, take_off, colour }): puts clothes on or takes them off, kept for next time. */
    async wear(input) {
      const r = outfits.wear(input);
      if (r.changed) { creature.gesture('tada'); creature.mood('happy'); poof(creature.face3d, '#fff0c8'); gs.sound.sounds.pop(); v.precompile?.(); }
      return r;
    },
    /** Dresses it for the voice it has now (a character voice puts on its outfit): a sentence for Claude, or ''. */
    dressFor(name) {
      const text = outfits.forVoice(name);
      if (text) { poof(creature.face3d, '#fff0c8'); v.precompile?.(); }
      return text;
    },
    /** Rolls dice ("2d6", "d20"): real ones thrown onto the rug where it can. Resolves a sentence for Claude. */
    roll: text => dice.roll(text),
    /** The things kept in the room, as saved: [{ id, words, spot, x, y, z, ... }]. */
    get room() { return placed.map(({ pivot, body, ...i }) => i); },
    /** The props' springs and small movements (motion.js). */
    get motion() { return motion; },
    /** The things kept in the room, with their pivots: [{ pivot, words, spot, life, ... }]. */
    get kept() { return placed; },
    /** True while it is walking about the room with something. */
    get walking() { return acts.length > 0; },
    /** Walks it to (x, z) on the floor, after anything it is already doing. Resolves when it is there. */
    walkTo: (x, z) => walkTo(clamp(x, -1.7, 1.9), clamp(z, -.95, 1.1)),
    /** Walks it back to its place in the middle, facing you. */
    goHome: () => goHome(),
    /** Where the camera sits when no game has a seat: { pos, look }, or null for its usual place. */
    get seat() { return seat; }, set seat(s) { seat = s || null; },
    /** Puts something in the room ({ item, spot, near, size }), carrying it there itself. Resolves a sentence. */
    place(input) { const job = carrying.then(() => placeIt(input)); carrying = job.catch(() => {}); return job; },
    /** The colours of the room's walls, floor, rug and woodwork ({ walls, floor, rug, wood, reset }), kept for next time. */
    async recolourRoom(input) {
      const prev = roomColours();
      const r = tidyRoomColours(input, THREE);
      if (r.error) return { text: `Not changed: ${r.error}.`, error: true };
      pushUndo({ kind: 'colours', colours: prev });
      for (const k of r.changed) {
        const meshes = roomParts[k]; if (!meshes.length) continue;
        const old = new Set(meshes.map(m => m.material)), m = roomMat(k, r.colours[k]);
        for (const mesh of meshes) mesh.material = m;
        for (const o of old) o.dispose?.();
      }
      keepRoomColours(r.colours);
      setTimeout(() => { for (const r of relight) r?.bake?.(); }, 600);   // (once the new materials' pictures are painted)
      creature.gesture('tada'); gs.sound.sounds.pop();
      return { text: `The room's ${r.changed.join(', ')} ${r.changed.length > 1 ? 'are' : 'is'} now ${r.changed.map(k => r.colours[k]).join(', ')}. It is remembered next time.` };
    },
    /** Undoes the last room colour change, kept prop placement, or prop removal. */
    async undoRoom() {
      const u = roomUndo.pop();
      if (!u) return 'Nothing in the room to undo.';
      if (u.kind === 'colours') {
        for (const [k, hex] of Object.entries(u.colours)) {
          const meshes = roomParts[k]; if (!meshes?.length) continue;
          const old = new Set(meshes.map(m => m.material)), m = roomMat(k, hex);
          for (const mesh of meshes) mesh.material = m;
          for (const o of old) o.dispose?.();
        }
        keepRoomColours(u.colours);
        setTimeout(() => { for (const r of relight) r?.bake?.(); }, 600);
        gs.sound.sounds.pop();
        return 'Undid the last room colour change.';
      }
      if (u.kind === 'placed') {
        const e = placed.find(x => x.id === u.id);
        if (!e) return 'That item is already gone.';
        vanish(e); placed = placed.filter(x => x !== e); forgetItem(e.id);
        return `Undid placing ${e.short || e.words}.`;
      }
      if (u.kind === 'removed' && u.item) {
        const i = u.item;
        let thing = null;
        try { thing = await gs.models.generate.make(i.words, { seed: i.seed }); } catch {}
        if (!thing) return 'Could not restore that item.';
        const pivot = pivotFor(thing, i.size), e = { ...i, pivot, body: null };
        pivot.position.set(i.x, i.y + pivot.userData.size.y / 2, i.z); pivot.rotation.set(0, i.ry || 0, 0);
        v.scene.add(pivot); settle(e); placed.push(e); keepItem(i);
        motion.life(e, { still: true }); motion.appear(e); gs.sound.sounds.pop();
        return `Put ${i.short || i.words} back in the room.`;
      }
      return 'Nothing to undo.';
    },
    /** Drag-to-rearrange kept props: pickKept(x, y) starts dragging a kept item on its surface plane. */
    pickKept(x, y) {
      if (game) return null;
      ndc.set(x / W * 2 - 1, -(y / H) * 2 + 1); ray.setFromCamera(ndc, v.cam);
      const hit = placed.find(e => !motion.going(e) && ray.intersectObject(e.pivot, true).length);
      if (!hit) return null;
      return hit;
    },
    dragKept(e, x, y) {
      if (!e || !placed.includes(e)) return false;
      ndc.set(x / W * 2 - 1, -(y / H) * 2 + 1); ray.setFromCamera(ndc, v.cam);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -e.y);
      const pt = new THREE.Vector3();
      if (!ray.ray.intersectPlane(plane, pt)) return false;
      const S = SPOTS[e.spot], r = e.r || .15;
      let nx = pt.x, nz = pt.z;
      if (S?.board) {
        nx = clamp(nx, S.board.x0 + r, S.board.x1 - r);
        nz = onBoard(S.board, nx)[2];
      } else {
        nx = clamp(nx, -1.75, 1.85); nz = clamp(nz, -1.15, 1.15);
        if (!inRoom(nx, nz, r, e.y)) return false;
      }
      e.x = +nx.toFixed(3); e.z = +nz.toFixed(3);
      e.pivot.position.set(e.x, e.y + e.pivot.userData.size.y * e.pivot.scale.x / 2, e.z);
      return true;
    },
    rotateKept(e, deltaRad) {
      if (!e || !placed.includes(e)) return;
      e.ry = +((e.ry || 0) + deltaRad).toFixed(3);
      e.pivot.rotation.y = e.ry;
      settle(e);
      const { pivot, body, life, open, flexing, brushed, ...saved } = e;
      keepItem(saved);
    },
    dropKept(e) {
      if (!e || !placed.includes(e)) return;
      settle(e);
      motion.wobble(e, motion.FEEL.bump);
      gs.sound.sounds.pop();
      const { pivot, body, life, open, flexing, brushed, ...saved } = e;
      keepItem(saved);
    },
    /** Breaks the prop it holds (or the last one thrown on the floor): how 'smash' into real pieces that tumble, or
     *  'slice' in two. Resolves a sentence. */
    async smash(how = 'smash') {
      const e = held || loose[loose.length - 1];
      if (!e) return { text: 'Not done: there is nothing in your hands or on the floor to break. Make something first.', error: true };
      how = how === 'slice' ? 'slice' : 'smash';
      if (e === held) { held = null; creature.holding = false; } else loose = loose.filter(x => x !== e);
      if (e.body) { e.body.remove(); e.body = null; }
      creature.gesture(how === 'slice' ? 'point' : 'bounce'); creature.mood('excited');
      let r = null;
      try { r = breakApart(e.pivot, { how, world, rubble, scene: v.scene, density: e.density }); } catch (err) { console.warn('[reverie] smash', err); }
      if (!r) { poof(e.pivot, '#ffffff'); remove(e); gs.sound.sounds.pop(); return `${e.short || e.words} went up in a puff instead: it would not break.`; }
      fx.sparks(r.at, { color: how === 'slice' ? '#e8f4ff' : '#f2e6d8', count: how === 'slice' ? 20 : 30, power: .9, light: false });
      if (how === 'slice') gs.sound.sounds.slash?.(); else { gs.sound.sounds.shatter?.(); setTimeout(() => gs.sound.sounds.crumble?.(), 180); }
      return how === 'slice' ? `Sliced ${e.short || e.words} clean in two: both halves fell on the rug.` : `Smashed ${e.short || e.words} into ${r.pieces} pieces that went tumbling across the rug. They fade away in a little while.`;
    },
    /** A little show (fun.js): fireworks, confetti, magic, bubbles, snow or hearts. Resolves a sentence. */
    async show(kind) { return shows ? shows.play(kind) : 'Not done: the room is not ready yet.'; },
    /** The stage's physics (a gs.physics3d World3D), for the phone's tilt and shakes. */
    get physics() { return world; },
    /** The bodies of everything loose on the floor: props thrown down and broken bits. */
    floorBodies: () => [...loose.map(e => e.body), ...(rubble?.list || []).map(m => m.body)].filter(b => b && !b.dead),
    /** A little shower of sparks at a point in the room (trophies.js). */
    sparks: (p, colour, n) => stage.sparks(p, colour, n),
    /** A burst of confetti round it, and a little hop (a birthday, a streak). */
    celebrate() {
      creature.gesture('tada'); creature.mood('excited');
      const cols = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff'];
      cols.forEach((color, i) => setTimeout(() => fx.sparks({ x: Math.cos(i * 1.26) * .3, y: .75 + (i % 2) * .1, z: .2 + Math.sin(i * 1.26) * .2 }, { color, count: 22, power: 1.1, light: false }), i * 140));
      gs.sound.sounds.coin?.();
    },
    async act(gesture, mood) {
      if (mood) creature.mood(mood); if (gesture) creature.gesture(gesture);
      return 'Done.';
    },

    // ---- its pet, its mood, and more for the scene line
    /** The pet tool ({ action, animal, name, colour, trick }): resolves a sentence. */
    pet: input => keeper ? keeper.command(input) : Promise.resolve({ text: 'Not done: the room is not ready yet.', error: true }),
    /** Its pet (pet.js): pet, about, mode, greet(), ... */
    get keeper() { return keeper; },
    /** Hearts and z's floating up (floaties.js). */
    get floaties() { return floaties; },
    /** Its mood (mood.js), which the pet's fun lifts. */
    get mood() { return mood; }, set mood(m) { mood = m; },
    /** Props on the floor, for the pet to chase: [{ pivot, body }]. */
    floorThings: () => loose,
    /** Adds a line to what Claude is told of the scene each turn (fn returns text starting with a space, or ''). */
    addLine(fn) { lines.push(fn); },
  };
  prefetchGames();
  return api;
}
