// Reverie's Time Capsule jars on the shelf: corked glass jars holding a sealed note (and optionally a 3D prop)
// until a future date. Ready jars glow bright golden and jiggle gently on the shelf; tapping one pops the cork
// open with sparkles, reads the note, and brings any tucked-in prop into Reverie's hands.
import gs from '../engine/src/gamescroll.js';
import { makeCapsuleState } from './capsule-state.js';
import { SHELF, onBoard } from './room.js';
import { FUN } from './mood.js';

Object.assign(FUN, { capsule: FUN.capsule || [.04, .65] });

// shelf slots (clear of the vase at x = -1.5)
const SLOTS = [-.86, -1.02, -1.18, -1.34];

export function makeCapsules({ world, memory, onNews = () => {} }) {
  const { THREE, pbr } = gs.hd;
  const scene = world.view.scene;
  const state = makeCapsuleState({ birthday: () => memory?.birthday || null });
  const root = new THREE.Group(); root.name = 'capsules';
  scene.add(root);

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const jarProfile = [[0, 0], [.032, 0], [.038, .012], [.038, .072], [.026, .086], [.028, .098], [.023, .098]].map(([x, y]) => new THREE.Vector2(x, y));
  const jarGeo = new THREE.LatheGeometry(jarProfile, 24);
  const corkGeo = new THREE.CylinderGeometry(.023, .019, .022, 16);
  const scrollGeo = new THREE.CylinderGeometry(.01, .01, .048, 12);
  const orbGeo = new THREE.SphereGeometry(.016, 12, 10);

  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#f4fbff', transparent: true, opacity: .34, roughness: .08, clearcoat: 1, depthWrite: false });
  const corkMat = pbr('#b58554', { rough: .9 });
  const scrollMat = pbr('#f5e6c4', { rough: .85 });
  const COL_READY = new THREE.Color('#ffe066'), COL_SEALED = new THREE.Color('#a8d8ff');

  const jars = new Map();

  function syncJars() {
    const items = state.items;
    const alive = new Set(items.map(c => c.id));
    for (const [id, j] of jars) if (!alive.has(id)) { root.remove(j.group); j.orbMat.dispose(); jars.delete(id); }
    items.forEach((cap, idx) => {
      let j = jars.get(cap.id);
      if (!j) {
        const g = new THREE.Group();
        const glass = new THREE.Mesh(jarGeo, glassMat); g.add(glass);
        const cork = new THREE.Mesh(corkGeo, corkMat); cork.position.y = .102; cork.castShadow = true; g.add(cork);
        const scroll = new THREE.Mesh(scrollGeo, scrollMat); scroll.position.set(-.006, .038, 0); scroll.rotation.z = .24; g.add(scroll);
        const orbMat = new THREE.MeshBasicMaterial({ color: COL_SEALED });
        const orb = new THREE.Mesh(orbGeo, orbMat); orb.position.set(.008, .046, .004); g.add(orb);
        g.userData = { id: cap.id };
        root.add(g);
        j = { group: g, orb, orbMat, wasReady: false, basePos: new THREE.Vector3(), phase: idx * 1.9 };
        jars.set(cap.id, j);
      }
      const [x, y, z] = onBoard(SHELF, SLOTS[idx % SLOTS.length]);
      j.basePos.set(x, y, z);
      j.group.position.copy(j.basePos);
      j.cap = cap;
    });
  }
  syncJars();

  let t = 0;
  function update(dt) {
    t += dt;
    const now = Date.now();
    for (const j of jars.values()) {
      const ready = j.cap.openAt <= now;
      if (ready !== j.wasReady) { j.wasReady = ready; j.orbMat.color.copy(ready ? COL_READY : COL_SEALED); }
      j.orb.position.y = .044 + Math.sin(t * (ready ? 4.5 : 1.8) + j.phase) * .006;
      const s = ready ? 1.15 + Math.sin(t * 6 + j.phase) * .18 : .78 + Math.sin(t * 2 + j.phase) * .08;
      j.orb.scale.setScalar(s);
      if (ready) {
        j.group.rotation.z = Math.sin(t * 10 + j.phase) * .07;
        j.group.position.y = j.basePos.y + Math.abs(Math.sin(t * 5 + j.phase)) * .008;
      } else {
        j.group.rotation.z = 0;
        j.group.position.y = j.basePos.y;
      }
    }
  }

  async function openCapsule(idOrQuery, force = false) {
    const r = state.open(idOrQuery, { force });
    if (r.error) return { text: r.error, error: true };
    if (r.locked) return r.text;
    const pos = jars.get(r.capsule.id)?.basePos;
    syncJars();
    if (pos) world.sparks?.({ x: pos.x, y: pos.y + .08, z: pos.z }, '#ffe066', 18);
    world.celebrate?.();
    gs.sound.sounds.win?.() || gs.sound.sounds.bell?.();
    world.mood?.fun('capsule');
    if (r.capsule.prop) {
      try { await world.make(r.capsule.prop); } catch { /* prop optional */ }
    }
    return r.text;
  }

  function tap(x, y, w, h) {
    if (!jars.size) return false;
    ndc.set(x / w * 2 - 1, -(y / h) * 2 + 1);
    ray.setFromCamera(ndc, world.view.cam);
    const hits = ray.intersectObject(root, true);
    if (!hits.length) return false;
    let o = hits[0].object; while (o && !o.userData?.id) o = o.parent;
    const id = o?.userData?.id; if (!id) return false;
    openCapsule(id, false).then(res => {
      const txt = typeof res === 'string' ? res : res.text;
      onNews(`[capsule] They tapped a time capsule jar on the shelf: ${txt}`, true);
    });
    return true;
  }

  async function command(input = {}) {
    const a = input.action || 'seal';
    if (a === 'seal') {
      const prop = input.prop === 'held' || input.include_held ? (world.held?.short || '') : (input.prop || '');
      const r = state.seal({ note: input.note, prop, until: input.until, label: input.label });
      if (r.error) return { text: r.error, error: true };
      syncJars();
      const pos = jars.get(r.capsule.id)?.basePos;
      if (pos) world.sparks?.({ x: pos.x, y: pos.y + .08, z: pos.z }, '#a8d8ff', 12);
      gs.sound.sounds.bell?.();
      return r.text;
    }
    if (a === 'open') return openCapsule(input.label || input.id || '', !!input.early);
    if (a === 'list') return state.list();
    if (a === 'remove') {
      const r = state.remove(input.label || input.id || '');
      if (r.error) return { text: r.error, error: true };
      syncJars();
      return r.text;
    }
    return { text: 'Capsule action must be seal, open, list or remove.', error: true };
  }

  return {
    state,
    update, tap, command,
    line: () => state.line(),
    briefingLine: () => state.briefingLine(),
  };
}
