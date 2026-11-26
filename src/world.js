// The stage: a cosy workshop corner in the engine's Next Gen view, the creature in the middle of it, props made by
// the engine's 3D generator held in its hands, and a physics floor for props it throws. Built the way a Game Scroll
// game is (make, reset, update, draw), so the engine's kits load and run as they do in the app.
import gs from '../engine/src/gamescroll.js';
import { makeCreature } from './creature.js';
import { colours, tidyColours, keepColours } from './looks.js';

const CORE_LAMP = '#ff7020';     // the light its core casts, as made (moved with the glow colour)
const HOLD_SIZE = .4;            // metres: the longest side of a prop in its hands
const SIZE_WORDS = [[/\b(giant|huge|enormous)\b/, 1.8], [/\b(bigger|big|large)\b/, 1.4], [/\b(smaller|small|little)\b/, .7], [/\b(tiny|teeny)\b/, .5]];
const article = w => w.replace(/^(a|an|the|some)\s+/i, '');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

let v, sunLight, creature, fx, world, coreLamp, lampSpot, room, embers, motes;

function setup() {
  const { HDView, pbr, rbox, sun, THREE } = gs.hd, { material, prop } = gs.models;
  // parts that may still be loading go first: if one throws StillLoading, setup runs again from the top with nothing made
  const w3 = new gs.physics3d.World3D({ gravity: -9.81 });
  v = new HDView({ bg: '#2a1d16', fog: 0, env: .55, amb: .35, fov: 36 });
  v.lampLights(6);
  v.look('golden hour', { sun: false });
  sunLight = sun('#ffd9b0', 2.4, 6, [-.55, 1, .7]); sunLight.softShadows(2.5); v.scene.add(sunLight, sunLight.target); v.onTier(T => sunLight.setTier(T));
  room = new THREE.Group(); v.scene.add(room);
  const shade = o => { o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
  // floor, a round rug, two walls
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), material('planks', { colour: '#8a5c3a', repeat: [6, 6] }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; room.add(floor);
  const rug = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, .012, 64), material('fabric', { colour: '#b9583f', repeat: [3, 3] }));
  rug.position.y = .006; rug.receiveShadow = true; room.add(rug);
  const wallMat = material('brick', { colour: '#b07a5a', repeat: [4, 2] });
  const back = new THREE.Mesh(rbox(6, 3, .2, .02), wallMat); back.position.set(0, 1.5, -1.7); shade(back); room.add(back);
  const side = new THREE.Mesh(rbox(.2, 3, 5, .02), wallMat); side.position.set(-2.1, 1.5, .6); shade(side); room.add(side);
  // a workbench and a few things a maker keeps about
  const wood = material('wood', { colour: '#6e4a2e', repeat: [1, 2] });
  const top = new THREE.Mesh(rbox(1.3, .07, .55, .02), wood); top.position.set(1.15, .78, -1.25); shade(top); room.add(top);
  for (const [x, z] of [[.55, -1.05], [1.75, -1.05], [.55, -1.45], [1.75, -1.45]]) { const leg = new THREE.Mesh(rbox(.06, .76, .06, .01), wood); leg.position.set(x, .38, z); shade(leg); room.add(leg); }
  const shelf = new THREE.Mesh(rbox(1.2, .05, .28, .01), wood); shelf.position.set(-1.0, 1.45, -1.5); shade(shelf); room.add(shelf);
  const keep = (o, size, x, y, z, ry = 0) => { fitTo(o, size); standAt(o, x, y, z); o.rotation.y = ry; shade(o); room.add(o); };
  keep(prop('crate', { seed: 5 }), .45, -1.45, 0, -1.2, .4);
  keep(prop('barrel', { seed: 3 }), .55, 1.85, 0, -.6, .3);
  keep(prop('bucket', { seed: 4 }), .22, .95, .815, -1.25);
  keep(prop('lamp', { seed: 2 }), .32, 1.55, .815, -1.3);
  // the room's own light: bounce light from the brick and the floor (a warm wall tints what is next to it), reflections
  // of the room itself in anything shiny (its eyes, its glass dome, the floorboards) instead of the kit's studio, and
  // soft contact shadows on the rug under its feet and the props. Each scales itself down on a slow phone (v's tiers).
  const roomBox = { min: [-2.1, 0, -1.6], max: [2.2, 2.6, 2.2] };
  v.bounce(roomBox, { spacing: .9, bounces: 1 }); v.hemi.intensity = .22;   // (less fill light: the bounce light does that now)
  v.room(roomBox, { strength: .8 });
  v.contact({ y: .013, size: 3, darkness: 1, opacity: .45, height: .8 });
  // dust drifting in the low sun, lit as it passes through the light
  motes = new gs.fx3d.Particles3D(v.scene);
  motes.make({ x: -.2, y: 1, z: -.2 }, { loop: true, rate: 6, life: [6, 10], speed: [.01, .04], size: [.004, .008], colors: ['#ffe6c0', '#ffd09a'], radius: 1.3, gravity: -.004, glow: false, shrink: false });
  // a warm lamp over the bench
  lampSpot = { x: 1.3, y: 1.6, z: -1.1, col: '#ffc98a', i: 9, reach: 4 };   // (no flick: any flick makes a lamp stutter like a failing tube)
  creature = makeCreature(); v.scene.add(creature.root);
  creature.setColours(colours());   // (the colours it was asked for last time, kept on this device)
  coreLamp = v.flash(0, .3, .3, { keep: true, col: creature.glowed(CORE_LAMP), i: .8, reach: .9 });
  fx = new gs.fx3d.Particles3D(v.scene);
  // embers drifting up from its core: a few when idle, more while listening, a stream while thinking
  embers = makeEmbers();
  world = w3;
  world.floor(0, { friction: .8 });
  world.box(null, 6, 3, .2, { fixed: true, at: { x: 0, y: 1.5, z: -1.7 } });
  world.box(null, .2, 3, 5, { fixed: true, at: { x: -2.1, y: 1.5, z: .6 } });
  world.box(null, .48, .66, .42, { fixed: true, at: { x: 0, y: .33, z: 0 } });   // (the creature: props bounce off it, not through)
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
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), at = new THREE.Vector3();

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

  // a sentence about what the generator made of the words, for Claude to hear
  function described(words) {
    try {
      const u = gs.models.generate.understood(words);
      const swaps = (u.swaps || []).filter(s => s.guess || s.standIn || s.later).map(s => `"${s.word}" as ${s.as}`);
      const name = u.thing ? `a ${u.thing}` : `something from "${words}"`;
      return `Made ${name}${swaps.length ? ` (it read ${swaps.join(', ')})` : ''}${u.unknown?.length ? `; it did not know the words ${u.unknown.join(', ')}` : ''}.`;
    } catch { return `Made "${words}".`; }
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
    const entry = { words, seed: s, sizeK: k, density, pivot: pivotFor(thing, HOLD_SIZE * k), body: null };
    hold(entry); poof(entry.pivot); gs.sound.sounds.pop();
    return o.said ?? described(words);
  }

  return {
    get view() { return v; },
    get creature() { return creature; },
    get held() { return held; },
    reset() {
      if (!v) setup();
      for (const e of loose) remove(e); loose = []; if (held) remove(held); held = null; creature.holding = false;
      fx.clear(); embers = makeEmbers(); creature.mood('calm');
    },
    resize(w, h) { W = w; H = h; },
    update(dt) {
      t += dt;
      // a tall screen sees as wide as a square one would, so the creature never crops at the sides
      const a = W / H; v.cam.fov = a < 1 ? 2 * Math.atan(Math.tan(21 * Math.PI / 180) / a) * 180 / Math.PI : 36;
      v.cam.aspect = a; v.cam.updateProjectionMatrix();
      creature.update(dt, v.cam);
      creature.coreAt(at); coreLamp.at(at.x, at.y - .05, at.z + .12); coreLamp.i0 = .25 + creature.coreGlow * .6;
      const st = creature.state; embers.at({ x: at.x, y: at.y, z: at.z + .03 }); embers.rate = st.thinking ? 14 : st.listening ? 6 : st.speaking ? 4 : 2; embers.on = true;
      v.placeLamps([lampSpot], 0, .4, 0, t);
      sunLight.follow(0, 0, 0);
      // a new prop pops into its hands
      for (const p of pops) { p.t += dt; const k = Math.min(1, p.t / .28), e = 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2); p.o.scale.setScalar(Math.max(.01, e)); }
      pops = pops.filter(p => p.t < .28);
      if (held) { held.pivot.rotation.y += dt * .5; held.pivot.position.y = held.pivot.userData.size.y * .3 + Math.sin(t * 2.4) * .01; }
      world.step(dt);
      for (const e of loose) if (e.pivot.position.y < -4) remove(e);
      loose = loose.filter(e => e.pivot.position.y >= -4);
      while (loose.length > 14) remove(loose.shift());
      fx.update(dt); motes.update(dt);
    },
    draw(c) { v.render(c, W, H); },
    /** What a tap at (x, y) in CSS pixels hit: 'creature', 'prop' or null. */
    tap(x, y) {
      ndc.set(x / W * 2 - 1, -(y / H) * 2 + 1); ray.setFromCamera(ndc, v.cam);
      if (held && ray.intersectObject(held.pivot, true).length) return 'prop';
      if (ray.intersectObject(creature.root, true).length) return 'creature';
      return null;
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
      const r = await makeProp(prompt, { seed: old.seed, sizeK: clamp(k, .3, 2.2) });
      return r.startsWith('Made') ? r.replace(/^Made/, 'Changed it into') : r;
    },
    async toss() {
      if (!held) return 'Nothing is being held to throw.';
      creature.gesture('point'); const w = held.words; gs.sound.sounds.whoosh();
      release(held, true); return `Threw ${w} onto the floor.`;
    },
    async clear() {
      const n = loose.length + (held ? 1 : 0);
      for (const e of [...loose, ...(held ? [held] : [])]) { poof(e.pivot, '#ffffff'); remove(e); }
      loose = []; held = null; creature.holding = false; gs.sound.sounds.pop();
      return n ? `Cleared ${n} prop${n > 1 ? 's' : ''}.` : 'There was nothing to clear.';
    },
    /** Its body and glow colours ({ body, glow, reset }), kept for next time. */
    async recolour(input) {
      const r = tidyColours(input, THREE);
      if (r.error) return { text: `Not changed: ${r.error}.`, error: true };
      creature.setColours(r.colours); keepColours(r.colours);
      coreLamp.s.col = creature.glowed(CORE_LAMP);
      embers.remove(); embers = makeEmbers();
      creature.gesture('tada'); poof(creature.core, creature.glowed('#ffd27a')); gs.sound.sounds.pop();
      return { text: `Your body is now ${r.colours.body} and your glow ${r.colours.glow}. It is remembered next time.` };
    },
    async act(gesture, mood) {
      if (mood) creature.mood(mood); if (gesture) creature.gesture(gesture);
      return 'Done.';
    },
  };
}
