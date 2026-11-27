// A few more toys from the engine, all on the device:
//  - smash and slice: a prop breaks into real pieces (gs.destruction, Voronoi fracture) that tumble across the rug in
//    the stage's physics, or is cut clean in two; the bits fade away after a while (Rubble) so phones stay quick
//  - little shows: fireworks under the ceiling, confetti, magic sparkles, bubbles, an indoor snow flurry, hearts
//    (gs.fx3d particles, gs.sound)
//  - the phone itself (gs.device): shake it and Reverie gets dizzy, everything on the floor jumps and Claude hears about
//    it; tilt it and things on the floor roll that way. A bonus only: nothing here needs a sensor
import gs from '../engine/src/gamescroll.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const MAX_PIECES = 40;   // (all the pieces of one smash: about 10 to 20 a mesh is the engine's sweet spot on phones)
const MAX_MESHES = 14;   // (the biggest parts of a prop break; tiny ones go up in a puff)
const MAX_TRIS = 6000;   // (a part finer than this goes up in the puff too: breaking one is slow, and can run out of memory)
const MOST = 60;         // (a part can come apart into more bits than asked for: past this many in all, the rest go in the puff)

/**
 * Breaks a prop (its pivot, a Group in the scene or in Reverie's hands) apart: how 'smash' into pieces, or 'slice' in
 * two halves. world: the stage's World3D; rubble: a gs.destruction Rubble; density: the prop's (kg per cubic metre).
 * Returns { pieces, at } or null when nothing in it could break.
 */
export function breakApart(pivot, { how = 'smash', world, rubble, scene, density = 300 }) {
  const { THREE } = gs.hd, { shatter, slice } = gs.destruction;
  // into the room where it is, so its pieces stay put when it leaves Reverie's hands
  pivot.updateMatrixWorld(true);
  const at = new THREE.Box3().setFromObject(pivot).getCenter(new THREE.Vector3());
  const meshes = [];
  const tris = g => (g.index ? g.index.count : g.attributes.position.count) / 3;
  pivot.traverse(m => { if (m.isMesh && !m.isInstancedMesh && !m.isSkinnedMesh && m.geometry?.attributes?.position && m.visible && tris(m.geometry) <= MAX_TRIS) meshes.push(m); });
  if (!meshes.length) return null;
  // the biggest parts break, by how much room each takes; the rest just vanish with the puff
  const size = m => { const b = new THREE.Box3().setFromObject(m), s = b.getSize(new THREE.Vector3()); return s.x * s.y * s.z + 1e-6; };
  const sized = meshes.map(m => [m, size(m)]).sort((a, b) => b[1] - a[1]), big = sized.slice(0, MAX_MESHES), all = big.reduce((n, [, s]) => n + s, 0);
  // (a mesh breaks on its own: it must hang from the scene, as a piece does, so move each out of the pivot first)
  pivot.parent?.updateMatrixWorld(true);
  const out = [];
  for (const [m, s] of big) {
    if (out.length >= MOST) break;
    m.updateMatrixWorld(true);
    const keep = m.matrixWorld.clone();
    scene.add(m); keep.decompose(m.position, m.quaternion, m.scale); m.updateMatrixWorld(true);
    try {
      if (how === 'slice') out.push(...slice(m, at, { x: 1, y: 0, z: 0 }, { world, apart: .9, density }));
      else out.push(...shatter(m, { pieces: Math.max(2, Math.min(16, Math.round(MAX_PIECES * s / all))), at: { x: at.x, y: at.y - .05, z: at.z + .05 }, world, push: 1.6, density }));
    } catch (e) { console.warn('[reverie] could not break a part', e); m.removeFromParent(); }
  }
  pivot.removeFromParent();
  // (the smallest bits past the most go)
  if (out.length > MOST) { out.sort((a, b) => size(b) - size(a)); for (const p of out.splice(MOST)) { p.body?.remove(); p.removeFromParent(); p.geometry?.dispose(); } }
  for (const p of out) { p.castShadow = true; p.receiveShadow = true; }
  rubble.add(out);
  return { pieces: out.length, at };
}

/** Little shows with particles and sound: play(kind) for 'fireworks', 'confetti', 'magic', 'bubbles', 'snow', 'hearts'. */
export function makeShows({ fx, creature, floaties }) {
  const { THREE } = gs.hd, s = gs.sound.sounds;
  const COLOURS = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#ff9ad5'];
  let jobs = [];   // [{ t, step(dt, t) -> true when done }]
  const after = (wait, fn) => jobs.push({ t: -wait, step: (dt, t) => (t >= 0 ? (fn(), true) : false) });
  const coreAt = () => creature.coreAt(new THREE.Vector3());
  // a stream that keeps going for a while, then stops (its last bits fade out by themselves)
  const forAWhile = (e, secs) => after(secs, () => { e.on = false; after(3, () => e.remove()); });

  /** One rocket: a fizzing trail climbs from beside Reverie, then bursts under the ceiling with a flash. */
  function rocket(x0, z0, colour, delay) {
    after(delay, () => {
      const x1 = x0 * .8 + rnd(-.08, .08), y1 = rnd(.95, 1.12), z1 = z0 - rnd(.05, .15);
      const trail = fx.make({ x: x0, y: .1, z: z0 }, { loop: true, rate: 70, life: [.18, .35], speed: [.02, .08], size: [.006, .012], colors: ['#fff4c8', colour], radius: .01, gravity: -.4 });
      s.whistle?.(); const go = .55;
      jobs.push({ t: 0, step(dt, t) {
        const k = Math.min(1, t / go), e = 1 - (1 - k) * (1 - k);
        trail.at({ x: x0 + (x1 - x0) * e, y: .1 + (y1 - .1) * e, z: z0 + (z1 - z0) * e });
        if (k < 1) return false;
        trail.on = false; after(1, () => trail.remove());
        // (a ball of small coloured stars that slows and droops as it fades, a few white ones in the middle, and a
        // flash of light: the engine's sparks are sized for a game's world, too big and fast for a corner of a room)
        const p = { x: x1, y: y1, z: z1 };
        fx.make(p, { burst: 90, duration: .05, life: [.9, 1.5], speed: [.3, .55], size: [.016, .03], colors: [colour, colour], shape: 'sphere', radius: .01, gravity: -.35 });
        fx.make(p, { burst: 16, duration: .05, life: [.3, .6], speed: [.08, .2], size: [.02, .035], colors: ['#ffffff', colour], shape: 'sphere', radius: .01 });
        fx.sparks(p, { color: colour, count: 4, power: .05, light: true });
        s.boom?.(); after(.25, () => s.crackle?.());
        return true;
      } });
    });
  }

  const SHOWS = {
    fireworks() {
      creature.gesture('tada'); creature.mood('excited');
      for (let i = 0; i < 6; i++) rocket((i % 2 ? 1 : -1) * rnd(.15, .45), rnd(.1, .4), COLOURS[i % COLOURS.length], i * .45 + rnd(0, .15));
      return 'Six little fireworks went up from the rug and burst under the ceiling.';
    },
    confetti() {
      creature.gesture('tada'); creature.mood('excited');
      COLOURS.forEach((color, i) => after(i * .12, () => fx.sparks({ x: Math.cos(i * 1.05) * .35, y: .8 + (i % 2) * .12, z: .2 + Math.sin(i * 1.05) * .2 }, { color, count: 24, power: 1.1, light: false })));
      s.tada?.() ?? s.coin?.();
      return 'Confetti burst all round you.';
    },
    magic() {
      creature.gesture('tada'); creature.mood('happy');
      const e = fx.magic(coreAt(), { color: '#ffe9a8', end: '#c77dff' }); forAWhile(e, 3.5);
      s.teleport?.();
      return 'Magic sparkles twinkled round you.';
    },
    bubbles() {
      creature.gesture('bounce'); creature.mood('happy');
      const at = coreAt(); at.z += .25;
      const e = fx.make(at, { loop: true, rate: 9, life: [3, 5], speed: [.12, .28], size: [.025, .06], colors: ['#e6f7ff', '#f6e6ff'], radius: .08, gravity: .05, glow: false, shrink: false, fade: true, shape: 'cone', up: true, angle: .9 });
      forAWhile(e, 6);
      for (let i = 0; i < 6; i++) after(.4 + i * .7, () => s.bubble?.());
      return 'Bubbles floated up from your hands.';
    },
    snow() {
      creature.mood('surprised');
      const e = fx.snow({ x: 0, y: 1.7, z: .3 }, { area: 2.4, rate: 50 }); forAWhile(e, 9);
      return 'It snowed indoors for a little while, softly, all over the room.';
    },
    hearts() {
      creature.gesture('bounce'); creature.mood('happy');
      const at = coreAt();
      for (let i = 0; i < 3; i++) after(i * .35, () => floaties.burst({ x: at.x, y: at.y + .3, z: at.z }, { n: 5 }));
      s.heart?.();
      return 'Hearts floated up over your head.';
    },
  };
  return {
    KINDS: Object.keys(SHOWS),
    play(kind) {
      const f = SHOWS[String(kind || '').toLowerCase()];
      return f ? f() : `Not done: the shows are ${Object.keys(SHOWS).join(', ')}.`;
    },
    update(dt) { for (const j of jobs) { j.t += dt; j.done = j.step(dt, j.t); } jobs = jobs.filter(j => !j.done); },
    clear() { jobs = []; },
  };
}

/**
 * The phone in their hands (gs.device): a shake makes Reverie dizzy and bounces everything on the floor; tilting the
 * phone rolls things on the floor that way (gravity leans with the tilt as it changes, and comes back upright when
 * the phone is held still, so a phone held at any angle never keeps things sliding).
 * world: the stage's World3D; floor(): the bodies on the floor; onShaken(strength): once a shaking is over.
 */
export function makeShaker({ world, creature, floaties, floor, pet, onShaken }) {
  const d = gs.device;
  d.want('motion');   // (iPhone asks for the motion sensors on the first tap; elsewhere they just run)
  let shook = 0, quiet = 0, slow = null, g = { x: 0, z: 0 }, last = { x: 0, z: 0 };
  const DOWN = world.gravity?.y ?? -9.81;
  d.onShake(strength => {
    shook += strength; quiet = 0;
    creature.gesture('dizzy'); creature.mood('surprised');
    // everything loose on the floor jumps (more for a harder shake)
    const k = Math.min(2.2, strength / 30);
    for (const b of floor()) { try { b.push(rnd(-.5, .5) * k, rnd(1, 1.8) * k, rnd(-.5, .5) * k); b.twist(rnd(-4, 4), rnd(-4, 4), rnd(-4, 4)); } catch { /* gone */ } }
    if (Math.random() < .5) pet?.()?.command?.({ action: 'trick', trick: 'jump' })?.catch?.(() => {});
    gs.sound.sounds.boing?.();
  });
  return {
    update(dt) {
      // dizzy stars round its head while it is being shaken, and the news once it stops
      if (shook) {
        quiet += dt;
        if (quiet < .9 && Math.random() < dt * 5) { const at = creature.coreAt(new gs.hd.THREE.Vector3()); floaties.burst({ x: at.x, y: at.y + .42, z: at.z }, { kind: 'star', n: 1, spread: .3, rise: .12 }); }
        if (quiet > 1.1) { const s = shook; shook = 0; if (s > 60) onShaken?.(s); }
      }
      // tilt: gravity leans by how much the tilt has changed of late (a slow average is "upright")
      const t = d.tilt(); if (!t) return;
      slow ||= { x: t.x, y: t.y };
      const a = 1 - Math.exp(-dt / 2.5); slow.x += (t.x - slow.x) * a; slow.y += (t.y - slow.y) * a;
      const dead = v => Math.abs(v) < .08 ? 0 : v - Math.sign(v) * .08;
      const want = { x: dead(t.x - slow.x) * 9, z: dead(t.y - slow.y) * 9 }, e = 1 - Math.exp(-dt * 8);
      g.x += (want.x - g.x) * e; g.z += (want.z - g.z) * e;
      if (Math.abs(g.x - last.x) + Math.abs(g.z - last.z) < .05) return;
      last = { x: g.x, z: g.z };
      try {
        world.world.gravity = { x: g.x, y: DOWN, z: g.z };
        if (Math.abs(g.x) + Math.abs(g.z) > .3) for (const b of floor()) b.body?.wakeUp?.();
      } catch { /* the world went */ }
    },
  };
}
