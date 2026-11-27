// The room's shape: a round capsule, like being inside a ball. Its plan is a soft rounded square (a superellipse),
// the floor curves up into the walls, and above the seam round the middle the walls curve over into a dome. One
// smooth shell, no corners. This file is the shape alone (plain numbers, no three.js), so world.js builds the meshes
// from it and the tests and room.js can ask where the wall is.

export const SHELL = {
  cx: .12, cz: .4,       // the middle of the plan (the creature stands at 0, 0)
  a: 2.45, b: 2.1,     // half its width (x) and depth (z) at the seam, metres
  n: 2.4,              // how square the plan is: 2 a circle, higher squarer
  cove: .4,            // the curve from the floor up into the wall (its radius)
  seam: 1.02,          // where the dome starts, with a soft seam round the room
  top: 2.6,            // the dome's crown (kept low, so the shelves and windows sit in view)
};

// the big window in the left wall (metres): a long window with round ends, z and y its extent on the wall, r its
// corners' radius, x where its glass is (out past the curve of the wall, at the end of its reveal)
export const WINDOW = { x: -2.52, z0: -.45, z1: 1.35, y0: .62, y1: 1.75, r: .45 };

const S = SHELL;
/** The plan's radius from the middle towards angle phi (the wall at the seam). */
export function planR(phi) {
  const c = Math.abs(Math.cos(phi)) / S.a, s = Math.abs(Math.sin(phi)) / S.b;
  return 1 / Math.pow(c ** S.n + s ** S.n, 1 / S.n);
}
/** The wall's distance from the middle towards phi at height y (the cove below, the dome above the seam). */
export function shellR(phi, y) {
  let r = planR(phi);
  if (y > S.seam) { const u = Math.min(1, (y - S.seam) / (S.top - S.seam)); r *= Math.sqrt(Math.max(0, 1 - u * u)); }
  if (y < S.cove) r -= S.cove - Math.sqrt(Math.max(0, S.cove ** 2 - (S.cove - y) ** 2));
  return r;
}
/** The point on the wall towards (x, z) from the middle, at height y: [x, y, z]. */
export function wallAt(x, y, z) {
  const phi = Math.atan2(z - S.cz, x - S.cx), r = shellR(phi, y);
  return [S.cx + Math.cos(phi) * r, y, S.cz + Math.sin(phi) * r];
}
/** How far (x, y, z) is inside the wall, metres along the line from the middle (negative: outside). */
export function inside(x, y, z) {
  const phi = Math.atan2(z - S.cz, x - S.cx);
  return shellR(phi, y) - Math.hypot(x - S.cx, z - S.cz);
}
// (where a line meets the wall: halved until it's within a millimetre)
function meet(at, from, to) {
  let a = from, b = to;
  for (let i = 0; i < 22; i++) { const m = (a + b) / 2; if (inside(...at(m)) > 0) a = m; else b = m; }
  return (a + b) / 2;
}
/** The back wall's z at x and height y. */
export const backZ = (x, y = .5) => meet(z => [x, y, z], S.cz, S.cz - 6);
/** The front wall's z at x and height y. */
export const frontZ = (x, y = .5) => meet(z => [x, y, z], S.cz, S.cz + 6);
/** The left wall's x at z and height y (right: side 1). */
export const sideX = (z, y = .5, side = -1) => meet(x => [x, y, z], S.cx, S.cx + side * 6);

/** The way into the room from the wall at (x, y, z): [x, y, z], length 1 (the way the wall's face looks). */
export function wallNormal(x, y, z) {
  const e = .002, g = [inside(x + e, y, z) - inside(x - e, y, z), inside(x, y + e, z) - inside(x, y - e, z), inside(x, y, z + e) - inside(x, y, z - e)];
  const l = Math.hypot(...g);
  return l > 1e-9 && Math.hypot(x - S.cx, z - S.cz) > .01 ? g.map(c => c / l) : [0, -1, 0];
}

// the heights of the rings, floor to crown: the cove by its angle, the straight wall, the dome by its angle (about 8 cm
// apart, so a window's edge can be cut close)
function ringHeights() {
  const ups = [];
  for (let k = 0; k <= 7; k++) ups.push(S.cove - Math.cos(k / 7 * Math.PI / 2) * S.cove);
  for (let k = 1; k <= 8; k++) ups.push(S.cove + (S.seam - S.cove) * k / 8);
  const dome = 30;
  for (let k = 1; k < dome; k++) ups.push(S.seam + (S.top - S.seam) * Math.sin(k / dome * Math.PI / 2));
  return ups;
}

/**
 * A window's opening: in the left wall (wall 'side', its outline in z, y) or the back wall ('back', in x, y).
 * sdf(p, q) < 0 inside the opening; at: its middle [p, q]; out: where its reveal ends outside (the x or z of the glass).
 */
const onWall = (wall, p, q) => wall === 'side' ? [sideX(p, q), q, p] : [p, q, backZ(p, q)];
const flat = (wall, pt) => wall === 'side' ? [pt[2], pt[1]] : [pt[0], pt[1]];
/** A rounded rectangle's distance (negative inside): middle mp, mq, half sizes hp, hq, corner radius r. */
export const roundRect = (mp, mq, hp, hq, r) => (p, q) => {
  const dp = Math.abs(p - mp) - hp + r, dq = Math.abs(q - mq) - hq + r;
  return Math.hypot(Math.max(dp, 0), Math.max(dq, 0)) + Math.min(Math.max(dp, dq), 0) - r;
};
export const circle = (mp, mq, r) => (p, q) => Math.hypot(p - mp, q - mq) - r;

/**
 * The room's shell as three.js geometry, with its windows cut out cleanly: { shell, reveals: [geometry per hole],
 * rims: [[ [x, y, z] round each hole's edge, on the wall: where its reveal starts ]], outlines: [the same, evenly] }. holes: [{ wall, sdf, at, out }]. The grid cells round
 * each hole are left out of the shell and filled by a ring of faces from the cells' edge to the hole's own outline, so
 * the edge is a true curve, not steps. Every face looks into the room; the normals are the shape's own (smooth).
 */
export function buildShell(THREE, holes = [], around = 192) {
  const ups = ringHeights(), J = ups.length, I = around;
  const pos = [], nor = [], idx = [];
  const vert = p => { pos.push(...p); nor.push(...wallNormal(...p)); return pos.length / 3 - 1; };
  // the grid: ring j, step i (round, wrapping), then the crown
  const grid = ups.map(y => Array.from({ length: I }, (_, i) => { const phi = i / I * Math.PI * 2, r = shellR(phi, y); return vert([S.cx + Math.cos(phi) * r, y, S.cz + Math.sin(phi) * r]); }));
  const crown = vert([S.cx, S.top, S.cz]);
  const P = k => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
  // which cells each hole takes (with a margin, so the ring of faces round it isn't too thin)
  const skip = new Set(), rings = [], outlines = [];
  for (const h of holes) {
    let i0 = I, i1 = -1, j0 = J, j1 = -1;
    for (let j = 0; j < J - 1; j++) for (let i = 0; i < I; i++) {
      const c = [grid[j][i], grid[j][(i + 1) % I], grid[j + 1][i], grid[j + 1][(i + 1) % I]].map(k => flat(h.wall, P(k)));
      const near = h.wall === 'side' ? P(grid[j][i])[0] < S.cx - .5 : P(grid[j][i])[2] < S.cz - .5;
      if (near && c.some(([p, q]) => h.sdf(p, q) < .07)) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
    }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) skip.add(j * I + i);
    // the cells' edge, once round
    const loop = [];
    for (let i = i0; i <= i1; i++) loop.push(grid[j0][i]);
    for (let j = j0; j <= j1 + 1; j++) loop.push(grid[j][i1 + 1]);
    for (let i = i1; i >= i0; i--) loop.push(grid[j1 + 1][i]);
    for (let j = j1; j > j0; j--) loop.push(grid[j][i0]);
    // each point of it joined to the hole's outline along the line to the hole's middle (in steps)
    const STEPS = 3, cols = loop.map(k => {
      const [p, q] = flat(h.wall, P(k)), dp = p - h.at[0], dq = q - h.at[1], d = Math.hypot(dp, dq);
      let a = 0, b = d;
      for (let n = 0; n < 30; n++) { const m = (a + b) / 2; if (h.sdf(h.at[0] + dp / d * m, h.at[1] + dq / d * m) < 0) a = m; else b = m; }
      const e = [h.at[0] + dp / d * a, h.at[1] + dq / d * a];
      const col = [k];
      for (let s = 1; s <= STEPS; s++) { const u = s / STEPS; col.push(vert(onWall(h.wall, p + (e[0] - p) * u, q + (e[1] - q) * u))); }
      return col;
    });
    for (let c = 0; c < cols.length; c++) {
      const A = cols[c], B = cols[(c + 1) % cols.length];
      for (let s = 0; s < STEPS; s++) idx.push(A[s], B[s], A[s + 1], B[s], B[s + 1], A[s + 1]);
    }
    rings.push(cols.map(col => P(col[STEPS])));
    // (and the outline again, evenly round, for a frame to follow)
    outlines.push(Array.from({ length: 160 }, (_, n) => {
      const a = n / 160 * Math.PI * 2, dp = Math.cos(a), dq = Math.sin(a);
      let lo = 0, hi = 3;
      for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (h.sdf(h.at[0] + dp * m, h.at[1] + dq * m) < 0) lo = m; else hi = m; }
      return onWall(h.wall, h.at[0] + dp * lo, h.at[1] + dq * lo);
    }));
  }
  for (let j = 0; j < J - 1; j++) for (let i = 0; i < I; i++) {
    if (skip.has(j * I + i)) continue;
    const a = grid[j][i], b = grid[j][(i + 1) % I], c = grid[j + 1][i], d = grid[j + 1][(i + 1) % I];
    idx.push(a, b, c, b, d, c);
  }
  for (let i = 0; i < I; i++) idx.push(grid[J - 1][i], grid[J - 1][(i + 1) % I], crown);
  const shell = facing(THREE, pos, idx, nor, null);
  // each hole's reveal: from its outline on the wall straight out to the glass
  const reveals = holes.map((h, n) => {
    const rim = rings[n], p2 = [], i2 = [];
    for (const pt of rim) { p2.push(...pt); p2.push(...(h.wall === 'side' ? [h.out, pt[1], pt[2]] : [pt[0], pt[1], h.out])); }
    for (let c = 0; c < rim.length; c++) { const a = c * 2, b = ((c + 1) % rim.length) * 2; i2.push(a, b, a + 1, b, b + 1, a + 1); }
    // (its faces look in, towards the line through the hole's middle)
    const g = facing(THREE, p2, i2, null, (x, y, z) => h.wall === 'side' ? [0, h.at[1] - y, h.at[0] - z] : [h.at[0] - x, h.at[1] - y, 0]);
    return g;
  });
  return { shell, reveals, rims: rings, outlines };
}

// geometry from points and triangles, each triangle turned to face the way want(x, y, z) says (or the given normals)
function facing(THREE, pos, idx, nor, want) {
  const v = k => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
  for (let t = 0; t < idx.length; t += 3) {
    const a = v(idx[t]), b = v(idx[t + 1]), c = v(idx[t + 2]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const k = idx[t] * 3, d = want ? want(...m) : [nor[k], nor[k + 1], nor[k + 2]];   // (the shape's own normal at a corner is near enough)
    if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] < 0) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  if (nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); else g.computeVertexNormals();
  // (uv from where each point is, a metre a unit: for any surface detail the paint gets)
  const uv = [];
  for (let k = 0; k < pos.length / 3; k++) uv.push(Math.atan2(pos[k * 3 + 2] - S.cz, pos[k * 3] - S.cx) * 2.2, pos[k * 3 + 1]);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
