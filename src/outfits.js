// Clothes and accessories for Reverie: hats, glasses, ears, wings, capes, a tail, mittens and a shield, each an
// original design built in code from the engine's materials (no model or picture files). They hang on its body (so
// they lean, tilt, bob and breathe with it) or on an arm (so they swing with it), and a few of them move by
// themselves: wings flutter, ears twitch, a plume and a tail sway, eyes on stalks wobble.
// What it wears is kept on this device. A character voice puts on its outfit (voice tool), and the season can too.
import gs from '../engine/src/gamescroll.js';
import { PIECES, OUTFITS, VOICE_OUTFITS, resolve, said, seasonOn } from './outfit-names.js';
import { colourOf } from './looks.js';

const KEY = 'reverie.outfit.v1';
const D = Math.PI / 180;

// ---- shapes made in code
// Its head and body are one plush blob: an egg of these radii round this middle (creature.js), in the body's frame.
let THREE, pbr, C, R, Y;
function init() {
  if (THREE) return;
  ({ THREE, pbr } = gs.hd);
  C = new THREE.Vector3(0, .33, 0); R = new THREE.Vector3(.28, .3136, .266); Y = new THREE.Vector3(0, 1, 0);
}
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
/** The way a point at polar angle th (0 on top) and turn ph (0 in front, 90 to its left, +x) faces, in degrees. */
const dir = (th, ph) => V(Math.sin(th * D) * Math.sin(ph * D), Math.cos(th * D), Math.sin(th * D) * Math.cos(ph * D));
/** The outward normal of the blob where a direction meets it. */
const normalAt = d => V(d.x / R.x, d.y / R.y, d.z / R.z).normalize();
/** The point on the blob along a direction, pushed out along its normal by `out` metres. */
const surf = (d, out = 0) => V(R.x * d.x, R.y * d.y, R.z * d.z).add(C).addScaledVector(normalAt(d), out);
const onHead = (th, ph, out = 0) => surf(dir(th, ph), out);

/** A surface from fn(u, v) -> Vector3 over a grid (u across, v along); closeU when its u edges meet. */
function grid(nu, nv, fn, closeU = false) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const p = fn(i / nu, j / nv); pos.push(p.x, p.y, p.z); uv.push(i / nu, j / nv); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  if (closeU) seam(g, nu, nv);
  return g;
}
// (the normals either side of a closed seam averaged, so it doesn't show)
function seam(g, nu, nv) {
  const n = g.attributes.normal, a = V(), b = V();
  for (let j = 0; j <= nv; j++) {
    const i0 = j * (nu + 1), i1 = i0 + nu;
    a.fromBufferAttribute(n, i0).add(b.fromBufferAttribute(n, i1)).normalize();
    n.setXYZ(i0, a.x, a.y, a.z); n.setXYZ(i1, a.x, a.y, a.z);
  }
}

/**
 * A tube along points whose radius r(t) changes from one end (t 0) to the other (t 1): horns, ears, hats, feathers.
 * flat squashes it across: its thin side faces `up` (projected off the tube's direction).
 */
function sweep(pts, r, { radial = 18, seg = 40, flat = 1, up = V(0, 0, 1) } = {}) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal'), pos = [], uv = [], idx = [];
  let N = null; const T = V(), B = V(), P = V(), q = V();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg; curve.getPointAt(t, P); curve.getTangentAt(t, T);
    // (the frame carried along the tube, so it never flips)
    if (!N) { N = up.clone().addScaledVector(T, -up.dot(T)); if (N.lengthSq() < 1e-6) N = V(1, 0, 0).addScaledVector(T, -T.x); N.normalize(); }
    else N.addScaledVector(T, -N.dot(T)).normalize();
    B.crossVectors(T, N);
    const rr = r(t);
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2;
      q.copy(P).addScaledVector(N, Math.cos(a) * rr * flat).addScaledVector(B, Math.sin(a) * rr);
      pos.push(q.x, q.y, q.z); uv.push(j / radial, t);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + 1, c = a + radial + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  // caps: each end closed with a fan to its middle
  for (const [i, t] of [[0, 0], [seg, 1]]) {
    if (r(t) < 1e-4) continue;
    curve.getPointAt(t, P); const m = pos.length / 3; pos.push(P.x, P.y, P.z); uv.push(.5, t);
    for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j; if (i === 0) idx.push(m, a + 1, a); else idx.push(m, a, a + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  // (the seam down the side of the tube smoothed)
  const n = g.attributes.normal, a = V(), b = V();
  for (let i = 0; i <= seg; i++) { const i0 = i * (radial + 1), i1 = i0 + radial; a.fromBufferAttribute(n, i0).add(b.fromBufferAttribute(n, i1)).normalize(); n.setXYZ(i0, a.x, a.y, a.z); n.setXYZ(i1, a.x, a.y, a.z); }
  return g;
}
/** A round tube along points (closed: a loop). */
const tube = (pts, r, closed = false, seg = 64) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed, 'centripetal'), seg, r, 8, closed);
/** Points round the head at polar angle th, from turn a to b (degrees), out from it. */
const ring = (th, out, a = 0, b = 360, n = 48) => Array.from({ length: n + (b - a < 360 ? 1 : 0) }, (_, i) => onHead(th, a + (b - a) * i / n, out));

/** Many shapes as one (one draw): [geometry, matrix?, colour?]. */
function merge(list) {
  const pos = [], nor = [], uv = [], col = [], idx = []; let base = 0, coloured = list.some(e => e[2]);
  const p = V(), n = V(), nm = new THREE.Matrix3(), c = new THREE.Color();
  for (const [g0, m, colour] of list) {
    const g = g0.index ? g0 : g0.toNonIndexed();
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    if (m) nm.getNormalMatrix(m);
    if (coloured) c.set(colour || '#ffffff');
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i); n.fromBufferAttribute(N, i);
      if (m) { p.applyMatrix4(m); n.applyMatrix3(nm).normalize(); }
      pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
      if (coloured) col.push(c.r, c.g, c.b);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    else for (let i = 0; i < P.count; i++) idx.push(i + base);
    base += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); if (coloured) out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx); return out;
}
/** A matrix that puts a shape at p, its +y along `up` (a direction), turned `spin` about it and scaled. */
function at(p, up = Y, spin = 0, s = 1) {
  const q = new THREE.Quaternion().setFromUnitVectors(Y, up.clone().normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(Y, spin));
  return new THREE.Matrix4().compose(p, q, typeof s === 'number' ? V(s, s, s) : s);
}

// fluff: a soft lumpy surface (pom-poms, fur trim, plumes): pushed in and out along its normals, the normals tipped
// the same way so the lumps catch the light
const bumps = (x, y, z, f) => Math.sin(x * f + 1.3) * Math.sin(y * f * 1.21 + .7) * Math.sin(z * f * .87 + 2.1) + .5 * Math.sin(x * f * 2.3 + 4) * Math.sin(y * f * 2.1) * Math.sin(z * f * 2.7 + 1);
function fluff(g, amt, f = 90) {
  const P = g.attributes.position, N = g.attributes.normal, p = V(), n = V(), e = .004;
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i); n.fromBufferAttribute(N, i);
    const h = bumps(p.x, p.y, p.z, f), gx = (bumps(p.x + e, p.y, p.z, f) - h) / e, gy = (bumps(p.x, p.y + e, p.z, f) - h) / e, gz = (bumps(p.x, p.y, p.z + e, f) - h) / e;
    P.setXYZ(i, p.x + n.x * h * amt, p.y + n.y * h * amt, p.z + n.z * h * amt);
    const k = amt * .9; n.set(n.x - gx * k, n.y - gy * k, n.z - gz * k).normalize(); N.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

// pictures painted in code: knitting, tweed, stars
function picture(w, h, paint, rep = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); t.anisotropy = 4;
  return t;
}
const knit = rep => picture(64, 64, (x, w, h) => {
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
  // rows of little v stitches, each a pair of soft slanted loops
  for (let r = 0; r < 8; r++) for (let k = 0; k < 4; k++) for (const s of [-1, 1]) {
    const cx = k * 16 + 8 + s * 3.6, cy = r * 8 + 4;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, 5.5); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(120,110,105,.55)');
    x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, 3.4, 5.2, s * .5, 0, Math.PI * 2); x.fill();
  }
}, rep);
const tweed = rep => picture(64, 64, (x, w, h) => {
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { x.fillStyle = `rgba(70,55,40,${((i + j) % 4 < 2 ? .35 : .12) + ((i * 7 + j * 13) % 5) * .03})`; x.fillRect(i * 4, j * 4 + ((i % 2) ? 2 : 0), 2, 3); }
}, rep);
const starry = rep => picture(256, 256, (x, w, h) => {
  x.fillStyle = '#000000'; x.fillRect(0, 0, w, h);
  const star = (cx, cy, r) => { x.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } x.closePath(); x.fill(); };
  x.fillStyle = '#ffffff';
  [[40, 50, 18], [170, 30, 11], [120, 120, 15], [220, 150, 9], [60, 190, 12], [190, 220, 16], [100, 240, 7], [240, 70, 8]].forEach(s => star(...s));
  for (let i = 0; i < 40; i++) { x.beginPath(); x.arc((i * 97) % w, (i * 61 + 23) % h, 1.6, 0, Math.PI * 2); x.fill(); }
}, rep);
const flakes = rep => picture(128, 128, (x, w, h) => {
  x.fillStyle = '#000000'; x.fillRect(0, 0, w, h); x.strokeStyle = '#ffffff'; x.lineWidth = 1.6; x.lineCap = 'round';
  for (const [cx, cy, r] of [[30, 30, 12], [95, 60, 9], [50, 100, 10], [110, 115, 6]]) for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3, ex = cx + Math.cos(a) * r, ey = cy + Math.sin(a) * r;
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(ex, ey); x.stroke();
    for (const s of [-1, 1]) { x.beginPath(); x.moveTo(cx + Math.cos(a) * r * .6, cy + Math.sin(a) * r * .6); x.lineTo(cx + Math.cos(a) * r * .6 + Math.cos(a + s * .8) * r * .35, cy + Math.sin(a) * r * .6 + Math.sin(a + s * .8) * r * .35); x.stroke(); }
  }
}, rep);
const stripes = rep => picture(128, 128, (x, w, h) => {
  const cols = ['#ff6b8a', '#ffd25a', '#5ec8e8', '#8ee07a'];
  for (let i = -4; i < 12; i++) { x.fillStyle = cols[(i + 8) % 4]; x.beginPath(); x.moveTo(i * 16, 0); x.lineTo(i * 16 + 16, 0); x.lineTo(i * 16 + 16 + h * .6, h); x.lineTo(i * 16 + h * .6, h); x.fill(); }
  x.fillStyle = 'rgba(255,255,255,.9)'; for (let i = 0; i < 18; i++) { x.beginPath(); x.arc((i * 37) % w, (i * 53 + 11) % h, 3, 0, Math.PI * 2); x.fill(); }
}, rep);

// materials
const lighter = (c, k = .7) => '#' + new THREE.Color(c).lerp(new THREE.Color(1, 1, 1), k).getHexString();
const felt = (c, o = {}) => pbr(c, { rough: .88, sheen: .6, sheenColor: lighter(c), sheenRoughness: .6, side: THREE.DoubleSide, ...o });
const shiny = (c, o = {}) => pbr(c, { rough: .3, clear: .7, ...o });
const metal = (c, rough = .32, o = {}) => pbr(c, { metal: .75, rough: Math.max(rough, .38), ...o });
const fur = (c = '#fbf8f3') => pbr(c, { rough: .95, sheen: 1, sheenColor: '#ffffff', sheenRoughness: .35 });
const GOLD = '#d9a644', SILVER = '#d2d6de';

// a mesh that throws and takes shadows
function mesh(g, m) { const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; return o; }
/** A group turned about the middle of its head (a hat tipped back or to one side keeps hugging the head). */
function tipped(rx, rz, ...objs) {
  const g = new THREE.Group(), inner = new THREE.Group();
  g.position.copy(C); g.rotation.set(rx, 0, rz); inner.position.copy(C).negate(); inner.add(...objs); g.add(inner);
  return g;
}
/** A group that pivots about p (the base of an ear, a tail, a plume): build its parts round the origin. */
function pivot(p, ...objs) { const g = new THREE.Group(); g.position.copy(p); g.add(...objs); return g; }

// ---- the pieces. Each builds { parts: [[where, object]], main: the material a colour changes, update(dt, t) }:
// where is 'body' (its plush blob, the default) or an arm, 'arm-1' (its right, -x) or 'arm1' (its left, +x).
const BUILD = {
  tricorn() {
    const cloth = felt('#3a2b29'), gold = metal(GOLD, .35), plume = felt('#d8443c', { side: THREE.DoubleSide });
    const TH = 43;
    // the crown: a dome over the top of its head
    const crown = mesh(grid(48, 12, (u, v) => onHead(TH * (1 - v), u * 360, .026 + .07 * Math.pow(v, 1.3)), true), cloth);
    // the brim turned up all round, out to three points (one at the front)
    const k = ph => Math.pow((1 + Math.cos(3 * ph * D)) / 2, 2.2);
    const brimAt = (ph, v) => { const b = onHead(TH, ph, .026), w = .065 + .09 * k(ph); return b.add(V(Math.sin(ph * D), 0, Math.cos(ph * D)).multiplyScalar(w * v)).add(V(0, .095 * Math.pow(v, 1.5) * (1 - .55 * k(ph)), 0)); };
    const brim = mesh(grid(120, 8, (u, v) => brimAt(u * 360, v), true), cloth);
    const edge = Array.from({ length: 120 }, (_, i) => brimAt(i * 3, 1));
    const trim = mesh(tube(edge, .0065, true, 160), gold);
    // a red feather tucked in at its right
    const b = onHead(TH, -100, .05);
    const feather = mesh(sweep([b, b.clone().add(V(-.03, .07, -.03)), b.clone().add(V(-.025, .15, -.09)), b.clone().add(V(.005, .2, -.16))],
      t => .03 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.1 + .04)), .7) + .002, { flat: .18, up: V(1, 0, 0) }), plume);
    return { parts: [['body', tipped(-.1, .09, crown, brim, trim, feather)]], main: cloth, hideSprout: true };
  },

  eyepatch() {
    const black = pbr('#1e1a1f', { rough: .55, clear: .3 });
    const s = 1, E = V(s * .088, .46, .232), f = V(s * Math.sin(.32), 0, Math.cos(.32));
    const patch = mesh(new THREE.SphereGeometry(.05, 28, 16), black);
    patch.scale.set(1, .86, .3); patch.position.copy(E).addScaledVector(f, .026); patch.rotation.y = s * .32;
    // the strap: a loop round its head, across the brow to the other side and round the back
    const loop = Array.from({ length: 72 }, (_, i) => { const ph = i * 5, y = .52 - .07 * Math.cos((ph - 60) * D); return onHead(Math.acos((y - C.y) / R.y) / D, ph, .006); });
    const strap = mesh(tube(loop, .0055, true, 120), black);
    return { parts: [['body', patch], ['body', strap]], main: black };
  },

  spectacles: () => specs({ frame: metal('#c9a35e', .3), lens: pbr('#ffffff', { rough: .04, clear: 1, transparent: true, opacity: .1, depthWrite: false }), wire: .0045 }),
  sunglasses: () => specs({ frame: shiny('#1d1b22', { rough: .25 }), lens: pbr('#24202c', { rough: .06, clear: 1, film: .7, transparent: true, opacity: .86 }), wire: .0075, squash: .82 }),

  flat_cap() {
    const cloth = felt('#a08b6c'); cloth.map = tweed([10, 4]);
    const TH = ph => 50 + 22 * (1 - Math.cos(ph * D)) / 2;
    const shell = mesh(grid(64, 18, (u, v) => { const ph = u * 360, p = onHead(TH(ph) * (1 - v), ph, .026 + .034 * Math.sin(v * Math.PI) * Math.max(0, Math.cos(ph * D))); p.y = Math.min(p.y, .668 - .1 * Math.max(0, p.z)); return p; }, true), cloth);
    // the peak, a half moon over its eyes, curving a little down
    const peakAt = (u, v) => { const ph = (u - .5) * 120, b = onHead(TH(ph), ph, .026), w = .075 * Math.sqrt(Math.max(0, 1 - ((u - .5) * 2) ** 2)) + .004; return b.add(V(Math.sin(ph * D), 0, Math.cos(ph * D)).multiplyScalar(w * v)).add(V(0, -.018 * v * v, 0)); };
    const peak = mesh(grid(40, 6, peakAt), cloth);
    const lip = mesh(tube(Array.from({ length: 41 }, (_, i) => peakAt(i / 40, 1)), .004, false, 60), cloth);
    const button = mesh(new THREE.SphereGeometry(.013, 16, 10), cloth); button.position.set(0, .668, 0); button.scale.y = .6;
    return { parts: [['body', tipped(.1, 0, shell, peak, lip, button)]], main: cloth, hideSprout: true };
  },

  beanie() {
    const wool = felt('#e0a23c', { sheen: .8 }); wool.map = knit([14, 3]);
    const cuff = felt('#e0a23c', { sheen: .8 }); cuff.map = knit([22, 1]);
    const TH = ph => 54 + 16 * (1 - Math.cos(ph * D)) / 2;
    const shell = mesh(grid(64, 14, (u, v) => { const ph = u * 360; return onHead(TH(ph) * (1 - v), ph, .03 + .015 * v); }, true), wool);
    const band = mesh(fluff(tube(Array.from({ length: 64 }, (_, i) => onHead(TH(i * 360 / 64) - 4, i * 360 / 64, .046)), .022, true, 96), .002), cuff);
    const pom = mesh(fluff(new THREE.SphereGeometry(.05, 32, 20), .009, 70), fur('#fff6e8')); pom.position.copy(onHead(0, 0, .085));
    return { parts: [['body', tipped(-.05, -.08, shell, band, pom)]], main: wool, also: [cuff], hideSprout: true };
  },

  santa_hat() {
    const velvet = felt('#c4263a', { sheen: .9, sheenColor: '#ff8a96', sheenRoughness: .4 }), white = fur();
    const band = mesh(fluff(tube(ring(46, .034, 0, 360, 64), .03, true, 120), .008, 80), white);
    const tip = V(.23, .7, -.06);
    const cone = mesh(sweep([V(0, .55, 0), V(0, .66, -.005), V(.02, .77, -.03), V(.09, .835, -.06), V(.18, .8, -.07), tip], t => .225 * Math.pow(1 - t, 1.3) + .012, { flat: .95, radial: 32, seg: 60 }), velvet);
    const pom = mesh(fluff(new THREE.SphereGeometry(.045, 28, 18), .008, 80), white); pom.position.copy(tip);
    // holly on the band: two glossy leaves and three berries
    const leaf = pbr('#2f7d43', { rough: .3, clear: .8 }), berry = shiny('#d4202e', { rough: .2 });
    const h = onHead(46, 38, .066), n = normalAt(dir(46, 38));
    const leaves = mesh(merge([-1, 1].map(s => [new THREE.SphereGeometry(1, 16, 8), at(h.clone().add(V(s * .022, .004, .004)), n, s * 1.1, V(.028, .005, .013))])), leaf);
    const berries = mesh(merge([[-.008, .006], [.008, .006], [0, -.006]].map(([x, y]) => [new THREE.SphereGeometry(.0105, 14, 10), at(h.clone().add(V(x, y + .008, .012)))])), berry);
    return { parts: [['body', tipped(-.06, -.06, cone, band, pom, leaves, berries)]], main: velvet, hideSprout: true };
  },

  mittens() {
    const wool = felt('#c8283a', { sheen: .8 }); wool.map = knit([6, 3]);
    const white = fur();
    const parts = [];
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      const m = mesh(new THREE.SphereGeometry(.058, 28, 18), wool); m.position.y = -.162; m.scale.set(1, .93, .88);
      const thumb = mesh(new THREE.SphereGeometry(.023, 16, 10), wool); thumb.position.set(-s * .038, -.148, .03); thumb.scale.set(.9, 1.3, .9); thumb.rotation.z = -s * .5;
      const cuff = mesh(fluff(new THREE.TorusGeometry(.04, .014, 12, 32), .004, 120), white); cuff.rotation.x = Math.PI / 2; cuff.position.y = -.112;
      g.add(m, thumb, cuff); parts.push(['arm' + s, g]);
    }
    return { parts, main: wool };
  },

  party_hat() {
    const paper = pbr('#ffffff', { rough: .55, sheen: .3, side: THREE.DoubleSide }); paper.map = stripes([2, 1]);
    const cone = mesh(new THREE.ConeGeometry(.115, .28, 48, 1, true), paper); cone.position.set(0, .7, 0);
    const rim = mesh(fluff(new THREE.TorusGeometry(.1, .013, 10, 44), .003, 150), fur('#fff4d6')); rim.rotation.x = Math.PI / 2; rim.position.y = .6;
    const puff = mesh(fluff(new THREE.SphereGeometry(.028, 20, 14), .006, 110), fur('#ffd04a')); puff.position.y = .842;
    return { parts: [['body', tipped(0, .26, cone, rim, puff)]], main: paper, hideSprout: true };
  },

  top_hat() {
    const silk = pbr('#2b2730', { rough: .4, sheen: .7, sheenColor: '#8a8098', sheenRoughness: .35 }), ribbon = pbr('#c2405a', { rough: .35, sheen: .8, sheenColor: '#ff9ab0' });
    const crown = mesh(new THREE.CylinderGeometry(.098, .09, .16, 48), silk); crown.position.y = .7;
    const brim = mesh(new THREE.LatheGeometry([V(.0, -.002), V(.12, -.004), V(.155, .002), V(.172, .014), V(.176, .026), V(.168, .028), V(.15, .014), V(.12, .006), V(.0, .006)].map(p => new THREE.Vector2(p.x, p.y)), 64), silk);
    brim.position.y = .614;
    const band = mesh(new THREE.CylinderGeometry(.093, .092, .032, 48, 1, true), ribbon); band.position.y = .637;
    return { parts: [['body', tipped(-.05, .2, crown, brim, band)]], main: silk, also: [], hideSprout: true };
  },

  witch_hat: () => tallHat({ colour: '#5b3a8a', band: '#f08a2c', brim: .3, wave: .012, tip: [V(0, .55, 0), V(0, .69, -.01), V(0, .82, -.04), V(-.02, .93, -.1), V(-.06, .97, -.19)], buckle: true }),
  wizard_hat: () => tallHat({ colour: '#3a4fc2', brim: .245, stars: true, tip: [V(0, .55, 0), V(0, .71, -.005), V(.01, .86, -.03), V(.06, .97, -.07), V(.13, .99, -.04)], dangle: true }),

  crown() {
    const gold = metal('#f0c45a', .4, { side: THREE.DoubleSide, glow: .12, glowCol: '#ffcf70' });
    const h = ph => .036 + .052 * Math.pow((1 + Math.cos(5 * ph * D)) / 2, 6);
    const band = mesh(grid(150, 6, (u, v) => { const ph = u * 360; return onHead(27, ph, .018).add(V(Math.sin(ph * D), 0, Math.cos(ph * D)).multiplyScalar(.016 * v)).add(V(0, h(ph) * v, 0)); }, true), gold);
    const rim = mesh(tube(ring(27, .02, 0, 360, 64), .0075, true, 96), gold);
    const tips = mesh(merge(Array.from({ length: 5 }, (_, k) => { const ph = k * 72; return [new THREE.SphereGeometry(.011, 14, 10), at(onHead(27, ph, .018).add(V(Math.sin(ph * D) * .016, h(ph) + .006, Math.cos(ph * D) * .016)))]; })), gold);
    const gems = mesh(merge(Array.from({ length: 5 }, (_, k) => { const ph = 36 + k * 72, n = normalAt(dir(27, ph)); return [new THREE.SphereGeometry(.012, 16, 12), at(onHead(27, ph, .026).add(V(0, .018, 0)), n, 0, V(1, .9, .55)), k % 2 ? '#3a6ee8' : '#d82a4a']; })),
      pbr('#ffffff', { rough: .08, clear: 1, vertexColors: true }));
    return { parts: [['body', tipped(-.04, .12, band, rim, tips, gems)]], main: gold };
  },

  ice_crown() {
    const ice = pbr('#e8f8ff', { rough: .06, glass: { thin: true, tint: '#bfe6ff' }, glow: .35, glowCol: '#a6dcff' }), silver = metal(SILVER, .25);
    const rim = mesh(tube(ring(30, .022, 0, 360, 64), .006, true, 96), silver);
    const crystals = mesh(merge(Array.from({ length: 9 }, (_, i) => {
      const k = i - 4, ph = k * 21, hh = .095 * (1 - Math.abs(k) * .14), b = onHead(30, ph, .024), o = V(Math.sin(ph * D), 0, Math.cos(ph * D));
      const up = Y.clone().addScaledVector(o, .28).normalize();
      return [new THREE.OctahedronGeometry(1, 0), at(b.addScaledVector(up, hh * .45), up, k * .4, V(.017, hh * .55, .017))];
    })), ice);
    return { parts: [['body', tipped(-.05, 0, rim, crystals)]], main: ice };
  },

  shell_tiara() {
    const pearl = pbr('#f8f1e8', { rough: .18, clear: 1, film: .5 }), shell = pbr('#f6b0a4', { rough: .35, clear: .5, film: .55, side: THREE.DoubleSide });
    const weed = pbr('#3f9a6a', { rough: .45, clear: .4, side: THREE.DoubleSide });
    const pearls = mesh(merge(Array.from({ length: 17 }, (_, i) => [new THREE.SphereGeometry(i % 2 ? .011 : .014, 14, 10), at(onHead(36, -104 + i * 13, .015))])), pearl);
    // a scallop shell standing up at the front, its ribs fanning out
    const fan = grid(30, 10, (u, v) => { const a = (u - .5) * 2.3, rho = .012 + .1 * v, rib = .006 * Math.pow(Math.abs(Math.cos((u - .5) * Math.PI * 9)), .6) * v; return V(rho * Math.sin(a), rho * Math.cos(a), rib + .016 * v * v); });
    const sc = mesh(fan, shell); sc.position.copy(onHead(30, 0, .008)); sc.rotation.x = -.42;
    // seaweed trailing from the tiara down each side of its head
    const strands = [];
    for (const s of [-1, 1]) for (const k of [0, 1]) {
      const pts = Array.from({ length: 7 }, (_, i) => onHead(33 + i * 8, s * (74 + k * 18 + 6 * Math.sin(i * 1.4 + k * 2)), .016 + .003 * i));
      strands.push([sweep(pts, t => .012 * (1 - .45 * t) + .003, { flat: .22, up: V(s, 0, 0), radial: 10, seg: 30 })]);
    }
    const weeds = mesh(merge(strands), weed);
    return { parts: [['body', tipped(-.03, 0, pearls, sc, weeds)]], main: shell };
  },

  star_tiara() {
    const silver = metal(SILVER, .22), star = pbr('#ffe9a8', { metal: .5, rough: .25, glow: .9, glowCol: '#ffd56a' });
    const band = mesh(tube(ring(31, .02, -96, 96, 40), .0055, false, 80), silver);
    const st = mesh(starShape(.034, .015, .008), star); st.position.copy(onHead(28, 0, .02)).add(V(0, .034, .006)); st.rotation.x = -.3;
    const gems = mesh(merge([-34, 34].map(ph => [new THREE.SphereGeometry(.009, 14, 10), at(onHead(31, ph, .028))])), pbr('#ffd1ec', { rough: .08, clear: 1, glow: .3, glowCol: '#ffb0de' }));
    return { parts: [['body', tipped(-.04, 0, band, st, gems)]], main: silver };
  },

  flower_crown() {
    const list = [], petals = ['#ffb3c8', '#fff4ef', '#ffd09a', '#cdb6ff'];
    for (let k = 0; k < 11; k++) {
      const ph = k * 360 / 11, p = onHead(36, ph, .018), n = normalAt(dir(36, ph)).add(V(0, .6, 0)).normalize(), col = petals[k % 4];
      for (let i = 0; i < 5; i++) { const a = i * 72 * D + k; list.push([new THREE.SphereGeometry(1, 12, 8), at(p.clone(), n, a, 1).multiply(new THREE.Matrix4().makeTranslation(.013, 0, 0)).multiply(new THREE.Matrix4().makeScale(.014, .004, .0085)), col]); }
      list.push([new THREE.SphereGeometry(.0075, 12, 8), at(p.clone().addScaledVector(n, .003)), '#ffc93a']);
      const q = onHead(37, ph + 360 / 22, .012), o = V(Math.sin((ph + 16) * D), 0, Math.cos((ph + 16) * D));
      list.push([new THREE.SphereGeometry(1, 12, 8), at(q, normalAt(dir(37, ph + 16)), Math.atan2(o.x, o.z), V(.009, .003, .02)), '#6cb46a']);
    }
    return { parts: [['body', tipped(-.05, .08, mesh(merge(list), pbr('#ffffff', { rough: .6, sheen: .4, vertexColors: true })))]] };
  },

  bow() {
    const satin = pbr('#ff6f9f', { rough: .3, sheen: .8, sheenColor: '#ffd3e2', clear: .35 });
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const loop = mesh(new THREE.TorusGeometry(.03, .013, 12, 28), satin); loop.position.x = s * .034; loop.scale.set(1.25, .78, .6); loop.rotation.z = s * .28; g.add(loop);
      const tail = mesh(sweep([V(0, -.004, 0), V(s * .016, -.035, .004), V(s * .028, -.068, 0)], t => .012 - .003 * t, { flat: .28, radial: 10, seg: 16 }), satin); g.add(tail);
    }
    const knot = mesh(new THREE.SphereGeometry(.017, 16, 12), satin); knot.scale.set(1, 1.1, .8); g.add(knot);
    g.position.copy(onHead(32, 42, .028)); g.rotation.set(-.5, .55, -.45);
    return { parts: [['body', g]], main: satin };
  },

  headphones() {
    const shell = shiny('#f3f0ea', { rough: .3 }), pad = felt('#e4573e', { sheen: .5 });
    const TH = 66;
    const band = mesh(tube(Array.from({ length: 33 }, (_, i) => { const a = i / 32 * 2 - 1; return onHead(TH * Math.abs(a), a < 0 ? -90 : 90, .045); }), .011, false, 80), shell);
    const parts = [band];
    for (const s of [-1, 1]) {
      const p = onHead(TH, s * 90, .052), cup = mesh(new THREE.CylinderGeometry(.052, .052, .034, 36), shell);
      cup.position.copy(p); cup.quaternion.setFromUnitVectors(Y, normalAt(dir(TH, s * 90)));
      const cushion = mesh(new THREE.TorusGeometry(.04, .013, 12, 32), pad); cushion.position.copy(onHead(TH, s * 90, .03)); cushion.quaternion.setFromUnitVectors(V(0, 0, 1), normalAt(dir(TH, s * 90)));
      parts.push(cup, cushion);
    }
    return { parts: [['body', tipped(-.22, 0, ...parts)]], main: shell };
  },

  elf_ears: rig => ears(rig, { len: [[.05, .03, -.005], [.1, .07, -.015], [.145, .118, -.032]], r: t => .045 * Math.pow(1 - t, .7) + .002, flat: .38, inner: '#f2a497', twitch: .06 }),
  ogre_ears: rig => ears(rig, { len: [[.05, .02, 0], [.1, .05, 0]], r: t => .04 + .05 * t * t, flat: .55, cup: '#b07766', twitch: .03, at: 74 }),

  leaf_cap() {
    const cloth = felt('#4f9a4a'), leafy = pbr('#72b862', { rough: .5, sheen: .4, sheenColor: '#d8f5c0' });
    const cone = mesh(sweep([V(0, .575, 0), V(0, .68, -.01), V(0, .78, -.05), V(0, .835, -.12), V(-.01, .83, -.19)], t => .186 * Math.pow(1 - t, 1.2) + .006, { flat: .95, radial: 32, seg: 50 }), cloth);
    const leaves = mesh(merge(Array.from({ length: 12 }, (_, k) => {
      const ph = k * 30, o = V(Math.sin(ph * D), 0, Math.cos(ph * D)), p = onHead(40, ph, .03).addScaledVector(o, .018);
      const m = new THREE.Matrix4().lookAt(V(), o.clone().add(V(0, -.45, 0)), Y).setPosition(p).multiply(new THREE.Matrix4().makeScale(.017, .005, .034));
      return [new THREE.SphereGeometry(1, 14, 8), m];
    })), leafy);
    return { parts: [['body', tipped(-.04, -.06, cone, leaves)]], main: cloth, hideSprout: true };
  },

  horns() {
    const red = shiny('#d8433f', { rough: .25 });
    return { parts: [['body', mesh(merge([-1, 1].map(s => { const b = onHead(30, s * 42, -.01); return [sweep([b, b.clone().add(V(s * .028, .05, .012)), b.clone().add(V(s * .042, .1, 0)), b.clone().add(V(s * .026, .142, -.02))], t => .03 * Math.pow(1 - t, .85) + .002, { radial: 20, seg: 30 })]; })), red)]], main: red };
  },

  devil_tail() {
    const red = shiny('#d8433f', { rough: .25 });
    const p0 = V(0, .2, -.225), pts = [V(), V(0, -.05, -.09), V(.05, -.04, -.18), V(.1, .04, -.22), V(.1, .13, -.19)];
    const tail = mesh(sweep(pts, t => .017 - .006 * t, { radial: 14, seg: 40 }), red);
    const spade = mesh(new THREE.ConeGeometry(.04, .07, 4), red); spade.scale.set(1, 1, .32);
    spade.position.copy(pts[4]).add(V(0, .025, .01)); spade.rotation.set(-.15, 0, -.05);
    const g = pivot(p0, tail, spade);
    return { parts: [['body', g]], main: red, update: (dt, t) => { g.rotation.y = Math.sin(t * 1.7) * .3; g.rotation.x = Math.sin(t * 2.3) * .06; } };
  },

  eye_stalks() {
    const stalk = shiny('#9b6fe0', { rough: .35 }), white = shiny('#fbfbf6', { rough: .12, clear: 1 }), dark = pbr('#1c1714', { rough: .15, clear: 1 }), glint = pbr('#ffffff', { glow: 1.5 });
    const stalks = [-1, 1].map(s => {
      const pts = [V(), V(s * .025, .06, .01), V(s * .052, .118, .02), V(s * .062, .16, .03)];
      const st = mesh(sweep(pts, t => .013 - .004 * t, { radial: 12, seg: 24 }), stalk);
      const eye = mesh(new THREE.SphereGeometry(.035, 24, 16), white); eye.position.copy(pts[3]).add(V(0, .02, 0));
      const pupil = mesh(new THREE.SphereGeometry(.018, 16, 12), dark); pupil.scale.z = .5; pupil.position.copy(eye.position).add(V(0, .002, .03));
      const sh = new THREE.Mesh(new THREE.SphereGeometry(.005, 8, 6), glint); sh.position.copy(pupil.position).add(V(-.006, .007, .009));
      return pivot(onHead(20, s * 40, -.008), st, eye, pupil, sh);
    });
    return { parts: stalks.map(g => ['body', g]), main: stalk, hideSprout: true, update: (dt, t) => stalks.forEach((g, i) => { g.rotation.z = Math.sin(t * 2.6 + i * 2) * .09; g.rotation.x = Math.sin(t * 1.9 + i) * .07; }) };
  },

  dragon_spikes() {
    const scale = pbr('#43b394', { rough: .4, clear: .6, sheen: .3, sheenColor: '#b8ffe6' });
    const list = [];
    for (let i = 0; i < 9; i++) {
      const a = -12 + i * 17, th = Math.abs(a), ph = a < 0 ? 0 : 180, p = onHead(th, ph, -.004), n = normalAt(dir(th, ph));
      const back = onHead(Math.abs(a + 1), a + 1 < 0 ? 0 : 180).sub(onHead(Math.abs(a - 1), a - 1 < 0 ? 0 : 180)).normalize();
      const sz = .7 + .5 * Math.sin(Math.min(1, (i + .6) / 8) * Math.PI), h = .07 * sz;
      list.push([sweep([p, p.clone().addScaledVector(n, h * .55).addScaledVector(back, h * .12), p.clone().addScaledVector(n, h).addScaledVector(back, h * .4)], t => .028 * sz * Math.pow(1 - t, .9) + .001, { flat: .45, up: V(1, 0, 0), radial: 14, seg: 12 })]);
    }
    return { parts: [['body', mesh(merge(list), scale)]], main: scale, hideSprout: true };
  },

  dragon_wings: () => batWings({ skin: '#6fd0b0', bone: '#2f8f74', size: 1.25, beat: 2.4, spread: .2 }),
  bat_wings: () => batWings({ skin: '#7a54a8', bone: '#4b3170', size: .82, beat: 3.4 }),

  fairy_wings() {
    const skin = pbr('#efe2ff', { rough: .15, transparent: true, opacity: .42, film: 1, glow: .3, glowCol: '#e2c8ff', side: THREE.DoubleSide, depthWrite: false });
    const edge = pbr('#ffffff', { glow: 1, glowCol: '#f3dcff', rough: .3 });
    const up = new THREE.Shape(); up.moveTo(0, 0); up.bezierCurveTo(.04, .2, .2, .27, .195, .15); up.bezierCurveTo(.19, .07, .07, .02, 0, 0);
    const lo = new THREE.Shape(); lo.moveTo(0, 0); lo.bezierCurveTo(.08, -.01, .155, -.08, .115, -.135); lo.bezierCurveTo(.07, -.155, .02, -.06, 0, 0);
    const shapes = [up, lo];
    const wings = [-1, 1].map(s => {
      const g = new THREE.Group(), inner = new THREE.Group(); inner.scale.x = s; g.add(inner);
      inner.add(new THREE.Mesh(merge(shapes.map(sh => [new THREE.ShapeGeometry(sh, 24)])), skin));
      inner.add(mesh(merge(shapes.map(sh => [tube(sh.getPoints(30).map(p => V(p.x, p.y, 0)), .0026, true, 80)])), edge));
      g.position.set(s * .05, .43, -.2); g.rotation.z = s * .12;
      return g;
    });
    return { parts: wings.map(g => ['body', g]), main: skin, update: (dt, t) => wings.forEach((g, i) => { g.rotation.y = (i ? 1 : -1) * (.5 + Math.sin(t * 10) * .2); }) };
  },

  wizard_cape: () => cape({ colour: '#3346a8', stars: true, trim: GOLD }),
  ice_cape: () => cape({ colour: '#9fd0f0', snow: true, collar: '#ffffff' }),
  royal_cape: () => cape({ colour: '#a8233a', collar: '#ffffff' }),

  knight_helmet() {
    const steel = metal('#eef0f4', .42, { metal: .55 }), dark = metal('#c4c9d2', .45, { metal: .55 }), plumeMat = felt('#d63a3a', { sheen: .9, sheenColor: '#ff9090' });
    const TH = ph => 50 + 28 * (1 - Math.cos(ph * D)) / 2;
    const shell = mesh(grid(72, 14, (u, v) => { const ph = u * 360; return onHead(TH(ph) * (1 - v), ph, .03); }, true), steel);
    const edge = Array.from({ length: 72 }, (_, i) => onHead(TH(i * 5) - 1, i * 5, .042));
    const band = mesh(tube(edge, .011, true, 120), dark);
    const rivets = mesh(merge(Array.from({ length: 10 }, (_, i) => [new THREE.SphereGeometry(.0065, 10, 8), at(onHead(TH(i * 36) - 1, i * 36, .054))])), steel);
    // a fin along the top from the brow to the back, and the plume rising out of it
    const crest = mesh(sweep(Array.from({ length: 9 }, (_, i) => { const a = -40 + i * 12; return onHead(Math.abs(a), a < 0 ? 0 : 180, .03); }), t => .016 * Math.sin(Math.PI * t) + .002, { flat: .25, up: V(1, 0, 0), radial: 12, seg: 40 }), dark);
    const fronds = merge([-.02, -.01, 0, .01, .02].map((dx, i) => [fluff(sweep([V(), V(dx * .6, .07, -.02), V(dx, .11, -.1), V(dx * 1.3, .085, -.2 - .01 * i % 2)], t => .026 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05 + .05)), .6) + .003, { flat: .7, radial: 12, seg: 30 }), .004, 120)]));
    const plume = pivot(onHead(4, 180, .035), mesh(fronds, plumeMat));
    return { parts: [['body', tipped(-.04, 0, shell, band, rivets, crest, plume)]], main: steel, hideSprout: true, update: (dt, t) => { plume.rotation.x = Math.sin(t * 1.6) * .05; plume.rotation.z = Math.sin(t * 1.1) * .04; } };
  },

  shield() {
    const face = shiny('#3d6fd8', { rough: .3 }), gold = metal(GOLD, .3);
    const sh = new THREE.Shape(); sh.moveTo(-.055, .05); sh.lineTo(.055, .05); sh.quadraticCurveTo(.062, -.03, 0, -.078); sh.quadraticCurveTo(-.062, -.03, -.055, .05);
    const g = new THREE.Group();
    const body = mesh(new THREE.ExtrudeGeometry(sh, { depth: .01, bevelEnabled: true, bevelThickness: .004, bevelSize: .004, bevelSegments: 2, curveSegments: 16 }), face);
    const rim = mesh(tube(sh.getPoints(24).map(p => V(p.x, p.y, .016)), .0055, true, 90), gold);
    const star = mesh(starShape(.026, .011, .005), gold); star.position.set(0, -.008, .016);
    g.add(body, rim, star); g.position.set(-.062, -.1, 0); g.rotation.y = -Math.PI / 2;
    return { parts: [['arm-1', g]], main: face };
  },
};

function specs({ frame, lens, wire, squash = 1 }) {
  const list = [], glass = [];
  for (const s of [-1, 1]) {
    const E = V(s * .088, .46, .232), f = V(s * Math.sin(.32), 0, Math.cos(.32)), x = V(Math.cos(s * .32), 0, -Math.sin(s * .32));
    const c = E.clone().addScaledVector(f, .042), m = new THREE.Matrix4().makeRotationY(s * .32).setPosition(c).multiply(new THREE.Matrix4().makeScale(1, squash, 1));
    list.push([new THREE.TorusGeometry(.048, wire, 10, 48), m]); glass.push([new THREE.CircleGeometry(.047, 36), m]);
    const out = c.clone().addScaledVector(x, s * .048);
    list.push([tube([out, onHead(62, s * 74, .014), onHead(63, s * 100, .006)], wire * .85, false, 24)]);
  }
  const inner = s => { const c = V(s * .088, .46, .232).addScaledVector(V(s * Math.sin(.32), 0, Math.cos(.32)), .042); return c.addScaledVector(V(Math.cos(s * .32), 0, -Math.sin(s * .32)), -s * .046); };
  list.push([tube([inner(-1), V(0, .474, .296), inner(1)], wire, false, 16)]);
  const lenses = new THREE.Mesh(merge(glass), lens); lenses.renderOrder = 3;
  return { parts: [['body', mesh(merge(list), frame)], ['body', lenses]], main: frame };
}

function tallHat({ colour, band, brim, wave = 0, tip, stars, buckle, dangle }) {
  const cloth = felt(colour);
  if (stars) { cloth.emissiveMap = starry([3, 2]); cloth.emissive = new THREE.Color('#ffcf6a'); cloth.emissiveIntensity = 1.1; }
  const r0 = .2, rOf = t => r0 * Math.pow(1 - t, 1.15) + .004;
  const cone = mesh(sweep(tip, rOf, { flat: .95, radial: 32, seg: 60 }), cloth);
  const brimMat = cloth;
  const brimAt = (u, v) => { const ph = u * 360 * D, r = .16 + (brim - .16) * v; return V(r * Math.sin(ph), .556 - .022 * v * v + wave * v * Math.sin(ph * 5), r * Math.cos(ph) * .95); };
  const rim = mesh(grid(96, 6, brimAt, true), brimMat);
  const roll = mesh(tube(Array.from({ length: 96 }, (_, i) => brimAt(i / 96, 1)), .008, true, 140), brimMat);
  const parts = [cone, rim, roll], also = [];
  if (band) {
    const bm = felt(band); also.push(bm);
    parts.push(mesh(new THREE.CylinderGeometry(.176, .186, .04, 48, 1, true), bm)); parts.at(-1).position.y = .585; parts.at(-1).scale.z = .95;
    if (buckle) { const b = mesh(new THREE.TorusGeometry(.019, .005, 6, 4), metal(GOLD, .3)); b.position.set(0, .585, .18); b.rotation.z = Math.PI / 4; parts.push(b); }
  }
  if (dangle) { const s = mesh(starShape(.022, .01, .006), pbr('#ffe28a', { metal: .5, rough: .3, glow: .8, glowCol: '#ffd060' })); s.position.copy(tip.at(-1)).add(V(.01, -.03, 0)); parts.push(s); }
  return { parts: [['body', tipped(-.06, stars ? -.08 : .07, ...parts)]], main: cloth, also, hideSprout: true };
}

function starShape(R1, R2, depth) {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R2 : R1; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: depth * .4, bevelSize: depth * .4, bevelSegments: 2 });
  g.center(); return g;
}

function ears(rig, { len, r, flat, inner, cup, twitch, at: th = 80 }) {
  const plush = rig.plush, made = [];
  const parts = [-1, 1].map(s => {
    const pts = [V(), ...len.map(([x, y, z]) => V(s * x, y, z))];
    const g = pivot(onHead(th, s * 90, -.012), mesh(sweep(pts, r, { flat, radial: 20, seg: 30 }), plush));
    if (inner) { const m = pbr(inner, { rough: .75 }); made.push(m); g.add(mesh(sweep(pts.map(p => p.clone().multiplyScalar(.9).add(V(0, 0, .011))), t => r(t) * .55, { flat: flat * .6, radial: 14, seg: 24 }), m)); }
    if (cup) { const m = pbr(cup, { rough: .8 }); made.push(m); const d = mesh(new THREE.CircleGeometry(r(1) * .72, 28), m); d.position.copy(pts.at(-1)).add(V(s * .002, 0, 0)); d.rotation.y = s * Math.PI / 2; g.add(d); }
    return g;
  });
  return { parts: parts.map(g => ['body', g]), also: made, update: (dt, t) => parts.forEach((g, i) => { const s = i ? 1 : -1, k = Math.pow(Math.max(0, Math.sin(t * 1.3 + i * .4)), 30); g.rotation.z = s * (Math.sin(t * 1.7 + i) * twitch * .4 + k * twitch); }) };
}

function batWings({ skin, bone, size, beat, spread = .4 }) {
  const sm = pbr(skin, { rough: .55, glow: .12, glowCol: skin, sheen: .5, sheenColor: lighter(skin, .5), side: THREE.DoubleSide }), bm = shiny(bone, { rough: .4 });
  const F = [[.23, .19], [.2, .05], [.125, .012], [.055, -.025], [0, 0]];
  const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.quadraticCurveTo(.07, .17, ...F[0]);
  for (let i = 1; i < F.length; i++) { const [x0, y0] = F[i - 1], [x1, y1] = F[i]; sh.quadraticCurveTo((x0 + x1) / 2 - .008, (y0 + y1) / 2 + .028, x1, y1); }
  const bend = g => { const P = g.attributes.position; for (let i = 0; i < P.count; i++) P.setZ(i, P.getZ(i) - 1.1 * P.getX(i) ** 2); g.computeVertexNormals(); return g; };
  const z = x => -1.1 * x * x, W = [.15, .165];
  const bones = [tube([V(0, 0, 0), V(.07, .15, z(.07)), V(...F[0], z(F[0][0]))], .0065, false, 30), ...F.slice(1, 4).map(([x, y]) => tube([V(W[0], W[1], z(W[0])), V(x, y, z(x))], .004, false, 8))];
  const wings = [-1, 1].map(s => {
    const g = new THREE.Group(), inner = new THREE.Group(); inner.scale.set(s * size, size, size); g.add(inner);
    inner.add(mesh(bend(new THREE.ShapeGeometry(sh, 20)), sm), mesh(merge(bones.map(b => [b])), bm));
    g.position.set(s * .07, .42, -.2); g.rotation.z = s * .15;
    return g;
  });
  return { parts: wings.map(g => ['body', g]), main: sm, also: [bm], update: (dt, t) => wings.forEach((g, i) => { g.rotation.y = (i ? 1 : -1) * (spread + Math.sin(t * beat) * .14); }) };
}

function cape({ colour, stars, snow, trim, collar }) {
  const cloth = felt(colour, { sheen: .8 });
  if (stars) { cloth.emissiveMap = starry([4, 3]); cloth.emissive = new THREE.Color('#ffcf6a'); cloth.emissiveIntensity = .9; }
  if (snow) { cloth.emissiveMap = flakes([5, 4]); cloth.emissive = new THREE.Color('#ffffff'); cloth.emissiveIntensity = .35; }
  const A0 = 116, A1 = 244, top = .5, bot = .04;
  const pt = (u, v) => {
    const ph = (A0 + (A1 - A0) * u) * D, y = top + (bot - top) * v, yy = (y - C.y) / R.y, rr = y > C.y ? Math.sqrt(Math.max(0, 1 - yy * yy)) : 1;
    const r = .022 + .009 * Math.sin(u * Math.PI * 10) * v + .04 * v * v;
    return V(Math.sin(ph) * (R.x * rr + r), y, Math.cos(ph) * (R.z * rr + r));
  };
  const parts = [mesh(grid(44, 26, pt), cloth)], also = [];
  const edge = Array.from({ length: 31 }, (_, i) => pt(i / 30, 0).add(V(0, .004, 0)));
  if (collar) { const m = fur(collar); also.push(m); parts.push(mesh(fluff(tube(edge, .024, false, 80), .007, 90), m)); }
  if (trim) { const m = metal(trim, .35); also.push(m); parts.push(mesh(tube(edge, .007, false, 80), m)); }
  const g = new THREE.Group(), inner = new THREE.Group(); g.position.set(0, top, 0); inner.position.set(0, -top, 0); inner.add(...parts); g.add(inner);
  return { parts: [['body', g]], main: cloth, also, update: (dt, t) => { g.rotation.x = .02 + Math.sin(t * 1.4) * .025; } };
}

// ---- what it is wearing
function load() { try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }

/**
 * Its wardrobe, on its rig (creature.rig: body, sprout, arms, plush). wear(input) changes what it wears;
 * forVoice(name) dresses it for a character voice; line() says what it wears for Claude; update(dt) moves the pieces.
 */
export function makeOutfits({ rig, today = () => new Date() }) {
  init();
  const kept = load();
  // on: slot -> piece; auto: piece -> 'voice' | 'season' (put on by itself, not asked for); tint: piece -> colour
  const st = { on: {}, auto: {}, tint: {}, seasonOff: kept.seasonOff || null };
  const worn = new Map();   // piece -> { built, objects }
  let t = 0;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* a private window */ } };

  function anchor(where) { return where === 'body' ? rig.body : rig.arms[where === 'arm-1' ? 0 : 1]; }
  function put(piece, { auto = null, tint } = {}) {
    const slot = PIECES[piece].slot;
    if (st.on[slot] && st.on[slot] !== piece) off(st.on[slot]);
    if (worn.has(piece)) off(piece);
    const built = BUILD[piece](rig);
    for (const [where, o] of built.parts) anchor(where).add(o);
    st.on[slot] = piece;
    if (auto) st.auto[piece] = auto; else delete st.auto[piece];
    if (tint !== undefined) { if (tint) st.tint[piece] = tint; else delete st.tint[piece]; }
    if (st.tint[piece] && built.main) built.main.color.set(st.tint[piece]);
    worn.set(piece, built);
    rig.sprout.visible = ![...worn.values()].some(b => b.hideSprout);
  }
  function off(piece) {
    const b = worn.get(piece); if (!b) return;
    for (const [where, o] of b.parts) {
      anchor(where).remove(o);
      o.traverse(m => { if (!m.isMesh) return; m.geometry.dispose(); for (const mat of [].concat(m.material)) if (mat !== rig.plush) { for (const k of ['map', 'emissiveMap']) mat[k]?.dispose?.(); mat.dispose(); } });
    }
    worn.delete(piece);
    if (st.on[PIECES[piece].slot] === piece) delete st.on[PIECES[piece].slot];
    delete st.auto[piece];
    rig.sprout.visible = ![...worn.values()].some(b => b.hideSprout);
  }
  /** The season's outfit on whatever slots are free, unless it was taken off this season. */
  function seasonal() {
    const s = seasonOn(today());
    if (!s || st.seasonOff === s.key) return [];
    const added = [];
    for (const p of OUTFITS[s.outfit]) if (!st.on[PIECES[p].slot]) { put(p, { auto: 'season' }); added.push(p); }
    return added;
  }
  // what it wore last time, then the season's outfit where there is room (and last season's taken off)
  for (const p of Object.values(kept.on || {})) if (PIECES[p]) put(p, { auto: kept.auto?.[p] || null, tint: kept.tint?.[p] });
  const now = seasonOn(today());
  for (const [p, why] of Object.entries({ ...st.auto })) if (why === 'season' && !(now && OUTFITS[now.outfit].includes(p))) off(p);
  seasonal(); save();

  const list = ps => ps.map(said).join(', ').replace(/, ([^,]*)$/, ' and $1');
  const wearing = () => [...worn.keys()];
  const nameOf = ps => { for (const [n, o] of Object.entries(OUTFITS)) if (o.length > 1 && o.every(p => ps.includes(p))) return n; return null; };

  return {
    get wearing() { return wearing(); },
    /** The wear tool: { put_on: [names], take_off: [names or "all"], colour }. Returns { text, error?, changed }. */
    wear(input = {}) {
      const on = [].concat(input.put_on ?? []).map(String), offs = [].concat(input.take_off ?? []).map(String), unknown = [], took = [], wore = [];
      let tint;
      if (input.colour != null && String(input.colour).trim()) { tint = colourOf(input.colour, THREE); if (!tint) return { text: `Not changed: "${input.colour}" is not a colour I know: use #rrggbb.`, error: true }; }
      for (const w of offs) {
        if (/^(all|everything|clothes|outfit|it all)$/i.test(w.trim())) { took.push(...wearing()); continue; }
        const r = resolve(w); if (!r) { unknown.push(w); continue; }
        took.push(...r.pieces.filter(p => worn.has(p)));
      }
      for (const p of new Set(took)) { if (st.auto[p] === 'season') st.seasonOff = seasonOn(today())?.key || st.seasonOff; off(p); }
      for (const w of on) {
        const r = resolve(w); if (!r) { unknown.push(w); continue; }
        for (const p of r.pieces) { put(p, { tint: tint === undefined ? undefined : tint }); wore.push(p); }
      }
      // a colour on its own: the colour of what it has on (its hat first)
      if (tint && !on.length && !offs.length) {
        const p = st.on.hat || wearing()[0];
        if (p) { put(p, { tint, auto: st.auto[p] || null }); wore.push(p); }
      }
      save();
      const parts = [];
      if (wore.length) parts.push(`You are now wearing ${list(wearing())}.`);
      else if (took.length) parts.push(`You took off ${list([...new Set(took)])}. ${worn.size ? `You are wearing ${list(wearing())}.` : 'You are wearing nothing now.'}`);
      if (unknown.length) parts.push(`There is no ${unknown.map(u => `"${u}"`).join(' or ')} in your wardrobe: say so playfully and pick the nearest piece from the list, or make it as a prop instead.`);
      const changed = wore.length + took.length > 0;
      return { text: (parts.join(' ') || 'Nothing changed.') + (changed ? ' It is remembered next time.' : ''), error: !changed, changed };
    },
    /** Dresses it for a voice (a voices.js name, '' for its own): the character's outfit goes on, the last one off. */
    forVoice(name) {
      const was = Object.keys(st.auto).filter(p => st.auto[p] === 'voice');
      const outfit = VOICE_OUTFITS[name], want = outfit ? OUTFITS[outfit] : [];
      if (want.length && want.every(p => worn.has(p))) return '';
      for (const p of was) if (!want.includes(p)) off(p);
      for (const p of want) put(p, { auto: 'voice' });
      const back = !want.length && was.length ? seasonal() : [];
      save();
      if (want.length) return `Your ${said(outfit)} outfit went on with the voice: ${list(want)}.`;
      if (was.length) return `The costume for that voice came off${back.length ? `, and your ${list(back)} went back on` : ''}.`;
      return '';
    },
    /** For Claude's scene line: what it has on. */
    line() {
      if (!worn.size) return '';
      const ps = wearing(), o = nameOf(ps);
      return ` You are wearing: ${list(ps)}${o ? ` (your ${said(o)} outfit)` : ''}.`;
    },
    update(dt) { t += dt; for (const b of worn.values()) b.update?.(dt, t); },
    /** Takes everything off and forgets it (tests). */
    reset() { for (const p of wearing()) off(p); st.seasonOff = null; save(); },
  };
}
