// Procedural photorealistic PBR texture sets (colour variation, roughness, bump) generated once on offscreen
// canvases with zero external asset downloads. Used by world.js for limewash plaster walls, woven wool rug,
// linen pouf, glazed ceramic vase/pot, and brushed brass mirror frame.

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Fast deterministic PRNG so surface grain is crisp and consistent across reloads
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function asTex(THREE, canvas, repeat = [1, 1], srgb = false) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 8;
  if (srgb && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const cache = new Map();

/** Soft limewash plaster micro-grain bump + roughness map for workshop walls. */
export function plasterMaps(THREE) {
  if (cache.has('plaster')) return cache.get('plaster');
  const S = 256, rng = mulberry32(101);
  const bump = makeCanvas(S, S), rough = makeCanvas(S, S);
  const bc = bump.getContext('2d'), rc = rough.getContext('2d');
  bc.fillStyle = '#808080'; bc.fillRect(0, 0, S, S);
  rc.fillStyle = '#dcdcdc'; rc.fillRect(0, 0, S, S);
  // Broad soft trowel clouds
  for (let i = 0; i < 65; i++) {
    const x = rng() * S, y = rng() * S, r = 24 + rng() * 54;
    const g = bc.createRadialGradient(x, y, 2, x, y, r);
    const v = Math.round(114 + rng() * 28);
    g.addColorStop(0, `rgba(${v},${v},${v},.18)`);
    g.addColorStop(1, 'rgba(128,128,128,0)');
    bc.fillStyle = g; bc.beginPath(); bc.arc(x, y, r, 0, Math.PI * 2); bc.fill();
    const rv = Math.round(205 + rng() * 38);
    const rg = rc.createRadialGradient(x, y, 2, x, y, r);
    rg.addColorStop(0, `rgba(${rv},${rv},${rv},.22)`);
    rg.addColorStop(1, 'rgba(220,220,220,0)');
    rc.fillStyle = rg; rc.beginPath(); rc.arc(x, y, r, 0, Math.PI * 2); rc.fill();
  }
  // Fine mineral grain
  const img = bc.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - .5) * 18;
    d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, d[i] + n));
  }
  bc.putImageData(img, 0, 0);
  const out = { bumpMap: asTex(THREE, bump, [5, 3]), roughnessMap: asTex(THREE, rough, [5, 3]) };
  cache.set('plaster', out);
  return out;
}

/** Tactile woven wool yarn bump + roughness map for the round rug and pouf. */
export function weaveMaps(THREE, repeat = [10, 10]) {
  const key = 'weave:' + repeat.join(',');
  if (cache.has(key)) return cache.get(key);
  const S = 128, rng = mulberry32(202);
  const bump = makeCanvas(S, S), rough = makeCanvas(S, S);
  const bc = bump.getContext('2d'), rc = rough.getContext('2d');
  bc.fillStyle = '#686868'; bc.fillRect(0, 0, S, S);
  rc.fillStyle = '#ececec'; rc.fillRect(0, 0, S, S);
  const step = 8;
  for (let y = 0; y < S; y += step) {
    for (let x = 0; x < S; x += step) {
      const horiz = ((x / step) + (y / step)) % 2 === 0;
      const v = Math.round(145 + rng() * 45);
      bc.fillStyle = `rgb(${v},${v},${v})`;
      if (horiz) bc.fillRect(x + 1, y + 2, step - 2, step - 4);
      else bc.fillRect(x + 2, y + 1, step - 4, step - 2);
      const rv = Math.round(220 + rng() * 30);
      rc.fillStyle = `rgb(${rv},${rv},${rv})`;
      rc.fillRect(x, y, step, step);
    }
  }
  const out = { bumpMap: asTex(THREE, bump, repeat), roughnessMap: asTex(THREE, rough, repeat) };
  cache.set(key, out);
  return out;
}

/** Directional brushed brass roughness + bump map for the mirror frame. */
export function brushedBrassMaps(THREE) {
  if (cache.has('brass')) return cache.get('brass');
  const S = 128, rng = mulberry32(303);
  const bump = makeCanvas(S, S), rough = makeCanvas(S, S);
  const bc = bump.getContext('2d'), rc = rough.getContext('2d');
  bc.fillStyle = '#808080'; bc.fillRect(0, 0, S, S);
  rc.fillStyle = '#424242'; rc.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y++) {
    const v = Math.round(115 + rng() * 26);
    bc.fillStyle = `rgb(${v},${v},${v})`; bc.fillRect(0, y, S, 1);
    const rv = Math.round(48 + rng() * 34);
    rc.fillStyle = `rgb(${rv},${rv},${rv})`; rc.fillRect(0, y, S, 1);
  }
  const out = { bumpMap: asTex(THREE, bump, [2, 4]), roughnessMap: asTex(THREE, rough, [2, 4]) };
  cache.set('brass', out);
  return out;
}

/** Subtle potter's wheel ceramic rings bump map for the vase, mug, and planter. */
export function ceramicBump(THREE) {
  if (cache.has('ceramic')) return cache.get('ceramic');
  const S = 128, rng = mulberry32(404);
  const bump = makeCanvas(S, S), bc = bump.getContext('2d');
  for (let y = 0; y < S; y++) {
    const wave = Math.sin(y * .7) * 14 + (rng() - .5) * 10;
    const v = Math.round(128 + wave);
    bc.fillStyle = `rgb(${v},${v},${v})`; bc.fillRect(0, y, S, 1);
  }
  const tex = asTex(THREE, bump, [1, 3]);
  cache.set('ceramic', tex);
  return tex;
}
