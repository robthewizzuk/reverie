// Reverie's Working Wall Clock: a real-time 3D analog workshop clock mounted flush on the curved back-left wall.
// Hour, minute, and second hands follow the device's real local time, with a gentle soft chime on the hour
// and tap-to-hear-the-time interaction.
import gs from '../engine/src/gamescroll.js';
import { backZ, wallNormal } from './shell.js';
import { brushedBrassMaps } from './photoreal-mats.js';

export function makeClock({ world, onNews = () => {} }) {
  const { THREE, pbr } = gs.hd;
  const scene = world.view.scene;

  const root = new THREE.Group();
  root.name = 'clock';
  // Mounted cleanly above the center-left floating shelf, well inside the camera frame
  const cx = -.94, cy = 1.45, cz = backZ(cx, cy) + .026;
  const n = wallNormal(cx, cy, cz);
  root.position.set(cx, cy, cz);
  root.lookAt(cx + n[0], cy + n[1] * .25, cz + n[2]);

  const R = .13;
  const bb = brushedBrassMaps(THREE);
  const rimMat = Object.assign(pbr('#c8a25e', { metal: .85, rough: .26 }), { bumpMap: bb.bumpMap, bumpScale: .002, roughnessMap: bb.roughnessMap });
  const faceMat = pbr('#f6f1e6', { rough: .78 });
  const tickMat = pbr('#3b322c', { rough: .65 });
  const handMat = pbr('#2a2320', { rough: .45, metal: .2 });
  const secMat = pbr('#c9583c', { rough: .4 });

  // Outer brass bezel + wooden back plate + warm cream dial
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(R, .016, 12, 36), rimMat);
  bezel.position.z = .012;
  bezel.castShadow = true;
  root.add(bezel);

  const backing = new THREE.Mesh(new THREE.CylinderGeometry(R + .012, R + .012, .022, 32), pbr('#a87c52', { rough: .6 }));
  backing.rotation.x = Math.PI / 2;
  backing.castShadow = true;
  backing.receiveShadow = true;
  root.add(backing);

  const dial = new THREE.Mesh(new THREE.CircleGeometry(R - .006, 32), faceMat);
  dial.position.z = .012;
  dial.receiveShadow = true;
  root.add(dial);

  // 12 crisp hour markers (longer at 12, 3, 6, 9)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const major = i % 3 === 0;
    const h = major ? .024 : .014;
    const w = major ? .007 : .004;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(w, h, .003), tickMat);
    const rr = R - .026 - h / 2;
    tick.position.set(Math.sin(a) * rr, Math.cos(a) * rr, .014);
    tick.rotation.z = -a;
    root.add(tick);
  }

  // Hands pivoted at dial center
  const makeHand = (len, w, z, mat) => {
    const g = new THREE.Group();
    g.position.z = z;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, len, .003), mat);
    bar.position.y = len * .38;
    g.add(bar);
    root.add(g);
    return g;
  };
  const hourHand = makeHand(.078, .009, .017, handMat);
  const minHand = makeHand(.112, .006, .020, handMat);
  const secHand = makeHand(.122, .0025, .023, secMat);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(.009, 12, 10), rimMat);
  cap.position.z = .025;
  root.add(cap);

  scene.add(root);

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let lastSec = -1, lastChimeHour = new Date().getHours(), chimeOn = true, tickAcc = 0;

  function syncHands(d = new Date()) {
    const s = d.getSeconds();
    if (s === lastSec) return;
    lastSec = s;
    const m = d.getMinutes() + s / 60;
    const h = (d.getHours() % 12) + m / 60;
    hourHand.rotation.z = -(h / 12) * Math.PI * 2;
    minHand.rotation.z = -(m / 60) * Math.PI * 2;
    secHand.rotation.z = -(s / 60) * Math.PI * 2;
  }
  syncHands();

  function formatTime(d = new Date()) {
    let h = d.getHours(), m = d.getMinutes();
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  function update(dt, { awake = false, quiet = false } = {}) {
    tickAcc += dt;
    if (tickAcc < .2) return;
    tickAcc = 0;
    const d = new Date();
    syncHands(d);
    const hr = d.getHours();
    if (chimeOn && awake && !quiet && d.getMinutes() === 0 && d.getSeconds() < 4 && hr !== lastChimeHour) {
      lastChimeHour = hr;
      gs.sound.sounds.bell?.();
    }
  }

  function tap(x, y, w, h) {
    ndc.set(x / w * 2 - 1, -(y / h) * 2 + 1);
    ray.setFromCamera(ndc, world.view.cam);
    if (!ray.intersectObject(root, true).length) return false;
    gs.sound.sounds.bell?.();
    onNews(`[clock] They tapped the workshop wall clock — it is ${formatTime()}.`, true);
    return true;
  }

  return {
    root,
    update,
    tap,
    get chime() { return chimeOn; },
    set chime(v) { chimeOn = !!v; },
    timeString: () => formatTime(),
  };
}
