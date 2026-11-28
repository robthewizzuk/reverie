// Reverie's trophy shelf: a slim wall shelf, three tiers, with a little metal trophy for each badge earned
// (achievements.js), all made in code. The shape says the family (a cup for games, a star for making, a heart for
// friends, a house for the room, a leaf, a book, a note or a key for the features that come later), the metal says the
// tier (bronze, silver, gold). A new one pops up in front of Reverie, spins in a shower of sparks, then flies to its
// place on the shelf. Tap a trophy to hear what it was for.
import { FAMILIES } from './achievements.js';
import { backZ } from './shell.js';

// where the shelf hangs: on the back wall, above the right end of the desk. The room is round (shell.js) and its wall
// leans in as it rises into the dome, so each tier sits out from the wall at its own depth (zs), clear of the curve at
// both ends
export const SHELF = { x: 1.09, ys: [1.06, 1.24, 1.42], width: .78, depth: .19, slots: 6 };
SHELF.zs = SHELF.ys.map(y => Math.max(backZ(SHELF.x - SHELF.width / 2, y + .03), backZ(SHELF.x + SHELF.width / 2, y + .03)) + SHELF.depth / 2 + .015);
SHELF.z = SHELF.zs[0];
const METAL = { bronze: '#c98a55', silver: '#d9dde2', gold: '#f2c14e' };
const SIZE = .14;          // metres: a trophy's height, plinth and all
const SHOW_S = 2.2, FLY_S = .9;

/**
 * makeTrophies({ gs, scene, creature, sparks, wood }): show(earned) puts the trophies earned so far on the shelf at
 * once; award(badge, earned) brings a new one in; update(dt); hit(ray) gives the badge of a trophy tapped, or null.
 */
export function makeTrophies({ gs, scene, creature, sparks = () => {}, wood = '#c69c72' }) {
  const { THREE, pbr, rbox } = gs.hd;
  const root = new THREE.Group(); root.name = 'trophy shelf'; scene.add(root);
  const shade = o => { o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
  let woodMat = pbr(wood, { rough: .55 });
  const shelves = [];
  for (const [i, y] of SHELF.ys.entries()) {
    const s = new THREE.Mesh(rbox(SHELF.width, .03, SHELF.depth, .01), woodMat);
    s.position.set(SHELF.x, y, SHELF.zs[i]); root.add(shade(s)); shelves.push(s);
  }
  // two slim brackets up the wall holding the three shelves
  const pale = pbr('#ece6dd', { rough: .5, metal: .2 });
  for (const dx of [-.5, .5]) {
    const rail = new THREE.Mesh(rbox(.018, SHELF.ys.at(-1) - SHELF.ys[0] + .03, .018, .006), pale);
    rail.position.set(SHELF.x + dx * (SHELF.width - .08), (SHELF.ys[0] + SHELF.ys.at(-1)) / 2, Math.max(...SHELF.zs) - SHELF.depth / 2 + .012); root.add(shade(rail));
  }

  // ---- the trophies, built once a kind and copied
  const mats = {}, made = {};
  const metal = tier => mats[tier] ||= pbr(METAL[tier] || METAL.bronze, { metal: .9, rough: tier === 'gold' ? .22 : .28, clear: .3, glow: .12 })   // (a faint glow of its own, so it reads in a dim room);
  const plinthMat = pbr('#3b302b', { rough: .45, clear: .2 });
  const v2 = (x, y) => new THREE.Vector2(x, y);
  const extrude = (shape, depth = .016) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: .004, bevelSize: .004, bevelSegments: 3, curveSegments: 18 });
    g.center(); return g;
  };
  const SHAPES = {
    cup() {
      const prof = [[0, 0], [.028, 0], [.03, .006], [.012, .012], [.008, .03], [.012, .042], [.034, .056], [.038, .08], [.036, .082], [.031, .062], [0, .05]].map(([x, y]) => v2(x, y));
      const g = new THREE.Group(), cup = new THREE.Mesh(new THREE.LatheGeometry(prof, 40)); g.add(cup);
      for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(.013, .0035, 10, 20, Math.PI)); h.position.set(s * .036, .066, 0); h.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2; g.add(h); }
      return g;
    },
    star() {
      const s = new THREE.Shape();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? .016 : .038, a = Math.PI / 2 + i * Math.PI / 5; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      return lift(new THREE.Mesh(extrude(s)), .042);
    },
    heart() {
      const s = new THREE.Shape(); s.moveTo(0, -.03);
      s.bezierCurveTo(-.012, -.018, -.04, -.004, -.034, .014); s.bezierCurveTo(-.028, .032, -.006, .032, 0, .016);
      s.bezierCurveTo(.006, .032, .028, .032, .034, .014); s.bezierCurveTo(.04, -.004, .012, -.018, 0, -.03);
      return lift(new THREE.Mesh(extrude(s, .02)), .04);
    },
    house() {
      const s = new THREE.Shape([v2(-.026, -.024), v2(.026, -.024), v2(.026, .006), v2(0, .03), v2(-.026, .006)]);
      return lift(new THREE.Mesh(extrude(s, .03)), .034);
    },
    leaf() {
      const s = new THREE.Shape(); s.moveTo(0, -.034); s.quadraticCurveTo(.034, -.004, 0, .036); s.quadraticCurveTo(-.034, -.004, 0, -.034);
      const m = lift(new THREE.Mesh(extrude(s, .008)), .042); m.children[0].rotation.z = -.35; return m;
    },
    book() {
      const g = new THREE.Group();
      for (const s of [-1, 1]) { const p = new THREE.Mesh(rbox(.032, .044, .006, .002)); p.position.set(s * .015, .03, 0); p.rotation.y = s * .45; g.add(p); }
      return g;
    },
    note() {
      const g = new THREE.Group();
      const head = new THREE.Mesh(new THREE.SphereGeometry(.014, 20, 14)); head.scale.set(1.25, .85, .8); head.rotation.z = .4; head.position.set(-.008, .02, 0); g.add(head);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(.0028, .0028, .056, 10)); stem.position.set(.007, .046, 0); g.add(stem);
      const flag = new THREE.Mesh(rbox(.018, .006, .006, .002)); flag.position.set(.014, .07, 0); flag.rotation.z = -.6; g.add(flag);
      return g;
    },
    key() {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.012, .004, 10, 24)); ring.position.set(0, .068, 0); g.add(ring);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.0035, .0035, .05, 10)); shaft.position.set(0, .03, 0); g.add(shaft);
      for (const y of [.01, .02]) { const t = new THREE.Mesh(rbox(.012, .005, .005, .001)); t.position.set(.007, y, 0); g.add(t); }
      return g;
    },
  };
  function lift(m, y) { const g = new THREE.Group(); m.position.y = y; g.add(m); return g; }

  /** A trophy for a badge: its shape in its metal, on a little dark plinth, about SIZE tall, its base at y = 0. */
  function build(badge) {
    const shape = FAMILIES[badge.family]?.shape || 'cup', key = shape + ':' + badge.tier;
    if (!made[key]) {
      const g = new THREE.Group(), top = SHAPES[shape](), plinth = new THREE.Mesh(rbox(.05, .018, .05, .005), plinthMat);
      plinth.position.y = .009; g.add(plinth);
      top.position.y = .018; top.traverse(m => { if (m.isMesh) m.material = metal(badge.tier); }); g.add(top);
      const bb = new THREE.Box3().setFromObject(g); g.scale.setScalar(SIZE / Math.max(.01, bb.max.y));
      made[key] = shade(g);
    }
    const t = made[key].clone(); t.userData.badge = badge; return t;
  }

  // ---- where each goes: the shelf's slots, left to right, bottom shelf first; the newest kept when there are more
  const MAX = SHELF.ys.length * SHELF.slots;
  const slotAt = i => {
    const row = Math.floor(i / SHELF.slots), col = i % SHELF.slots, step = (SHELF.width - .1) / (SHELF.slots - 1);
    return new THREE.Vector3(SHELF.x - SHELF.width / 2 + .05 + col * step, SHELF.ys[row] + .015, SHELF.zs[row] + .01);
  };
  let onShelf = [];     // [{ o, badge }] in slot order
  const flying = [];    // trophies on their way: { o, badge, t, from, to }
  function layout(list) {
    for (const x of onShelf) x.o.removeFromParent();
    onShelf = list.slice(-MAX).map((badge, i) => { const o = build(badge); o.position.copy(slotAt(i)); o.rotation.y = (i % 3 - 1) * .18; root.add(o); return { o, badge }; });
  }

  const tmp = new THREE.Vector3();
  return {
    root,
    /** The trophies earned so far, on the shelf at once (on load). */
    show(earned) { layout(earned); },
    /** A new badge: it pops up in front of Reverie, spins, then flies to the shelf. earned is the whole list now. */
    award(badge, earned) {
      const o = build(badge); o.scale.multiplyScalar(.001); root.add(o);
      creature.root.getWorldPosition(tmp);
      const from = new THREE.Vector3(tmp.x, .98, tmp.z + .32);
      flying.push({ o, badge, t: 0, from, earned, k: o.scale.x * 1000 * 1.8 });
      sparks(from, METAL[badge.tier], 30);
    },
    /** The wood, when the room's woodwork is repainted. */
    setWood(colour) { const old = woodMat; woodMat = pbr(colour, { rough: .55 }); for (const s of shelves) s.material = woodMat; old.dispose?.(); },
    get count() { return onShelf.length + flying.length; },
    /** True while a new one is on show or flying. */
    get busy() { return flying.length > 0; },
    update(dt) {
      for (const f of flying) {
        f.t += dt; const o = f.o;
        if (f.t < SHOW_S) {
          // pop in big, bob and spin in front of it
          const k = Math.min(1, f.t / .35), pop = 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2);
          o.scale.setScalar(Math.max(.001, f.k * pop)); o.position.copy(f.from); o.position.y += Math.sin(f.t * 3) * .02; o.rotation.y += dt * 4.5;
          if ((f.spark = (f.spark || 0) - dt) < 0) { f.spark = .3; sparks({ x: f.from.x + (Math.random() - .5) * .2, y: f.from.y + .1, z: f.from.z }, METAL[f.badge.tier], 8); }
        } else {
          if (!f.to) { f.slot = Math.min(onShelf.length, MAX - 1); f.to = slotAt(f.slot); f.start = o.position.clone(); f.ry = o.rotation.y; if (onShelf.length >= MAX) { onShelf.shift().o.removeFromParent(); onShelf.forEach((x, i) => x.o.position.copy(slotAt(i))); } }
          const u = Math.min(1, (f.t - SHOW_S) / FLY_S), e = u * u * (3 - 2 * u);
          o.position.lerpVectors(f.start, f.to, e); o.position.y += Math.sin(e * Math.PI) * .35;
          o.scale.setScalar(f.k + (f.k / 1.8 - f.k) * e); o.rotation.y = f.ry + (((f.slot % 3) - 1) * .18 - f.ry) * e + (1 - e) * 3;
          if (u >= 1) { f.done = true; onShelf.push({ o, badge: f.badge }); sparks(f.to, '#fff2c8', 16); gs.sound.sounds.pop?.(); }
        }
      }
      for (let i = flying.length - 1; i >= 0; i--) if (flying[i].done) flying.splice(i, 1);
    },
    /** The badge of the trophy a ray hits, or null. */
    hit(ray) {
      const all = [...onShelf, ...flying].map(x => x.o), h = ray.intersectObjects(all, true)[0];
      if (!h) return null;
      let o = h.object; while (o && !o.userData.badge) o = o.parent;
      return o?.userData.badge || null;
    },
  };
}
