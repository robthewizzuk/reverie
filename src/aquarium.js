// Reverie's mini desk aquarium: a sleek little glass tank on the desk with sand, swaying kelp, rising bubbles,
// optional tiny decor (castle, pirate ship, coral, treasure), and up to 5 autonomous swimming friends (goldfish,
// clownfish, betta, neon tetra, seahorse, glowing jellyfish, pufferfish). Tap the glass to make them dart (or add
// a surprise fish if empty); ask Reverie to add fish, feed them, or change the decor.
import gs from '../engine/src/gamescroll.js';
import { makeAquariumState, SPECIES, SPECIES_NAMES } from './aquarium-state.js';
import { DESK, onBoard } from './room.js';
import { colourOf } from './looks.js';
import { FUN } from './mood.js';

Object.assign(FUN, { aquarium: FUN.aquarium || [.035, .55] });

// tank dimensions (metres), sitting on the left-middle of the desk, clear of the lamp at x = 1.3
const TANK = { w: .32, h: .21, d: .18 };
const TANK_X = .52;

export function makeAquarium({ world, onNews = () => {} }) {
  const { THREE, pbr, rbox } = gs.hd;
  const scene = world.view.scene;
  const state = makeAquariumState();
  const root = new THREE.Group(); root.name = 'aquarium';
  const [tx, ty, tz] = onBoard(DESK, TANK_X);
  root.position.set(tx, ty, tz);
  scene.add(root);

  const fx = new gs.fx3d.Particles3D(scene);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

  // ---- tank structure: base, sand bed, water block, glass shell, rim
  const base = new THREE.Mesh(rbox(TANK.w + .016, .016, TANK.d + .016, .005), pbr('#d8cab8', { rough: .5 }));
  base.position.y = .008; base.castShadow = true; base.receiveShadow = true; root.add(base);

  const sand = new THREE.Mesh(rbox(TANK.w - .014, .022, TANK.d - .014, .006), pbr('#e2cca4', { rough: .95 }));
  sand.position.y = .024; sand.receiveShadow = true; root.add(sand);

  const waterMat = new THREE.MeshPhysicalMaterial({ color: '#8ad8eb', transparent: true, opacity: .22, roughness: .12, transmission: .35, depthWrite: false });
  const water = new THREE.Mesh(new THREE.BoxGeometry(TANK.w - .012, TANK.h - .042, TANK.d - .012), waterMat);
  water.position.y = .028 + (TANK.h - .042) / 2; root.add(water);

  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#eefaff', transparent: true, opacity: .16, roughness: .06, metalness: .05, clearcoat: 1, depthWrite: false });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(TANK.w, TANK.h, TANK.d), glassMat);
  glass.position.y = .016 + TANK.h / 2; root.add(glass);

  // subtle top rim
  const rimMat = pbr('#ece6dd', { rough: .45 });
  const topY = .016 + TANK.h;
  for (const [w, d, x, z] of [
    [TANK.w + .008, .008, 0, TANK.d / 2], [TANK.w + .008, .008, 0, -TANK.d / 2],
    [.008, TANK.d, TANK.w / 2, 0], [.008, TANK.d, -TANK.w / 2, 0],
  ]) {
    const m = new THREE.Mesh(rbox(w, .009, d, .002), rimMat); m.position.set(x, topY, z); root.add(m);
  }

  // swaying kelp fronds (always a couple in the back corner)
  const kelpGroup = new THREE.Group(); root.add(kelpGroup);
  const kelpMat = pbr('#3f8f59', { rough: .6 });
  const kelps = [[-.11, -.045, .11], [-.085, -.055, .085], [.1, -.05, .095]].map(([x, z, h], i) => {
    const g = new THREE.Group(); g.position.set(x, .034, z);
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(.003, .007, h, 6), kelpMat);
    blade.position.y = h / 2; g.add(blade); kelpGroup.add(g);
    return { g, phase: i * 1.7 };
  });

  // decor group (rebuilt when state.decor changes)
  const decorGroup = new THREE.Group(); root.add(decorGroup);
  function rebuildDecor() {
    decorGroup.clear();
    const d = state.decor;
    if (d === 'none' || d === 'plants') {
      if (d === 'plants') {
        for (const [x, z, h] of [[0, -.03, .08], [.04, -.04, .065]]) {
          const m = new THREE.Mesh(new THREE.ConeGeometry(.016, h, 7), pbr('#4ea867', { rough: .65 }));
          m.position.set(x, .034 + h / 2, z); decorGroup.add(m);
        }
      }
      return;
    }
    if (d === 'castle') {
      const stone = pbr('#b5a99c', { rough: .85 }), roof = pbr('#5b72b5', { rough: .6 });
      const keep = new THREE.Mesh(rbox(.052, .055, .042, .004), stone); keep.position.set(.02, .06, -.02); decorGroup.add(keep);
      for (const dx of [-.022, .022]) {
        const tw = new THREE.Mesh(new THREE.CylinderGeometry(.013, .015, .072, 10), stone); tw.position.set(.02 + dx, .068, -.02); decorGroup.add(tw);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(.016, .025, 10), roof); cap.position.set(.02 + dx, .116, -.02); decorGroup.add(cap);
      }
    } else if (d === 'pirate_ship') {
      const hull = new THREE.Mesh(rbox(.085, .028, .032, .008), pbr('#6e482b', { rough: .8 }));
      hull.position.set(.01, .046, -.01); hull.rotation.z = -.18; decorGroup.add(hull);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(.003, .0035, .07, 6), pbr('#875c38', { rough: .8 }));
      mast.position.set(.01, .082, -.01); mast.rotation.z = -.18; decorGroup.add(mast);
      const sail = new THREE.Mesh(rbox(.034, .03, .004, .001), pbr('#efe8d6', { rough: .9 }));
      sail.position.set(.015, .09, -.005); sail.rotation.z = -.18; decorGroup.add(sail);
    } else if (d === 'coral') {
      for (const [x, z, h, col, tilt] of [[-.02, -.02, .065, '#f0746c', .2], [.01, -.03, .05, '#f29e5a', -.22], [.04, -.015, .055, '#d66ea8', .15]]) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(.006, .011, h, 7), pbr(col, { rough: .75 }));
        b.position.set(x, .034 + h / 2, z); b.rotation.z = tilt; decorGroup.add(b);
      }
    } else if (d === 'treasure') {
      const box = new THREE.Mesh(rbox(.048, .028, .032, .004), pbr('#7a4d28', { rough: .7 })); box.position.set(.01, .048, -.01); decorGroup.add(box);
      const gold = new THREE.Mesh(new THREE.SphereGeometry(.016, 10, 8), pbr('#f5c542', { metal: .85, rough: .25, glow: .2 }));
      gold.scale.set(1.2, .5, .9); gold.position.set(.01, .064, -.01); decorGroup.add(gold);
    }
  }
  rebuildDecor();

  // ---- bubbles & food flakes
  const bubbleGeo = new THREE.SphereGeometry(.004, 8, 6);
  const bubbleMat = new THREE.MeshBasicMaterial({ color: '#e6f9ff', transparent: true, opacity: .65 });
  const bubbles = Array.from({ length: 8 }, (_, i) => {
    const m = new THREE.Mesh(bubbleGeo, bubbleMat);
    const b = { m, x: (Math.random() - .5) * (TANK.w - .06), y: .04 + Math.random() * (TANK.h - .06), z: (Math.random() - .5) * (TANK.d - .05), vy: .028 + Math.random() * .02, phase: i };
    m.position.set(b.x, b.y, b.z); root.add(m); return b;
  });

  const flakes = [];
  const flakeGeo = new THREE.SphereGeometry(.0035, 6, 4);
  const flakeMat = pbr('#d99b43', { rough: .8 });
  function dropFood() {
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(flakeGeo, flakeMat);
      m.position.set((Math.random() - .5) * (TANK.w - .08), topY - .015, (Math.random() - .5) * (TANK.d - .06));
      root.add(m);
      flakes.push({ m, vy: .018 + Math.random() * .012, life: 6 + Math.random() * 2 });
    }
  }

  // ---- swimming creatures
  const swimmers = new Map();
  function buildSwimmerMesh(f) {
    const spec = SPECIES[f.kind] || SPECIES.goldfish;
    const g = new THREE.Group();
    const s = .018 * (spec.size || 1);
    const bodyMat = pbr(f.colour || spec.col, { rough: .35, clear: .4, glow: spec.glow ? .65 : 0, glowCol: f.colour || spec.col });
    const eyeMat = pbr('#1a1a1f', { rough: .2 });

    if (f.kind === 'jellyfish') {
      const bell = new THREE.Mesh(new THREE.SphereGeometry(s * 1.05, 14, 10, 0, Math.PI * 2, 0, Math.PI * .62), bodyMat);
      g.add(bell);
      const tentGroup = new THREE.Group(); g.add(tentGroup);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        const tn = new THREE.Mesh(new THREE.CylinderGeometry(s * .09, s * .04, s * 1.6, 5), bodyMat);
        tn.position.set(Math.cos(a) * s * .42, -s * .85, Math.sin(a) * s * .42);
        tentGroup.add(tn);
      }
      g.userData = { bell, tentGroup };
    } else if (f.kind === 'seahorse') {
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(s * .42, s * .9, 6, 10), bodyMat);
      g.add(torso);
      const head = new THREE.Mesh(new THREE.SphereGeometry(s * .45, 10, 8), bodyMat); head.position.set(0, s * .7, s * .15); g.add(head);
      const snout = new THREE.Mesh(new THREE.CylinderGeometry(s * .12, s * .18, s * .55, 7), bodyMat); snout.rotation.x = Math.PI / 2; snout.position.set(0, s * .68, s * .58); g.add(snout);
      const tail = new THREE.Mesh(new THREE.TorusGeometry(s * .35, s * .13, 6, 12, Math.PI * 1.2), bodyMat); tail.rotation.y = Math.PI / 2; tail.position.set(0, -s * .7, -s * .1); g.add(tail);
      for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(s * .1, 6, 6), eyeMat); e.position.set(sx * s * .36, s * .76, s * .32); g.add(e); }
      g.userData = { tail };
    } else {
      // fish (goldfish, clownfish, betta, neon, puffer)
      const body = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), bodyMat);
      body.scale.set(f.kind === 'puffer' ? 1.05 : .62, f.kind === 'puffer' ? 1.0 : .82, f.kind === 'puffer' ? 1.1 : 1.35);
      g.add(body);
      if (spec.stripe) {
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(s * .68, s * .68, s * .42, 12), pbr(spec.stripe, { rough: .4 }));
        stripe.rotation.x = Math.PI / 2; g.add(stripe);
      }
      const tail = new THREE.Mesh(new THREE.ConeGeometry(s * .78, s * 1.05, 4), bodyMat);
      tail.rotation.x = Math.PI / 2; tail.scale.set(.25, 1, 1); tail.position.set(0, 0, -s * 1.45);
      g.add(tail);
      for (const sx of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(s * .14, 6, 6), eyeMat);
        e.position.set(sx * s * .42, s * .22, s * .82); g.add(e);
      }
      g.userData = { tail };
    }
    return g;
  }

  function syncSwimmers() {
    const alive = new Set(state.fish.map(f => f.id));
    for (const [id, sw] of swimmers) if (!alive.has(id)) { root.remove(sw.mesh); swimmers.delete(id); }
    for (const f of state.fish) {
      if (swimmers.has(f.id)) continue;
      const mesh = buildSwimmerMesh(f);
      const sw = {
        f, mesh,
        x: (Math.random() - .5) * (TANK.w - .09),
        y: .07 + Math.random() * (TANK.h - .09),
        z: (Math.random() - .5) * (TANK.d - .07),
        tx: 0, ty: .12, tz: 0,
        speed: f.kind === 'jellyfish' ? .03 : .055 + Math.random() * .025,
        dart: 0, phase: Math.random() * 6.28, pickAt: 0,
      };
      mesh.position.set(sw.x, sw.y, sw.z);
      root.add(mesh);
      swimmers.set(f.id, sw);
    }
  }
  syncSwimmers();

  let t = 0;
  const maxX = TANK.w / 2 - .042, maxZ = TANK.d / 2 - .036, minY = .06, maxY = topY - .032;

  function update(dt) {
    t += dt;
    // sway kelp
    for (const k of kelps) { k.g.rotation.z = Math.sin(t * 1.4 + k.phase) * .12; k.g.rotation.x = Math.cos(t * 1.1 + k.phase) * .08; }
    // rise bubbles
    for (const b of bubbles) {
      b.y += b.vy * dt;
      b.x += Math.sin(t * 3 + b.phase) * .006 * dt;
      if (b.y > topY - .016) { b.y = .042; b.x = (Math.random() - .5) * (TANK.w - .08); b.z = (Math.random() - .5) * (TANK.d - .06); }
      b.m.position.set(b.x, b.y, b.z);
    }
    // falling food flakes
    for (let i = flakes.length - 1; i >= 0; i--) {
      const fl = flakes[i]; fl.life -= dt; fl.m.position.y = Math.max(.036, fl.m.position.y - fl.vy * dt);
      if (fl.life <= 0) { root.remove(fl.m); flakes.splice(i, 1); }
    }
    const hungry = state.isHungry();
    for (const sw of swimmers.values()) {
      sw.dart = Math.max(0, sw.dart - dt);
      sw.pickAt -= dt;
      if (sw.pickAt <= 0 || Math.hypot(sw.tx - sw.x, sw.ty - sw.y, sw.tz - sw.z) < .018) {
        sw.pickAt = 1.6 + Math.random() * 2.4;
        if (flakes.length) {
          const fl = flakes[0].m.position; sw.tx = fl.x; sw.ty = fl.y; sw.tz = fl.z;
        } else {
          sw.tx = (Math.random() - .5) * maxX * 2;
          sw.ty = hungry ? maxY - .015 - Math.random() * .025 : minY + Math.random() * (maxY - minY);
          sw.tz = (Math.random() - .5) * maxZ * 2;
        }
      }
      const sp = sw.speed * (sw.dart > 0 ? 3.2 : 1) * (flakes.length ? 1.6 : 1);
      const dx = sw.tx - sw.x, dy = sw.ty - sw.y, dz = sw.tz - sw.z, d = Math.hypot(dx, dy, dz) || 1;
      const step = Math.min(d, sp * dt);
      sw.x = Math.max(-maxX, Math.min(maxX, sw.x + dx / d * step));
      sw.y = Math.max(minY, Math.min(maxY, sw.y + dy / d * step));
      sw.z = Math.max(-maxZ, Math.min(maxZ, sw.z + dz / d * step));
      sw.mesh.position.set(sw.x, sw.y + Math.sin(t * 2.5 + sw.phase) * .003, sw.z);
      if (sw.f.kind === 'jellyfish') {
        const pulse = 1 + Math.sin(t * 3.6 + sw.phase) * .12;
        sw.mesh.userData.bell?.scale.set(pulse, 1 / pulse, pulse);
      } else {
        const yaw = Math.atan2(dx, dz);
        let diff = yaw - sw.mesh.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        sw.mesh.rotation.y += diff * Math.min(1, dt * 6);
        if (sw.mesh.userData.tail) sw.mesh.userData.tail.rotation.y = Math.sin(t * (sw.dart > 0 ? 22 : 10) + sw.phase) * .38;
      }
    }
    fx.update(dt);
  }

  function tap(x, y, w, h) {
    ndc.set(x / w * 2 - 1, -(y / h) * 2 + 1);
    ray.setFromCamera(ndc, world.view.cam);
    if (!ray.intersectObject(root, true).length) return false;
    if (!state.fish.length) {
      const pick = SPECIES_NAMES[Math.floor(Math.random() * SPECIES_NAMES.length)];
      const r = state.add({ species: pick });
      syncSwimmers();
      gs.sound.sounds.bubble?.() || gs.sound.sounds.boing?.();
      world.mood?.fun('aquarium');
      onNews(`[aquarium] They tapped the empty desk aquarium and a surprise ${r.fish.kind} named ${r.fish.name} popped in!`, true);
      return true;
    }
    for (const sw of swimmers.values()) { sw.dart = .9; sw.pickAt = 0; }
    dropFood(); state.feed();
    gs.sound.sounds.bubble?.() || gs.sound.sounds.bell?.();
    world.mood?.fun('aquarium');
    onNews(`[aquarium] They tapped the glass of the desk aquarium: ${state.fish.map(f => f.name).join(', ')} darted excitedly and nibbled some flakes.`, false);
    return true;
  }

  async function command(input = {}) {
    const a = input.action || 'add';
    if (a === 'add') {
      const col = input.colour ? (colourOf(input.colour, THREE) || undefined) : undefined;
      const r = state.add({ species: input.species, name: input.name, colour: col });
      if (r.error) return { text: r.error, error: true };
      syncSwimmers();
      world.sparks?.({ x: tx, y: ty + TANK.h, z: tz }, r.fish.colour, 10);
      gs.sound.sounds.bell?.();
      return r.text;
    }
    if (a === 'feed') {
      const r = state.feed();
      if (r.error) return { text: r.error, error: true };
      dropFood();
      gs.sound.sounds.bell?.();
      return r.text;
    }
    if (a === 'decor') {
      const r = state.setDecor(input.decor);
      rebuildDecor();
      return r.text;
    }
    if (a === 'rename') {
      const r = state.rename({ which: input.which || input.species, name: input.name });
      return r.error ? { text: r.error, error: true } : r.text;
    }
    if (a === 'remove') {
      const r = state.remove({ which: input.which || input.name || input.species });
      if (r.error) return { text: r.error, error: true };
      syncSwimmers();
      return r.text;
    }
    return { text: 'Aquarium action must be add, feed, decor, rename or remove.', error: true };
  }

  return {
    state,
    update, tap, command,
    line: () => state.line(),
    greet: () => { const g = state.greet(); if (g) onNews(g, false); },
  };
}
