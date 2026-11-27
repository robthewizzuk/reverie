// Party lights for karaoke: a mirror ball comes down on its cord from the ceiling and spins, throwing flecks of light
// that sweep round the walls and floor; three coloured lights wash slowly across the room, flaring on the beat; the
// daylight dims a little so they show. All made in code, and all of it goes away again (the ball rises back up).
//   const party = makeParty(v);  party.on = true;  party.beat(phase 0..1);  party.update(dt)
import gs from '../engine/src/gamescroll.js';

const FLECKS = 70;                         // spots of light thrown by the ball
const HANG = { x: -.62, y: 1.02, z: -.85 };   // where the ball hangs, lowered (above and behind its left shoulder, in view)
const ROOM = { min: [-1.98, 0, -1.58], max: [2.2, 2.55, 2.2] };   // where its flecks land (inside the walls)
const COLOURS = ['#ff4fa3', '#4fb8ff', '#ffd23f', '#7cff6b', '#b46bff'];

/** The ball's tiles: a grid of greys (one a face of the sphere) and the glints, a few bright tiles. */
function tileTextures(THREE) {
  const W = 28, H = 18, c = document.createElement('canvas'), e = document.createElement('canvas'); c.width = e.width = W * 4; c.height = e.height = H * 4;
  const g = c.getContext('2d'), h = e.getContext('2d'); let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  h.fillStyle = '#000'; h.fillRect(0, 0, W * 4, H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = 150 + rnd() * 105 | 0; g.fillStyle = `rgb(${v},${v},${Math.min(255, v + 8)})`; g.fillRect(x * 4, y * 4, 4, 4);
    const r = rnd(); if (r > .82) { const k = r > .95 ? 255 : 90 + (r - .82) * 900 | 0; h.fillStyle = `rgb(${k},${k},${k})`; h.fillRect(x * 4, y * 4, 4, 4); }
  }
  const mk = cv => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t; };
  return { map: mk(c), glint: mk(e) };
}
/** A soft round spot, drawn once on a small canvas. */
function spotTexture(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.35, 'rgba(255,255,255,.75)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeParty(v) {
  const { THREE, pbr } = gs.hd;
  const group = new THREE.Group(); group.visible = false; v.scene.add(group);
  // the ball: rows of little mirror tiles (a flat-shaded sphere, a tile a face), each catching the light a little
  // differently, a few of them glinting
  const tiles = tileTextures(THREE), ballMat = pbr('#ffffff', { metal: .85, rough: .22, map: tiles.map, emissiveMap: tiles.glint, emissive: '#ffffff', flatShading: true });
  ballMat.emissiveIntensity = .6;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.13, 28, 18), ballMat);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(.003, .003, 1, 6), pbr('#d8d4cc', { rough: .6 }));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.018, .025, .03, 16), pbr('#c9c3b8', { metal: .8, rough: .3 }));
  group.add(ball, cord, cap);
  // the flecks: little bright spots laid flat on whatever wall or floor their ray from the ball meets
  const tex = spotTexture(THREE);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, vertexColors: false });
  const flecks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, FLECKS);
  flecks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); flecks.frustumCulled = false; group.add(flecks);
  const dirs = [], tints = [];
  for (let i = 0; i < FLECKS; i++) {   // (spread evenly over the sphere, a golden spiral, mostly sideways and down)
    const y = 1 - (i + .5) / FLECKS * 1.6, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    dirs.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    tints.push(new THREE.Color(i % 4 === 0 ? COLOURS[i % COLOURS.length] : '#fff8ee'));
  }
  for (let i = 0; i < FLECKS; i++) flecks.setColorAt(i, tints[i]);
  // three coloured washes
  let washes = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), d = new THREE.Vector3(), nrm = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
  let on = false, k = 0, t = 0, spin = 0, flare = 0, dim = 1;

  /** Where a ray from p along d meets the room's walls, floor or ceiling: the point and the surface's normal. */
  function hit(p, dir, out, n) {
    let best = Infinity;
    for (let ax = 0; ax < 3; ax++) {
      const c = dir.getComponent(ax); if (Math.abs(c) < 1e-4) continue;
      const wall = c > 0 ? ROOM.max[ax] : ROOM.min[ax], s = (wall - p.getComponent(ax)) / c;
      if (s > 0 && s < best) { best = s; n.set(0, 0, 0).setComponent(ax, c > 0 ? -1 : 1); }
    }
    out.copy(p).addScaledVector(dir, best); return best;
  }

  return {
    get on() { return on; },
    set on(x) {
      x = !!x; if (x === on) return; on = x;
      if (on) {
        group.visible = true;
        washes = COLOURS.slice(0, 3).map((col, i) => ({ f: v.flash(0, 1.2, 0, { keep: true, col, i: 0, reach: 3.2 }), a: i * 2.1 }));
      }
    },
    /** 0..1 through the beat, each frame while the song plays: the lights flare on it. */
    beat(phase) { flare = Math.pow(1 - Math.max(0, Math.min(1, phase)), 3); },
    /** How lit the room is (1: as the day has it), for whoever sets the exposure after it. */
    get dim() { return dim; },
    update(dt) {
      t += dt;
      k += ((on ? 1 : 0) - k) * (1 - Math.exp(-dt * (on ? 1.2 : 1.6)));
      if (!on && k < .01 && group.visible) { group.visible = false; for (const w of washes) w.f.stop(); washes = []; }
      if (!group.visible) { dim = 1; return; }
      // the ball comes down on its cord (and goes back up), and spins
      const y = 3 - (3 - HANG.y) * k * k * (3 - 2 * k);
      ball.position.set(HANG.x, y, HANG.z); spin += dt * .55; ball.rotation.set(.12, spin, 0);
      cord.scale.y = Math.max(.01, 3 - y - .13); cord.position.set(HANG.x, (3 + y + .13) / 2, HANG.z);
      cap.position.set(HANG.x, y + .135, HANG.z);
      // the flecks sweep round with it
      const lit = k * (.65 + .5 * flare);
      for (let i = 0; i < FLECKS; i++) {
        d.copy(dirs[i]).applyAxisAngle(THREE.Object3D.DEFAULT_UP, spin);
        const dist = hit(ball.position, d, pos, nrm);
        q.setFromUnitVectors(Z, nrm); pos.addScaledVector(nrm, .004);
        const s = (.05 + dist * .028) * (k > .05 ? 1 : 0);
        m.compose(pos, q, sc.set(s, s, s)); flecks.setMatrixAt(i, m);
      }
      flecks.instanceMatrix.needsUpdate = true;
      mat.opacity = lit; mat.color.setScalar(1.6);
      // the washes drift round the room, a little brighter on the beat
      for (const w of washes) {
        w.a += dt * .45;
        w.f.at(Math.cos(w.a) * 1.4, 1.6 + Math.sin(w.a * .7) * .5, Math.sin(w.a) * .9 - .2);
        w.f.i0 = (1.6 + 2.2 * flare) * k;
      }
      ballMat.emissiveIntensity = (.5 + 1.4 * flare) * k;
      dim = 1 - .32 * k;
    },
  };
}
