// The stage: a cosy workshop corner in the engine's Next Gen view, the creature in the middle of it, props made by
// the engine's 3D generator held in its hands, and a physics floor for props it throws. Built the way a Game Scroll
// game is (make, reset, update, draw), so the engine's kits load and run as they do in the app.
import gs from '../engine/src/gamescroll.js';
import { makeCreature } from './creature.js';
import { colours, tidyColours, keepColours } from './looks.js';
import { describe } from './describe.js';
import { GAMES } from './games/index.js';
import { lightRoom, WINDOW } from './light.js';
import { makeDaylight } from './daylight.js';
import { makeSleepy } from './sleepy.js';
import { makeDice } from './dice.js';
import { SPOTS, SPOT_NAMES, spotOf, roomColours, roomItems, tidyRoomColours, keepRoomColours, keepItem, forgetItem, forgetAll, freePlace, findItem, roomLine, inRoom, MAX_ITEMS } from './room.js';

const HOLD_SIZE = .4;            // metres: the longest side of a prop in its hands
const SIZE_WORDS = [[/\b(giant|huge|enormous)\b/, 1.8], [/\b(bigger|big|large)\b/, 1.4], [/\b(smaller|small|little)\b/, .7], [/\b(tiny|teeny)\b/, .5]];
const article = w => w.replace(/^(a|an|the|some)\s+/i, '');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

let v, light, creature, fx, world, room, embers, motes, body, daylight, sleepy;
// the room's recolourable parts: the meshes made of each, and the recipe they are made from
const ROOM_LOOK = { walls: null, floor: ['wood', [8, 8]], rug: null, wood: ['wood', [1, 1]] };
const roomParts = { walls: [], floor: [], rug: [], wood: [] }, relight = [];
// soft felt, with a sheen like Reverie's own plush (for the rug and the pouf)
const felt = colour => { const c = new gs.hd.THREE.Color(colour); return gs.hd.pbr(colour, { rough: .95, sheen: .7, sheenColor: '#' + c.clone().lerp(new gs.hd.THREE.Color('#ffffff'), .55).getHexString(), sheenRoughness: .6 }); };
// (the walls are smooth matte paint and the rug felt, made here: the recipes' textures read as blotchy plaster and a
// straw mat up close)
const roomMat = (part, colour) => ROOM_LOOK[part] ? gs.models.material(ROOM_LOOK[part][0], { colour, repeat: ROOM_LOOK[part][1] }) : Object.assign(part === 'rug' ? felt(colour) : gs.hd.pbr(colour, { rough: .9 }), { name: 'room:' + part });

function setup() {
  const { HDView, pbr, rbox, THREE } = gs.hd, { material, prop } = gs.models;
  // parts that may still be loading go first: if one throws StillLoading, setup runs again from the top with nothing made
  const w3 = new gs.physics3d.World3D({ gravity: -9.81 });
  v = new HDView({ bg: '#2a1d16', fog: 0, fov: 36 });   // (its light, mood and finish: light.js)
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
  const rug = part('rug', new THREE.Mesh(new THREE.LatheGeometry(rugShape, 96), roomMat('rug', rc.rug))); add(rug, false);
  const wallMat = roomMat('walls', rc.walls);
  const back = part('walls', new THREE.Mesh(rbox(6, 3, .2, .02), wallMat)); back.position.set(0, 1.5, -1.7); add(back);
  // the left wall, round a big window the daylight comes in by (the wall in four pieces round the opening)
  const W0 = WINDOW, wz = (W0.z0 + W0.z1) / 2, wy = (W0.y0 + W0.y1) / 2;
  const wall = (y0, y1, z0, z1) => { const m = part('walls', new THREE.Mesh(rbox(.2, y1 - y0, z1 - z0, .02), wallMat)); m.position.set(W0.x, (y0 + y1) / 2, (z0 + z1) / 2); add(m); };
  wall(0, W0.y0, -1.9, 4.2); wall(W0.y1, 3, -1.9, 4.2); wall(W0.y0, W0.y1, -1.9, W0.z0); wall(W0.y0, W0.y1, W0.z1, 4.2);
  // its slim frame, one bar across, and a deep sill to sit things on
  const wood = roomMat('wood', rc.wood);
  const frame = (h, d, y, z) => add(part('wood', new THREE.Mesh(rbox(.2, h, d, .012), wood))).position.set(W0.x + .02, y, z);
  frame(.035, W0.z1 - W0.z0 + .07, W0.y0, wz); frame(.035, W0.z1 - W0.z0 + .07, W0.y1, wz);
  frame(W0.y1 - W0.y0, .035, wy, W0.z0); frame(W0.y1 - W0.y0, .035, wy, W0.z1); frame(W0.y1 - W0.y0, .03, wy, wz);
  const ledge = part('wood', new THREE.Mesh(rbox(.3, .035, W0.z1 - W0.z0 + .14, .012), wood)); ledge.position.set(W0.x + .1, W0.y0 - .02, wz); add(ledge);
  // (the day outside: a soft bright sky the room's reflections and bounce light pick up; it throws no shadow)
  // (daylight.js paints it with the real sky outside: day, dusk, night with stars, cloud, fog)
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.4), pbr('#eef0ec', { glow: 1.05, glowCol: '#f4f2ea', rough: 1 }));
  sky.position.set(W0.x - .8, 1.6, wz); sky.rotation.y = Math.PI / 2; room.add(sky);
  // a white ceiling (out of view): it closes the room, so daylight comes in only by the windows and bounces about
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4), pbr('#f1ece5', { rough: .95 }));
  ceiling.rotation.x = Math.PI / 2; ceiling.position.set(.9, 3, 1.1); add(ceiling);
  // skirting along both walls: a small thing that makes a room read as real
  const skirt = (w, d, x, z) => { const m = part('wood', new THREE.Mesh(rbox(w, .07, d, .01), wood)); m.position.set(x, .035, z); add(m); };
  skirt(6, .02, 0, -1.59); skirt(.02, 6, -1.99, 1.2);
  // a round window in the back wall, the day outside it, a deep reveal and a sill
  // (just off the wall's face, not in it: in it, the two flickered in wedges. Matte, so the sky painted in it by
  // daylight.js reads: the stars and moon at night, not the room mirrored over them)
  const glass = new THREE.Mesh(new THREE.CircleGeometry(.31, 64), pbr('#eef0ec', { rough: 1, glow: .9, glowCol: '#f2f0e8' }));
  glass.position.set(-.3, 1.5, -1.597); room.add(glass);
  const GLASS = { x: -.3, y: 1.5, z: -1.597, r: .31 };
  const reveal = part('wood', new THREE.Mesh(new THREE.TorusGeometry(.33, .025, 16, 72), wood)); reveal.position.set(-.3, 1.5, -1.585); add(reveal);
  const sill = part('wood', new THREE.Mesh(rbox(.86, .04, .14, .012), wood)); sill.position.set(-.3, 1.125, -1.53); add(sill);
  // the desk (where it makes things): a pale oak top on slim rounded legs, and a globe lamp
  const pale = pbr('#ece6dd', { rough: .55 });   // (powder-coated legs and lamp, a soft warm white)
  const top = part('wood', new THREE.Mesh(rbox(1.3, .04, .55, .015), wood)); top.position.set(1.15, .795, -1.25); add(top);
  for (const [x, z] of [[.58, -1.05], [1.72, -1.05], [.58, -1.45], [1.72, -1.45]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(.016, .012, .775, 16), pale); leg.position.set(x, .388, z); add(leg); }
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(.06, .068, .018, 40), pale); lampBase.position.set(1.55, .824, -1.32); add(lampBase);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, .2, 12), pale); stem.position.set(1.55, .93, -1.32); add(stem);
  const globeMat = pbr('#fff6e8', { rough: .35, glow: 1.6, glowCol: '#ffe2b8' });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(.075, 40, 24), globeMat); globe.position.set(1.55, 1.1, -1.32); room.add(globe);
  // a floating shelf, with a small vase
  const shelf = part('wood', new THREE.Mesh(rbox(1.1, .04, .26, .012), wood)); shelf.position.set(-1.35, 1.45, -1.5); add(shelf);
  const vaseShape = [[0, 0], [.045, 0], [.055, .03], [.05, .09], [.03, .13], [.026, .16], [.032, .17], [0, .17]].map(([x, y]) => new THREE.Vector2(x, y));
  const vase = new THREE.Mesh(new THREE.LatheGeometry(vaseShape, 40), pbr('#d9b8a4', { rough: .45, clear: .4 })); vase.position.set(-1.7, 1.47, -1.52); add(vase);
  // a round pouf in the back left corner, soft like Reverie
  const pouf = new THREE.Mesh(new THREE.SphereGeometry(.26, 48, 24), felt('#b4bfa8'));
  pouf.scale.set(1, .62, 1); pouf.position.set(-1.45, .16, -1.15); add(pouf);
  // a plant on the right, in a tall matte pot
  const potShape = [[0, 0], [.13, 0], [.16, .04], [.17, .38], [.165, .4], [0, .4]].map(([x, y]) => new THREE.Vector2(x, y));
  const pot = new THREE.Mesh(new THREE.LatheGeometry(potShape, 48), pbr('#efeae3', { rough: .8 })); pot.position.set(1.85, 0, -.6); add(pot);
  const plant = gs.models.tree('fan', { seed: 7 }); fitTo(plant, 1.05); standAt(plant, 1.85, .37, -.6); shade(plant); room.add(plant);
  // a little dust drifting in the daylight
  motes = new gs.fx3d.Particles3D(v.scene);
  // (where the sun's beams cross the room, between the window and the creature)
  const dust = motes.make({ x: -.9, y: 1.1, z: .2 }, { loop: true, rate: 3, life: [6, 10], speed: [.01, .04], size: [.004, .008], colors: ['#ffe6c0', '#ffd09a'], radius: 1.2, gravity: -.004, glow: false, shrink: false });
  creature = makeCreature(); v.scene.add(creature.root);
  creature.setColours(colours());   // (the colours it was asked for last time, kept on this device)
  // the light: the sun through the window, the bench lamp, its core, bounce light and the room's own reflections
  // (made once the creature is in the room, so the reflections reach its eyes and glass dome)
  light = lightRoom(v, creature, { min: [-2.0, 0, -1.6], max: [2.2, 3, 2.2] });
  relight.push(light.bounce, light.room);   // (both baked again when the room is repainted)
  // the real day outside: the sun, the sky in the windows, the lamp, rain on the glass (daylight.js)
  daylight = makeDaylight({ v, light, outside: { side: sky.material, round: glass.material }, glass: GLASS, side: W0, globe: globeMat, motes: dust });
  sleepy = makeSleepy({ scene: v.scene, creature });   // (Z's over its head when it dozes off late at night)
  fx = new gs.fx3d.Particles3D(v.scene);
  // embers drifting up from its core: a few when idle, more while listening, a stream while thinking
  embers = makeEmbers();
  world = w3;
  world.floor(0, { friction: .8 });
  world.box(null, 6, 3, .2, { fixed: true, at: { x: 0, y: 1.5, z: -1.7 } });
  world.box(null, .2, 3, 5, { fixed: true, at: { x: -2.1, y: 1.5, z: .6 } });
  body = world.box(null, .48, .66, .42, { moving: true, at: { x: 0, y: .33, z: 0 } });   // (the creature: props bounce off it, not through, and it goes where it walks)
  world.box(null, 1.3, .04, .55, { fixed: true, at: { x: 1.15, y: .795, z: -1.25 } });   // (the desk top and the shelf: things thrown land on them)
  world.box(null, 1.1, .04, .26, { fixed: true, at: { x: -1.35, y: 1.45, z: -1.5 } });
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
  let W = 360, H = 640, held = null, loose = [], seed = 1, t = 0, pops = [];
  // things kept in the room (room.js has what is saved), what it is doing with its legs now, and carrying jobs in a queue
  let placed = [], acts = [], carrying = Promise.resolve(), restored = false;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), at = new THREE.Vector3();
  // a game on the stage (./games): the one being played, the ones made so far, and where the camera is heading
  let game = null, onNews = () => {}, dice = null;
  const games = {}, HOME = { pos: [0, .78, 1.95], look: [0, .4, 0] }, camAt = { pos: [...HOME.pos], look: [...HOME.look] };
  const stage = {
    THREE, get scene() { return v.scene; }, get creature() { return creature; }, get physics() { return world; },
    sparks(p, color = '#ffd27a', count = 24) { fx.sparks({ x: p.x, y: p.y, z: p.z }, { color, count, power: .7, light: false }); },
    news: (text, loud) => onNews(text, loud),
  };

  // a prop sits in a pivot whose middle is the prop's middle, so it can be held, spun and given a box body
  function pivotFor(thing, size) {
    const p = new THREE.Group();
    fitTo(thing, size); const b = boxOf(thing), c = b.getCenter(new THREE.Vector3());
    thing.position.sub(c); p.add(thing);
    thing.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    p.userData.size = b.getSize(new THREE.Vector3());
    return p;
  }
  function hold(entry) {
    held = entry; creature.hold.add(entry.pivot); entry.pivot.position.set(0, entry.pivot.userData.size.y * .3, 0); entry.pivot.rotation.set(0, 0, 0);
    creature.holding = true; pops.push({ o: entry.pivot, t: 0 });
  }
  function poof(o, color = '#ffd27a') {
    o.getWorldPosition(at);
    fx.sparks({ x: at.x, y: at.y, z: at.z }, { color, count: 36, power: 1.4, light: true });
  }
  function release(entry, throwIt) {
    const p = entry.pivot, s = p.userData.size;
    p.getWorldPosition(at); const q = p.getWorldQuaternion(new THREE.Quaternion());
    v.scene.add(p); p.position.copy(at); p.quaternion.copy(q);
    // thrown off to one side and a little back, so it lands on the rug in view (not at the camera)
    const dir = Math.random() < .5 ? -1 : 1, side = throwIt ? dir * (.45 + Math.random() * .15) : (Math.random() - .5) * .6;
    const up = throwIt ? 2.6 : .8, back = throwIt ? -.1 - Math.random() * .2 : .4;
    entry.body = world.box(p, Math.max(.04, s.x), Math.max(.04, s.y), Math.max(.04, s.z), { density: entry.density, friction: .7, bounce: .25, vel: { x: side, y: up, z: back } });
    entry.body.twist((Math.random() - .5) * 6, (Math.random() - .5) * 6, (Math.random() - .5) * 4);
    loose.push(entry); creature.holding = false; held = null;
  }
  function remove(entry) { if (entry.body) entry.body.remove(); entry.pivot.removeFromParent(); }

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
    const entry = { words, seed: s, sizeK: k, density, short: d.short, pivot: pivotFor(thing, HOLD_SIZE * k), body: null };
    hold(entry); poof(entry.pivot); gs.sound.sounds.pop();
    return o.said ?? `Made ${d.text}`;
  }

  // ---- the room: things carried to a spot and kept there
  const SIZES = { small: .25, medium: .45, large: .8, huge: 1.2 };
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
    for (const i of roomItems()) {
      let thing = null;
      try { thing = await gs.models.generate.make(i.words, { seed: i.seed }); } catch { /* the generator could not: leave it out this time */ }
      if (!thing) continue;
      const pivot = pivotFor(thing, i.size), e = { ...i, pivot, body: null };
      pivot.position.set(i.x, i.y + pivot.userData.size.y / 2, i.z); pivot.rotation.set(0, i.ry || 0, 0);
      v.scene.add(pivot); settle(e); placed.push(e);
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
    if (sx > .3 && sz < -.85) sz = -.85;   // (not under the bench)
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
      if (away) { poof(entry.pivot, '#ffffff'); remove(entry); placed = placed.filter(e => e !== entry); forgetItem(entry.id); gs.sound.sounds.pop(); return `Took ${name} out of the room.`; }
      if (held) release(held, false);
      const [sx, sz] = standFor(entry.x, entry.z, entry.r || .15);
      await walkTo(sx, sz); await pause(.15, Math.atan2(entry.x - sx, entry.z - sz));
      creature.reach(entry.pivot.position);
      entry.body?.remove?.(); entry.body = null;
      placed = placed.filter(e => e !== entry); forgetItem(entry.id);
      creature.hold.updateMatrixWorld(true);
      const hp = creature.hold.localToWorld(new THREE.Vector3(0, entry.pivot.userData.size.y * .3, 0));
      await glide(entry.pivot, hp, .4, Math.min(entry.pivot.scale.x, 1));
      creature.reach(null);
      const e2 = { words: entry.words, seed: entry.seed, sizeK: entry.sizeK, density: entry.density ?? 300, short: entry.short, pivot: entry.pivot, body: null };
      e2.pivot.scale.setScalar(1); hold(e2); entry = e2;
      if (toHands) { await goHome(); return `Fetched ${name} back into your hands.`; }
    } else if (away) { poof(entry.pivot, '#ffffff'); remove(entry); held = null; creature.holding = false; return `Made ${name} vanish.`; }
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
    const pivot = entry.pivot; held = null; creature.holding = false;
    toWorld(pivot);
    const goal = new THREE.Vector3(p.x, p.y + entry.pivot.userData.size.y * k / 2, p.z);
    const q0 = pivot.quaternion.clone(), q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0));
    await glide(pivot, goal, .45, k, e => pivot.quaternion.slerpQuaternions(q0, q1, e));   // (turned upright as it goes)
    pivot.quaternion.copy(q1);
    creature.reach(null); gs.sound.sounds.pop(); fx.sparks({ x: p.x, y: p.y + .02, z: p.z }, { color: '#ffe2b0', count: 14, power: .4, light: false });
    const item = { id: entry.id || newId(), words: entry.words, seed: entry.seed, sizeK: entry.sizeK, density: entry.density, size, spot, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), ry: +ry.toFixed(3), r: +r.toFixed(3), short: entry.short };
    const e = { ...item, pivot, body: null }; settle(e); placed.push(e); keepItem(item);
    await pause(.25, face); await goHome(); creature.gesture('nod');
    return `Carried ${name} over and put it ${S.about}${near ? `, next to ${near.short || near.words}` : ''}, at ${Math.round(size * 100)} cm. It stays in the room, and is remembered next time.`;
  }

  return {
    get view() { return v; },
    /** The room's light (light.js). */
    get light() { return light; },
    /** The day outside and its weather (daylight.js). */
    get daylight() { return daylight; },
    get creature() { return creature; },
    get held() { return held; },
    /** How many props there are, held or on the floor. */
    get props() { return loose.length + (held ? 1 : 0); },
    /** What is in its hands and on the floor, in a line for Claude. */
    scene() {
      const floor = loose.map(e => e.short).slice(-6);
      if (dice?.onFloor) floor.push(dice.onFloor);
      const out = daylight?.line();
      return `In your hands: ${held ? held.short : 'nothing'}.${floor.length ? ` On the floor: ${floor.join(', ')}.` : ''}${roomLine(placed)}${out ? ` Outside: ${out}.` : ''}`;
    },
    reset() {
      if (!v) setup();
      if (!restored) { restored = true; restoreRoom(); }
      for (const e of loose) remove(e); loose = []; if (held) remove(held); held = null; creature.holding = false;
      fx.clear(); embers = makeEmbers(); creature.mood('calm');
      dice ||= makeDice({ THREE, scene: v.scene, physics: world, creature, sparks: stage.sparks }); dice.clear();
      if (game) { game.stop(); game = null; }
    },
    resize(w, h) { W = w; H = h; },
    update(dt) {
      t += dt;
      // a tall screen sees as wide as a square one would, so the creature never crops at the sides
      const a = W / H; v.cam.fov = a < 1 ? 2 * Math.atan(Math.tan(21 * Math.PI / 180) / a) * 180 / Math.PI : 36;
      v.cam.aspect = a; v.cam.updateProjectionMatrix();
      // the camera eases to the game's seat and back
      const goal = game?.camera || HOME, ck = 1 - Math.exp(-dt * 3);
      for (const k of ['pos', 'look']) for (let i = 0; i < 3; i++) camAt[k][i] += (goal[k][i] - camAt[k][i]) * ck;
      v.cam.position.set(...camAt.pos); v.cam.lookAt(...camAt.look);
      game?.update(dt);
      if (acts.length) { if (acts[0](dt)) acts.shift(); body.place(creature.root.position.x, .33, creature.root.position.z); }
      creature.update(dt, v.cam);
      daylight.update(dt); sleepy.update(dt);
      light.update(dt, t);
      creature.coreAt(at);
      const st = creature.state; embers.at({ x: at.x, y: at.y, z: at.z + .03 }); embers.rate = st.thinking ? 14 : st.listening ? 6 : st.speaking ? 4 : 2; embers.on = true;
      // a new prop pops into its hands
      for (const p of pops) { p.t += dt; const k = Math.min(1, p.t / .28), e = 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2); p.o.scale.setScalar(Math.max(.01, e)); }
      pops = pops.filter(p => p.t < .28);
      if (held) { held.pivot.rotation.y += dt * .5; held.pivot.position.y = held.pivot.userData.size.y * .3 + Math.sin(t * 2.4) * .01; }
      world.step(dt);
      dice?.update(dt);
      for (const e of loose) if (e.pivot.position.y < -4) remove(e);
      loose = loose.filter(e => e.pivot.position.y >= -4);
      while (loose.length > 14) remove(loose.shift());
      fx.update(dt); motes.update(dt);
    },
    draw(c) { v.render(c, W, H); },
    /** What a tap at (x, y) in CSS pixels hit: 'game' (the game used it), 'creature', 'prop' or null. */
    tap(x, y) {
      ndc.set(x / W * 2 - 1, -(y / H) * 2 + 1); ray.setFromCamera(ndc, v.cam);
      if (game?.tap(ray)) return 'game';
      if (held && ray.intersectObject(held.pivot, true).length) return 'prop';
      if (ray.intersectObject(creature.root, true).length) return 'creature';
      return null;
    },

    // ---- games
    /** The game being played, or null. */
    get game() { return game; },
    /** Who hears what a game says happened (the brain). */
    set onNews(fn) { onNews = fn; },
    /** Starts a game by name ('chess'), or a fresh round of the one on. Resolves a sentence for Claude. */
    async play(name, o = {}) {
      const def = GAMES[name];
      if (!def) return `There is no game called "${name}". Games here: ${Object.keys(GAMES).join(', ')}.`;
      if (game && game.id !== name) { game.stop(); game = null; }
      if (held) release(held, false);   // (hands free to play)
      game = games[name] ||= def.make(stage);
      creature.gesture('tada'); creature.mood('excited');
      try { return await game.start(o); } catch (e) { game.stop(); game = null; return `The game could not start (${String(e?.message || e).slice(0, 80)}).`; }
    },
    /** Puts the game away. */
    async stopGame() {
      if (!game) return 'No game was being played.';
      const t = game.title; game.stop(); game = null; creature.mood('calm');
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
      const old = held; held = null; poof(old.pivot, '#9fd8ff'); remove(old);
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
      for (const e of [...loose, ...(held ? [held] : []), ...(o.room ? placed : [])]) { poof(e.pivot, '#ffffff'); remove(e); }
      loose = []; held = null; creature.holding = false; gs.sound.sounds.pop();
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
    /** Rolls dice ("2d6", "d20"): real ones thrown onto the rug where it can. Resolves a sentence for Claude. */
    roll: text => dice.roll(text),
    /** The things kept in the room, as saved: [{ id, words, spot, x, y, z, ... }]. */
    get room() { return placed.map(({ pivot, body, ...i }) => i); },
    /** True while it is walking about the room with something. */
    get walking() { return acts.length > 0; },
    /** Puts something in the room ({ item, spot, near, size }), carrying it there itself. Resolves a sentence. */
    place(input) { const job = carrying.then(() => placeIt(input)); carrying = job.catch(() => {}); return job; },
    /** The colours of the room's walls, floor, rug and woodwork ({ walls, floor, rug, wood, reset }), kept for next time. */
    async recolourRoom(input) {
      const r = tidyRoomColours(input, THREE);
      if (r.error) return { text: `Not changed: ${r.error}.`, error: true };
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
  };
}
