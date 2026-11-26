// What the 3D generator really made, in words Claude can talk about: the thing, its colours and materials, its parts,
// what it stands on, its size, and any words of the request that did not come through. Read from the recipe the
// generator keeps on what it makes (userData.generatedSpec) and from the names of the parts it built.

const COLOURS = [
  ['black', '#111111'], ['charcoal', '#3a3a3c'], ['grey', '#8a8a8a'], ['silver', '#c4c8cc'], ['white', '#f4f2ee'], ['cream', '#efe4c8'],
  ['red', '#c82028'], ['dark red', '#781818'], ['pink', '#ec7fae'], ['hot pink', '#ff3c96'], ['orange', '#e8742a'], ['peach', '#f4b48a'],
  ['yellow', '#f2d03a'], ['gold', '#d4a537'], ['brown', '#7a5030'], ['tan', '#b08a5e'], ['green', '#3a9a48'], ['dark green', '#1e5a2a'],
  ['lime', '#9ad040'], ['teal', '#2a9a96'], ['light blue', '#8ac4ec'], ['blue', '#2a66c8'], ['steel blue', '#6098b8'], ['navy', '#1c2c64'],
  ['purple', '#7a3ab8'], ['lilac', '#b89ae0'],
];
const rgb = h => { const n = parseInt(String(h).replace('#', '').slice(0, 6), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const COL = COLOURS.map(([name, hex]) => [name, rgb(hex)]);
/** The nearest plain colour name for a hex colour. */
export function colourName(hex) {
  if (!hex || typeof hex !== 'string' || !/^#?[0-9a-f]{6}/i.test(hex)) return null;
  const [r, g, b] = rgb(hex); let best = null, bd = Infinity;
  for (const [name, [R, G, B]] of COL) { const d = 2 * (r - R) ** 2 + 4 * (g - G) ** 2 + 3 * (b - B) ** 2; if (d < bd) { bd = d; best = name; } }
  return best;
}

// the generator's material recipes in plain words
const MATERIAL = { brushed: 'metal', metal: 'metal', chrome: 'chrome', plastic: '', paint: 'paint', wood: 'wood', planks: 'wooden planks', fabric: 'fabric',
  stone: 'stone', brick: 'brick', glass: 'glass', fur: 'fur', scales: 'scales', leather: 'leather', rubber: 'rubber', ceramic: 'ceramic', gold: 'gold' };
const look = ([name, o = {}]) => {
  const c = colourName(o.colour), m = MATERIAL[name] ?? name;
  return [o.glow ? 'glowing' : '', c, m].filter(Boolean).join(' ') || null;
};

// the parts it builds for animals and vehicles, by the names it gives them
const PARTS = [[/^head$/, 'a head'], [/^jaw$/, 'a mouth'], [/^leg[A-Z]/, n => `${n} legs`], [/^wing[LR]$/, n => `${n} wings`], [/^tail1$/, 'a tail'],
  [/^door[LR]$/, n => n > 1 ? `${n} doors` : 'a door'], [/^lamp[LR]$/, 'headlamps'], [/^bumper/, 'bumpers'], [/^steering$/, 'a steering wheel'],
  [/^(driver|passenger)$/, 'seats'], [/^exhaust$/, 'an exhaust pipe'], [/^horn/, 'horns'], [/^ear[LR]?$/, 'ears'], [/^fur\d$/, 'fur'],
  [/^wheel/, 'wheels'], [/^sail/, 'sails'], [/^mast/, 'a mast'], [/^glow$/, 'a glow']];
function partsOf(thing) {
  const seen = new Map();
  thing.traverse?.(o => { for (const [re, say] of PARTS) if (o.name && re.test(o.name)) { seen.set(say, (seen.get(say) || 0) + 1); break; } });
  return [...seen].map(([say, n]) => typeof say === 'function' ? say(n) : say).filter((v, i, a) => a.indexOf(v) === i);
}

function looksOf(spec) {
  const m = spec.materials;
  let looks = (Array.isArray(m) ? m : m && typeof m === 'object' ? Object.values(m) : []).map(look).filter(Boolean);
  if (!looks.length && Array.isArray(spec.suggested)) looks = spec.suggested.map(look).filter(Boolean);
  if (!looks.length && spec.colour) looks = [colourName(spec.colour)];
  return [...new Set(looks)].slice(0, 3);
}
const kindOf = spec => String(spec.kind || spec.thing || spec.as || spec.look || 'thing').replace(/^\w+:/, '');

/** A short name for the prop ("a gold dragon"), and a full description for Claude. size: metres, its longest side. */
export function describe(thing, words, { size = null, read = null, asked = words } = {}) {
  const spec = thing?.userData?.generatedSpec || thing?.userData?.assetSpec || {};
  const kind = kindOf(spec), looks = looksOf(spec), first = looks[0] ? looks[0].replace(/ (paint|fabric|scales|fur)$/, '') : '';
  const short = `a ${[first, kind].filter(Boolean).join(' ')}`.replace(/^a ([aeiou])/i, 'an $1');
  const w = spec.with, under = w?.spec ? ` ${w.how || 'with'} a ${[looksOf(w.spec)[0], kindOf(w.spec)].filter(Boolean).join(' ')}` : '';
  let text = `${short}${under}.`;
  if (looks.length > 1 || (looks[0] && looks[0] !== first)) text += ` Its colours and materials: ${looks.join(', ')}.`;
  const parts = partsOf(thing); if (parts.length) text += ` It has ${parts.join(', ')}.`;
  if (size) text += ` It is in your hands at toy size, about ${Math.round(size * 100)} cm across.`;
  // the words of the request that do not show in what was made (a style or material it does not do yet)
  const shown = (text + ' ' + (read?.swaps || []).map(s => `${s.word} ${s.as}`).join(' ')).toLowerCase();
  const STOP = new Set(['a', 'an', 'the', 'of', 'made', 'with', 'and', 'on', 'in', 'some', 'it', 'its', 'me', 'my', 'make', 'out', 'very', 'really', 'little', 'big', 'small', 'tiny', 'huge', 'giant', 'bigger', 'smaller', 'cute']);
  // (a word shows if it or its stem does: wooden → wood, glowing → glow, furry → fur, golden → gold)
  const stems = x => [x, x.replace(/s$/, ''), x.replace(/en$/, ''), x.replace(/ing$/, ''), x.replace(/(.)\1?y$/, '$1')].filter(y => y.length > 2);
  const missing = String(asked).toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(x => x && !STOP.has(x) && !stems(x).some(y => shown.includes(y)));
  if (missing.length) text += ` These words did not come through in it: ${missing.join(', ')}.`;
  const unknown = (read?.unknown || []).filter(x => String(asked).toLowerCase().includes(String(x).toLowerCase()));
  if (unknown.length) text += ` The maker did not know: ${unknown.join(', ')}.`;
  return { short, text };
}
