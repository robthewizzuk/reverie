// What the 3D generator really made, in accurate, vivid words Claude can talk about:
//   - What it actually is (preferring spec.thing over generic spec.kind, plus counts, lists, places, crests, styles)
//   - Its real colours, materials, and surface finishes (combining generatedSpec with actual Three.js mesh materials,
//     weighted by mesh size so tiny details don't drown out the main body)
//   - Its visible parts (from both object names and userData.part)
//   - Its actual 3D proportions (tall, wide, flat, compact) and size in cm
//   - Only genuinely missing / unknown words from the request (avoiding false alarms)

const COLOURS = [
  ['black', '#111111'], ['charcoal', '#383a3f'], ['dark grey', '#5e6268'], ['grey', '#8d9196'], ['silver', '#c7ccd1'],
  ['white', '#f5f4f0'], ['ivory', '#f2ead8'], ['cream', '#ecdcb8'], ['beige', '#d4be98'],
  ['maroon', '#6e1620'], ['dark red', '#8c1a1c'], ['red', '#cc242b'], ['crimson', '#dc143c'], ['coral', '#f06e5a'],
  ['pink', '#ec82b2'], ['hot pink', '#ff3b96'], ['rose', '#d85c7f'],
  ['orange', '#e87424'], ['amber', '#e89d24'], ['peach', '#f4b68c'],
  ['yellow', '#f2d238'], ['gold', '#d6a634'], ['bronze', '#a8703c'], ['copper', '#c86d44'],
  ['dark brown', '#4a301e'], ['brown', '#7a5030'], ['tan', '#b48c60'],
  ['olive', '#6e7a34'], ['dark green', '#1e5a2a'], ['green', '#3a9a48'], ['emerald', '#249c68'], ['lime', '#98d23c'], ['mint', '#8ee2be'],
  ['teal', '#249694'], ['turquoise', '#38c4c0'], ['cyan', '#38d8f0'],
  ['light blue', '#8cc6ee'], ['sky blue', '#5aaae6'], ['steel blue', '#5c8fb0'], ['blue', '#2864c8'], ['navy', '#1a2c64'],
  ['indigo', '#4238a8'], ['purple', '#7a3ab8'], ['violet', '#9452d6'], ['lilac', '#bc9ee2'], ['magenta', '#d438a8'],
];
const rgb = h => { const n = parseInt(String(h).replace('#', '').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const COL = COLOURS.map(([name, hex]) => [name, rgb(hex)]);

/** The nearest plain colour name for a hex colour (or { r, g, b } 0..1 Three.js Color). */
export function colourName(hex) {
  if (hex && typeof hex === 'object' && typeof hex.r === 'number') {
    const c = hex.clone ? hex.clone().convertLinearToSRGB?.() || hex : hex;
    const toHex = x => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, '0');
    hex = '#' + toHex(c.r) + toHex(c.g) + toHex(c.b);
  }
  if (!hex || typeof hex !== 'string' || !/^#?[0-9a-f]{6}/i.test(hex)) return null;
  const [r, g, b] = rgb(hex);
  let best = null, bd = Infinity;
  for (const [name, [R, G, B]] of COL) {
    const d = 2 * (r - R) ** 2 + 4 * (g - G) ** 2 + 3 * (b - B) ** 2;
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

const MATERIAL = {
  brushed: 'brushed metal', metal: 'metal', chrome: 'chrome', plastic: 'plastic', paint: 'painted',
  wood: 'wood', planks: 'wooden planks', fabric: 'fabric', cloth: 'cloth', felt: 'felt',
  stone: 'stone', brick: 'brick', glass: 'glass', crystal: 'crystal', ice: 'ice',
  fur: 'fur', scales: 'scales', leather: 'leather', rubber: 'rubber', ceramic: 'ceramic',
  gold: 'gold', silver: 'silver', copper: 'copper', bronze: 'bronze', candy: 'candy',
  paper: 'paper', cardboard: 'cardboard', clay: 'clay', porcelain: 'porcelain',
};

const look = x => {
  const [name, o = {}] = Array.isArray(x) ? x : typeof x === 'string' ? [x] : x && typeof x === 'object' ? [x.name ?? x.recipe ?? '', x] : [''];
  const c = colourName(o.colour || o.color);
  const m = MATERIAL[String(name || '').toLowerCase()] ?? (typeof name === 'string' && name.length < 24 ? name : '');
  return [o.glow ? 'glowing' : '', c, m && m !== c ? m : ''].filter(Boolean).join(' ') || null;
};

// Broad part recognition from both mesh/group names and userData.part
const PARTS = [
  [/^head$/i, 'a head'], [/^jaw$|^mouth$/i, 'a mouth'], [/^beak$/i, 'a beak'], [/^eye[LR\d]?$/i, 'eyes'],
  [/^leg[A-Z\d]/i, n => `${n} legs`], [/^wing[LR\d]?$/i, n => n > 1 ? `${n} wings` : 'wings'],
  [/^fin[LR\d]?$/i, 'fins'], [/^tail/i, 'a tail'], [/^horn/i, 'horns'], [/^ear[LR\d]?$/i, 'ears'], [/^fur\d*$/i, 'fur'],
  [/^door[LR\d]?$/i, n => n > 1 ? `${n} doors` : 'a door'], [/^window/i, 'windows'], [/^roof$/i, 'a roof'], [/^chimney$/i, 'a chimney'],
  [/^lamp[LR]?$|^headlight/i, 'headlamps'], [/^bumper/i, 'bumpers'], [/^steering$/i, 'a steering wheel'],
  [/^(driver|passenger|seat)/i, 'seats'], [/^exhaust$/i, 'an exhaust pipe'], [/^wheel/i, n => n > 1 ? `${n} wheels` : 'wheels'],
  [/^sail/i, 'sails'], [/^mast/i, 'a mast'], [/^rotor|^blade|^propeller/i, 'spinning blades'],
  [/^spout$/i, 'a spout'], [/^handle/i, 'a handle'], [/^lid$|^hatch$/i, 'an opening lid'],
  [/^cannon/i, 'cannons'], [/^turret/i, 'a turret'], [/^petal/i, 'petals'], [/^leaf|^leaves/i, 'leaves'],
  [/^trunk$/i, 'a trunk'], [/^glow$/i, 'a glowing core'], [/^flame|^fire/i, 'flames'],
];

function partsOf(thing) {
  const seen = new Map();
  thing?.traverse?.(o => {
    const names = [o.name, o.userData?.part].filter(Boolean);
    for (const nm of names) {
      for (const [re, say] of PARTS) {
        if (re.test(nm)) { seen.set(say, (seen.get(say) || 0) + 1); break; }
      }
    }
  });
  return [...seen].map(([say, n]) => typeof say === 'function' ? say(n) : say).filter((v, i, a) => a.indexOf(v) === i).slice(0, 8);
}

/** Inspects actual Three.js meshes in `thing` for dominant colours (including instanceColor & vertexColors), finishes, and bounding proportions. */
function inspectMeshes(thing) {
  const colourWeights = new Map();
  let glowing = false, glossy = false, metallic = false, transparent = false, hasBricks = false, meshCount = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const addCol = (c, w) => {
    const cn = colourName(c);
    if (cn) colourWeights.set(cn, (colourWeights.get(cn) || 0) + w);
  };
  const linToSrgb = x => x <= .0031308 ? x * 12.92 : 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - .055;
  const sampleAttr = (attr, total, w) => {
    const n = Math.min(total, 64), step = Math.max(1, Math.floor(total / n));
    let sampled = 0;
    for (let i = 0; i < total; i += step) sampled++;
    const each = w / Math.max(1, sampled);
    for (let i = 0; i < total; i += step) {
      const r = attr.getX ? attr.getX(i) : attr.array[i * 3];
      const g = attr.getY ? attr.getY(i) : attr.array[i * 3 + 1];
      const b = attr.getZ ? attr.getZ(i) : attr.array[i * 3 + 2];
      addCol({ r: linToSrgb(r), g: linToSrgb(g), b: linToSrgb(b) }, each);
    }
  };

  thing?.traverse?.(m => {
    if (!m.isMesh && !m.isInstancedMesh) return;
    meshCount++;
    if (/brick|stud|lego/i.test(m.name || '') || m.userData?.bricks) hasBricks = true;
    let weight = 1;
    const g = m.geometry;
    if (g) {
      if (!g.boundingBox && typeof g.computeBoundingBox === 'function') g.computeBoundingBox();
      const bb = g.boundingBox;
      if (bb) {
        const sx = Math.abs(bb.max.x - bb.min.x) * Math.abs(m.scale?.x ?? 1);
        const sy = Math.abs(bb.max.y - bb.min.y) * Math.abs(m.scale?.y ?? 1);
        const sz = Math.abs(bb.max.z - bb.min.z) * Math.abs(m.scale?.z ?? 1);
        weight = Math.max(.05, sx * sy + sy * sz + sx * sz);
        const px = m.position?.x || 0, py = m.position?.y || 0, pz = m.position?.z || 0;
        minX = Math.min(minX, px + bb.min.x); maxX = Math.max(maxX, px + bb.max.x);
        minY = Math.min(minY, py + bb.min.y); maxY = Math.max(maxY, py + bb.max.y);
        minZ = Math.min(minZ, pz + bb.min.z); maxZ = Math.max(maxZ, pz + bb.max.z);
      }
    }
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    const hasInstCol = !!(m.isInstancedMesh && m.instanceColor && m.count > 0);
    const hasVertCol = !!(g?.attributes?.color?.count > 0 && mats.some(mt => mt?.vertexColors));

    if (hasInstCol) sampleAttr(m.instanceColor, m.count, weight * Math.min(m.count, 50));
    else if (hasVertCol) sampleAttr(g.attributes.color, g.attributes.color.count, weight);

    for (const mat of mats) {
      if (!mat) continue;
      // Only treat as glowing if emissive colour is actually non-black (Three.js defaults emissiveIntensity to 1 with black emissive!)
      const em = mat.emissive;
      const emLum = em ? (em.r + em.g + em.b) : 0;
      if (emLum > .08 && (mat.emissiveIntensity ?? 1) * emLum > .18) glowing = true;
      if (mat.metalness > .55) metallic = true;
      if (mat.roughness != null && mat.roughness < .28 && !metallic) glossy = true;
      if (mat.transparent && mat.opacity != null && mat.opacity < .85) transparent = true;
      // Skip pure white mat.color when it's just the neutral multiplier for vertexColors / instanceColor
      const isNeutralWhite = (hasInstCol || hasVertCol) && mat.color && mat.color.r > .92 && mat.color.g > .92 && mat.color.b > .92;
      if (!isNeutralWhite && mat.color) addCol(mat.color, weight);
    }
  });

  const topColours = [...colourWeights.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 3);
  let shape = '';
  if (Number.isFinite(minX) && maxX > minX) {
    const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    const horiz = Math.max(dx, dz, 1e-4);
    if (dy > horiz * 1.45) shape = 'tall and upright';
    else if (dy < horiz * .45) shape = 'low and wide';
    else if (Math.max(dx, dz) > Math.min(dx, dz) * 1.6) shape = 'long';
    else shape = 'compact';
  }
  const finishes = [];
  if (glowing) finishes.push('glowing');
  if (transparent) finishes.push('translucent/glassy');
  if (metallic) finishes.push('metallic');
  else if (glossy) finishes.push('glossy');
  return { topColours, finishes, shape, hasBricks, meshCount };
}

function looksOf(spec, meshInfo) {
  const m = spec.materials;
  let looks = (Array.isArray(m) ? m : m && typeof m === 'object' ? Object.values(m) : []).map(look).filter(Boolean);
  if (!looks.length && Array.isArray(spec.suggested)) looks = spec.suggested.map(look).filter(Boolean);
  if (!looks.length && (spec.colour || spec.color)) looks = [colourName(spec.colour || spec.color)].filter(Boolean);
  if (!looks.length && meshInfo?.topColours?.length) looks = meshInfo.topColours.slice();
  else if (meshInfo?.topColours?.length) {
    for (const c of meshInfo.topColours) if (!looks.some(l => l.includes(c))) looks.push(c);
  }
  return [...new Set(looks)].slice(0, 4);
}

const GENERIC_KINDS = new Set(['thing', 'prop', 'object', 'item', 'mesh', 'group', 'model', 'asset']);
const MATERIAL_KINDS = new Set(['brick', 'stone', 'wood', 'timber', 'metal', 'plastic', 'glass', 'punched', 'block', 'voxel']);
const NOUN_SKIP = new Set(['a', 'an', 'the', 'my', 'some', 'lego', 'toy', 'wooden', 'brick', 'stone', 'metal', 'gold', 'golden', 'silver', 'red', 'blue', 'green', 'yellow', 'brown', 'black', 'white', 'grey', 'gray', 'dark', 'light', 'big', 'small', 'tiny', 'little', 'huge', 'giant', 'glowing', 'shiny', 'cute', 'cool', 'old', 'new', 'of', 'with', 'in', 'on', 'made', 'from', 'out']);

const askedNoun = asked => {
  const ws = String(asked || '').toLowerCase().replace(/[^a-z ]+/g, ' ').trim().split(/\s+/).filter(w => w.length > 2 && !NOUN_SKIP.has(w));
  return ws.at(-1) || '';
};

const kindOf = (spec, asked = '') => {
  const raw = [spec.thing, spec.name, spec.kind, spec.as, spec.look]
    .map(v => typeof v === 'string' ? v.replace(/^\w+:/, '').trim() : '')
    .filter(Boolean);
  const picked = raw.find(v => !GENERIC_KINDS.has(v.toLowerCase())) || raw[0] || '';
  if (!picked || MATERIAL_KINDS.has(picked.toLowerCase())) {
    const noun = askedNoun(asked);
    if (noun && noun !== picked.toLowerCase()) return picked && picked !== 'punched' ? `${picked} ${noun}` : noun;
  }
  return picked || 'thing';
};

const styleOf = (spec, meshInfo = null, asked = '') => {
  const s = spec.style || spec.drawn
    || (spec.brick || spec.lego || meshInfo?.hasBricks || /\blego\b/i.test(asked) ? 'lego' : '')
    || (spec.voxel || spec.pixel ? 'pixel/voxel' : '');
  return typeof s === 'string' && s && s !== 'normal' && s !== 'default' ? s : '';
};

/** A short name for the prop ("a gold dragon"), and an accurate, grounded description for Claude. */
export function describe(thing, words, { size = null, read = null, asked = words } = {}) {
  const spec = thing?.userData?.generatedSpec || thing?.userData?.assetSpec || {};
  const meshInfo = inspectMeshes(thing);
  const kind = kindOf(spec, asked);
  const looks = looksOf(spec, meshInfo);
  const style = styleOf(spec, meshInfo, asked);
  const first = looks[0] ? looks[0].replace(/ (painted|plastic|fabric|scales|fur)$/, '') : '';

  let short;
  if (spec.count?.n > 1) {
    const noun = kind.endsWith('s') ? kind : `${kind}s`;
    short = `${spec.count.n} ${[style, first, noun].filter(Boolean).join(' ')}`;
  } else if (Array.isArray(spec.list) && spec.list.length > 1) {
    short = spec.list.slice(0, 3).map(s => `a ${kindOf(s)}`).join(' and ');
  } else {
    short = `a ${[style, first, kind].filter(Boolean).join(' ')}`.replace(/^a ([aeiou])/i, 'an $1');
  }

  const w = spec.with;
  const underParts = [];
  if (w?.spec) underParts.push(`${w.how || 'with'} a ${[looksOf(w.spec, null)[0], kindOf(w.spec)].filter(Boolean).join(' ')}`);
  if (w?.crest) underParts.push(`decorated with a ${typeof w.crest === 'string' ? w.crest : w.crest.name || 'crest'} emblem`);
  if (spec.place?.name) underParts.push(`set in a ${spec.place.name} scene`);
  const under = underParts.length ? ' ' + underParts.join(', ') : '';

  let text = `${short}${under}.`;
  if (looks.length > 1 || (looks[0] && looks[0] !== first)) text += ` Colours & materials: ${looks.join(', ')}.`;
  if (meshInfo.finishes.length) text += ` Finish: ${meshInfo.finishes.join(', ')}.`;
  const parts = partsOf(thing);
  if (parts.length) text += ` Visible parts: ${parts.join(', ')}.`;
  if (size) text += ` Proportions: ${meshInfo.shape ? `${meshInfo.shape}, ` : ''}about ${Math.round(size * 100)} cm across in your hands.`;

  // Words of the request that genuinely did not come through
  const shown = [
    text,
    spec.domain || '', spec.family || '', style,
    ...(read?.swaps || []).map(s => `${s.word} ${s.as}`),
  ].join(' ').toLowerCase();
  const STOP = new Set(['a', 'an', 'the', 'of', 'made', 'with', 'and', 'on', 'in', 'some', 'it', 'its', 'me', 'my', 'make', 'out', 'very', 'really', 'little', 'big', 'small', 'tiny', 'huge', 'giant', 'bigger', 'smaller', 'cute', 'nice', 'cool', 'two', 'three', 'four', 'five']);
  const stems = x => [x, x.replace(/s$/, ''), x.replace(/es$/, ''), x.replace(/en$/, ''), x.replace(/ed$/, ''), x.replace(/ing$/, ''), x.replace(/(.)\1?y$/, '$1')].filter(y => y.length > 2);
  const missing = String(asked || '').toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(x => x && !STOP.has(x) && !stems(x).some(y => shown.includes(y)));
  if (missing.length) text += ` Not reflected in the 3D model: ${missing.join(', ')}.`;
  const unknown = (read?.unknown || []).filter(x => String(asked || '').toLowerCase().includes(String(x).toLowerCase()));
  if (unknown.length) text += ` The 3D maker did not know: ${unknown.join(', ')}.`;
  return { short, text };
}
