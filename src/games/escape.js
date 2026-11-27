// Escape Room: a magic door appears in Reverie's room, locked with number dials, and you have to find the code.
// The numbers are on notes hidden round the room: under things on the floor (tap them to lift them), in a chest that
// needs a key, in a colour box whose wheels the painting tells you how to set, behind a row of lanterns that must all
// be lit at once, and one note that only asks a question ("how many candles?"). Set the dials and the door swings open.
//
// Who does what: the game makes the puzzle (a new one every round, from a theme and the level), checks every lock and
// writes the hints, so they are always true; Reverie is your fellow prisoner, cheering finds and giving each hint in its
// own words when you ask (the Hint button, or just "can I have a clue?"), a little stronger each time.
//
// Tap the door, the colour box or the painting to go up close, Back to step away. A game here is an object the stage
// drives (see ./index.js for the shape every game has).
import gs from '../../engine/src/gamescroll.js';
import { clock, popIn, ease, words } from './parts.js';

// the seat the camera takes: back and up, to see most of the room at once
export const CAMERA = { pos: [0, 1.72, 2.2], look: [0, .32, -.45] };
const KEEP = 'reverie.escape.v1';   // best times, by level (this browser)

/** The door's dials are marked with these, in order; each note says which dial its number is for. */
export const SYMS = [{ id: 'star', ch: '★' }, { id: 'moon', ch: '☾' }, { id: 'heart', ch: '♥' }, { id: 'diamond', ch: '◆' }];
/** The colour box's colours, in the order a wheel turns through them. */
export const COLOURS = [['red', '#e0453a'], ['yellow', '#f2c230'], ['green', '#3fae5a'], ['blue', '#3d7fe0'], ['purple', '#9a5ad8']];
/** The shapes on the painting and on the box's wheels (level 3 and up). */
const SHAPES = ['circle', 'triangle', 'square', 'drop'];
// things on the floor that can hide something: the words the generator makes them from, and what we call them
const HIDERS = [['a flower pot', 'flower pot'], ['a teapot', 'teapot'], ['a stack of books', 'pile of books'], ['a top hat', 'top hat'],
  ['a wicker basket', 'basket'], ['a watering can', 'watering can'], ['a bucket', 'bucket'], ['a cooking pot', 'cooking pot'], ['a toy drum', 'toy drum']];
// what is under the ones hiding nothing
const NOTHING = ['a dust bunny', 'a lost button', 'one odd sock', 'a very surprised ladybird', 'a jelly bean', 'nothing but dust'];
// the stories: what the door is, the key, the intro and the way out, for Reverie to tell
const THEMES = [
  { id: 'clock', name: "The Clockmaker's Door", door: '#3f7c86', trim: '#d8a94a', key: 'a little brass key',
    intro: 'A tall teal door with a clock face has appeared in your room, ticking, and it has locked you both in. The clockmaker hid the code round the room.',
    out: 'the door chimes like a cuckoo clock and swings open onto a sunny meadow' },
  { id: 'stars', name: 'The Star Gate', door: '#2e3a6e', trim: '#e8d27a', key: 'a silver star key',
    intro: 'A midnight-blue door covered in stars has appeared, humming, and shut you both in. A wizard hid the numbers that open it.',
    out: 'the door bursts into starlight and opens onto the night sky' },
  { id: 'dragon', name: "The Dragon's Pantry", door: '#8a3b32', trim: '#e3b24f', key: 'a dragon-scale key',
    intro: "A round red door has appeared, warm to the touch: a dragon's pantry door, and it has locked you both in. The dragon hides its code in case it forgets.",
    out: 'the door creaks open and a sleepy baby dragon waves you out with a puff of pink smoke' },
];
const TIERS = 3;   // hints a step: a nudge, a pointer, the answer

const pickOf = rnd => a => a[Math.floor(rnd() * a.length)];
const shuffled = (a, rnd) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
/** Tapping lantern i flips it and its neighbours. */
export const flip = (lit, i) => lit.map((on, j) => Math.abs(i - j) <= 1 ? !on : on);
/** The fewest lanterns to tap to light them all, by trying every set (there are at most five). */
export function solveLights(lit) {
  const n = lit.length; let best = null;
  for (let m = 0; m < 1 << n; m++) {
    let s = lit; const taps = [];
    for (let i = 0; i < n; i++) if (m >> i & 1) { s = flip(s, i); taps.push(i); }
    if (s.every(Boolean) && (!best || taps.length < best.length)) best = taps;
  }
  return best;
}

/**
 * A new puzzle for a level (1 to 5): the theme, the code, where each of its numbers is written, what hides under
 * what, and the colour box and lanterns when this level has them. Plain data, so tests can check it.
 *   level 1: two dials; a key and a note under the things on the floor, a note in the chest
 *   level 2: three dials; a colour box with three wheels, set from a painting of stripes
 *   level 3: the painting's colours are by shape, and one note asks a question (count the candles)
 *   level 4: four dials, and a row of four lanterns to light; level 5: more hiding places, five lanterns, four wheels
 */
export function makePuzzle(level = 2, rnd = Math.random) {
  level = Math.max(1, Math.min(5, Math.round(level) || 2));
  const pick = pickOf(rnd);
  const theme = pick(THEMES), dials = level <= 1 ? 2 : level <= 3 ? 3 : 4;
  const code = Array.from({ length: dials }, () => 1 + Math.floor(rnd() * 9));
  // where each dial's note is: under a thing on the floor, in the chest, in the colour box, behind the lanterns
  const places = ['spot', 'chest', 'box', 'lights'].slice(0, dials), order = shuffled(SYMS.slice(0, dials).map((_, i) => i), rnd);
  const notes = places.map((at, k) => ({ at, dial: order[k], count: false }));
  // from level 3, one note (not the first one found) asks how many candles there are, and that many are dotted about
  let candles = 0;
  if (level >= 3) { const n = notes[1 + Math.floor(rnd() * (notes.length - 1))]; n.count = true; code[n.dial] = candles = 2 + Math.floor(rnd() * 5); }
  // the things on the floor: one hides the key, one a note, the rest a joke
  const hiders = shuffled(HIDERS, rnd).slice(0, [3, 4, 4, 5, 6][level - 1]);
  const [keyAt, noteAt] = shuffled(hiders.map((_, i) => i), rnd);
  const spots = hiders.map(([make, name], i) => ({ make, name, holds: i === keyAt ? 'key' : i === noteAt ? 'note' : 'nothing', joke: pick(NOTHING) }));
  // the colour box: wheels, the colours they must show, and (level 3 up) the shape on each wheel
  let box = null;
  if (places.includes('box')) {
    const wheels = level >= 5 ? 4 : 3, want = Array.from({ length: wheels }, () => Math.floor(rnd() * COLOURS.length));
    const shapes = level >= 3 ? shuffled(SHAPES, rnd).slice(0, wheels) : null;
    // the painting shows the shapes in another order than the wheels, so it has to be matched up, not copied
    let painted = shapes ? shuffled(shapes.map((_, i) => i), rnd) : null;
    if (painted && painted.every((p, i) => p === i)) painted = [...painted.slice(1), painted[0]];
    let start; do start = want.map(() => Math.floor(rnd() * COLOURS.length)); while (start.every((c, i) => c === want[i]));
    box = { wheels, want, shapes, painted, start };
  }
  // the lanterns: start from all lit and tap a few, so there is always a way back
  let lights = null;
  if (places.includes('lights')) {
    const n = level >= 5 ? 5 : 4; let lit;
    do { lit = Array(n).fill(true); for (let i = 0; i < n; i++) if (rnd() < .5) lit = flip(lit, i); } while (lit.every(Boolean) || solveLights(lit).length < 2);
    lights = { start: lit };
  }
  return { level, theme, dials, code, notes, candles, spots, box, lights };
}

/** A note's words: "★ = 3", or its question. */
export const noteText = (p, n) => `${SYMS[n.dial].ch} = ${n.count ? 'how many candles?' : p.code[n.dial]}`;
const NUMS = { zero: 0, oh: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9 };
/** The digits in what someone said: "4 7 2", "472", "four seven two". */
export function digitsOf(said) {
  const out = [];
  for (const w of words(said).split(' ')) { if (/^\d+$/.test(w)) out.push(...w.split('').map(Number)); else if (w in NUMS) out.push(NUMS[w]); }
  return out;
}
/** The colours in what someone said, as indexes into COLOURS. */
export const coloursOf = said => words(said).split(' ').map(w => COLOURS.findIndex(c => c[0] === w || c[0] + 's' === w)).filter(i => i >= 0);

export function makeEscape(stage) {
  const { THREE, scene, creature } = stage, { decal, sounds } = gs.tabletop, { rbox, pbr } = gs.hd;
  const clk = clock();
  let root = null, p = null, state = 'off', level = 2, t = 0, time = 0, focus = null, round = 0;
  // what is in the room this round, and what has been done
  let door, dialMeshes = [], spots = [], chest, box, wheelMeshes = [], painting, lanterns = [], candles = [], glowDoor;
  let got = {}, done = {}, dial = [], wheel = [], lit = [], searched = new Set(), hintTier = {}, hintsUsed = 0;
  const alive = my => my === clk.epoch && state !== 'off';
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const shadeAll = o => { o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
  /** An invisible box round a thing: a big, easy target for a finger (the raycaster still sees it). */
  const hitBox = (w, h, d, y = h / 2) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial()); m.visible = false; m.position.y = y; return m; };
  const tagged = (o, kind, i = 0) => { o.userData.esc = { kind, i }; return o; };
  /** A flat picture standing up, facing +z (a decal turned to stand). */
  const sign = (w, h, draw, o = {}) => { const m = decal(w, h, draw, { lift: 0, ...o }); m.rotation.x = Math.PI / 2; return m; };

  // ---- drawing the marks
  function drawSym(c, id, x, y, r, col) {
    c.fillStyle = col; c.beginPath();
    if (id === 'star') for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    else if (id === 'moon') { c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(x + r * .45, y - r * .25, r * .82, 0, Math.PI * 2); c.fill(); c.globalCompositeOperation = 'source-over'; return; }
    else if (id === 'heart') { c.moveTo(x, y + r * .9); c.bezierCurveTo(x - r * 1.5, y - r * .1, x - r * .7, y - r * 1.2, x, y - r * .4); c.bezierCurveTo(x + r * .7, y - r * 1.2, x + r * 1.5, y - r * .1, x, y + r * .9); }
    else if (id === 'diamond' ) { c.moveTo(x, y - r); c.lineTo(x + r * .72, y); c.lineTo(x, y + r); c.lineTo(x - r * .72, y); }
    else if (id === 'circle') c.arc(x, y, r * .85, 0, Math.PI * 2);
    else if (id === 'triangle') { c.moveTo(x, y - r); c.lineTo(x + r * .95, y + r * .7); c.lineTo(x - r * .95, y + r * .7); }
    else if (id === 'square') c.rect(x - r * .75, y - r * .75, r * 1.5, r * 1.5);
    else if (id === 'drop') { c.moveTo(x, y - r); c.bezierCurveTo(x + r * .2, y - r * .4, x + r * .85, y + r * .05, x + r * .85, y + r * .35); c.arc(x, y + r * .35, r * .85, 0, Math.PI); c.bezierCurveTo(x - r * .85, y + r * .05, x - r * .2, y - r * .4, x, y - r); }
    c.closePath(); c.fill();
  }
  /** A note on paper: the dial's mark and its number, or its question. */
  function paintNote(c, w, h, n) {
    c.fillStyle = '#f6ecd2'; c.beginPath(); c.roundRect(4, 4, w - 8, h - 8, 14); c.fill();
    c.strokeStyle = '#d7c49a'; c.lineWidth = 4; c.stroke();
    drawSym(c, SYMS[n.dial].id, w * .22, h * .5, h * .26, '#b0423a');
    c.fillStyle = '#3a2c20'; c.textAlign = 'center'; c.textBaseline = 'middle';
    if (n.count) {
      c.font = `700 ${h * .2}px system-ui, sans-serif`; c.fillText('= how many', w * .64, h * .36); c.fillText('candles?', w * .64, h * .64);
    } else { c.font = `900 ${h * .55}px system-ui, sans-serif`; c.fillText('= ' + p.code[n.dial], w * .64, h * .54); }
  }

  // ---- the room's puzzle pieces, made for each round's puzzle
  function build() {
    root = new THREE.Group(); root.name = 'escape room';
    const { theme } = p, trim = pbr(theme.trim, { rough: .3, metal: .85 });
    // the door: a free-standing frame by the back wall, the door in it hinged at its left, and the dials on it
    door = tagged(new THREE.Group(), 'door'); door.position.set(-.55, 0, -1.15); root.add(door);
    const frameMat = pbr('#efe7da', { rough: .6 }), W = .62, H = 1.36;
    for (const x of [-W / 2 - .04, W / 2 + .04]) { const post = new THREE.Mesh(rbox(.08, H + .08, .12, .02), frameMat); post.position.set(x, (H + .08) / 2, 0); door.add(post); }
    const lintel = new THREE.Mesh(rbox(W + .16, .1, .14, .025), frameMat); lintel.position.y = H + .08; door.add(lintel);
    // what is beyond it: a bright glow, seen when it opens
    glowDoor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), pbr('#fff4d8', { glow: .001, glowCol: '#fff2cc', rough: 1 })); glowDoor.position.set(0, H / 2, -.02); door.add(glowDoor);
    const hinge = new THREE.Group(); hinge.position.set(-W / 2, 0, 0); door.add(hinge); door.userData.hinge = hinge;
    const leaf = new THREE.Mesh(rbox(W, H, .05, .02), pbr(theme.door, { rough: .5, clear: .3 })); leaf.position.set(W / 2, H / 2, 0); hinge.add(leaf);
    for (const [y, h] of [[H * .72, H * .34], [H * .27, H * .34]]) { const panel = new THREE.Mesh(rbox(W * .72, h, .012, .01), pbr(new THREE.Color(theme.door).multiplyScalar(.82).getStyle(), { rough: .55 })); panel.position.set(W / 2, y, .03); hinge.add(panel); }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(.028, 20, 14), trim); knob.position.set(W * .86, H * .48, .05); hinge.add(knob);
    // the lock plate and its dials, a mark over each
    const plate = new THREE.Mesh(rbox(.09 * p.dials + .06, .2, .02, .01), trim); plate.position.set(W / 2, H * .52, .035); hinge.add(plate);
    dialMeshes = SYMS.slice(0, p.dials).map((s, i) => {
      const x = W / 2 + (i - (p.dials - 1) / 2) * .09, g = tagged(new THREE.Group(), 'dial', i); g.position.set(x, H * .52, .048); hinge.add(g);
      const face = sign(.07, .085, (c, w, h) => paintDial(c, w, h, 0), { px: 128 }); face.position.y = -.02; g.add(face); g.userData.face = face;
      const mark = sign(.05, .05, (c, w, h) => drawSym(c, s.id, w / 2, h / 2, w * .4, '#3a2410'), { px: 96 }); mark.position.set(0, .055, .001); g.add(mark);
      g.add(hitBox(.085, .15, .04, 0));
      return g;
    });
    door.add(hitBox(W + .2, H + .15, .2));
    // a ticking clock, stars or a dragon's eye over the door, for the theme
    const badge = sign(.22, .22, (c, w, h) => {
      c.fillStyle = theme.trim; c.beginPath(); c.arc(w / 2, h / 2, w * .46, 0, Math.PI * 2); c.fill();
      c.fillStyle = theme.door; c.beginPath(); c.arc(w / 2, h / 2, w * .38, 0, Math.PI * 2); c.fill();
      if (theme.id === 'clock') { c.strokeStyle = theme.trim; c.lineWidth = w * .04; c.lineCap = 'round'; c.beginPath(); c.moveTo(w / 2, h / 2); c.lineTo(w / 2, h * .22); c.moveTo(w / 2, h / 2); c.lineTo(w * .7, h * .58); c.stroke(); }
      else if (theme.id === 'stars') for (const [x, y, r] of [[.5, .45, .16], [.3, .62, .07], [.7, .64, .08], [.36, .3, .05]]) drawSym(c, 'star', w * x, h * y, w * r, theme.trim);
      else { c.fillStyle = '#f2c230'; c.beginPath(); c.ellipse(w / 2, h / 2, w * .26, h * .16, 0, 0, Math.PI * 2); c.fill(); c.fillStyle = '#2a1408'; c.beginPath(); c.ellipse(w / 2, h / 2, w * .05, h * .14, 0, 0, Math.PI * 2); c.fill(); }
    }, { px: 192, glow: .4 });
    badge.position.set(0, H + .08, .075); door.add(badge);

    // the things on the floor that hide something: a stand-in box at once, the generator's model when it is ready
    const SPOT_AT = [[.45, .42], [-.82, -.25], [.12, -.8], [-.42, -.62], [-.16, .64], [.36, -.25]];
    spots = p.spots.map((s, i) => {
      const g = tagged(new THREE.Group(), 'spot', i); g.position.set(SPOT_AT[i][0], 0, SPOT_AT[i][1]); g.rotation.y = (i * 1.7) % 1 - .5; root.add(g);
      const lift = new THREE.Group(); g.add(lift); g.userData.lift = lift;
      const stand = new THREE.Mesh(rbox(.16, .16, .16, .03), pbr('#b9a58a', { rough: .8 })); stand.position.y = .08; lift.add(stand); g.userData.stand = stand;
      g.add(hitBox(.26, .3, .26));
      return g;
    });
    dressSpots();

    // the chest: a treasure chest with a keyhole, its lid hinged at the back
    chest = tagged(new THREE.Group(), 'chest'); chest.position.set(-.5, 0, .3); chest.rotation.y = .35; root.add(chest);
    const cw = gs.tabletop.wood('#7a4e2c'), band = pbr('#c9a24a', { rough: .35, metal: .85 });
    const shell = new THREE.Mesh(rbox(.32, .17, .21, .015), cw); shell.position.y = .085; chest.add(shell);
    for (const x of [-.1, .1]) { const b = new THREE.Mesh(rbox(.025, .175, .215, .006), band); b.position.set(x, .087, 0); chest.add(b); }
    const lid = new THREE.Group(); lid.position.set(0, .17, -.105); chest.add(lid); chest.userData.lid = lid;
    const lidTop = new THREE.Mesh(new THREE.CylinderGeometry(.105, .105, .32, 24, 1, false, 0, Math.PI), cw); lidTop.rotation.z = Math.PI / 2; lidTop.scale.set(1, 1, .55); lidTop.position.set(0, 0, .105); lid.add(lidTop);
    const lock = new THREE.Mesh(rbox(.05, .06, .015, .006), band); lock.position.set(0, .14, .108); chest.add(lock);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(.007, .007, .02, 10), pbr('#1a1008')); hole.rotation.x = Math.PI / 2; hole.position.set(0, .145, .114); chest.add(hole);
    chest.add(hitBox(.42, .34, .3));

    // the colour box on a little stand (level 2 up): its wheels turn when tapped, and the painting says how to set them
    wheelMeshes = []; box = null; painting = null;
    if (p.box) {
      box = tagged(new THREE.Group(), 'box'); box.position.set(.6, 0, .02); box.rotation.y = -.35; root.add(box);
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(.11, .14, .4, 28), pbr('#e9e2d6', { rough: .7 })); stand.position.y = .2; box.add(stand);
      const bw = .1 * p.box.wheels + .06, body = new THREE.Mesh(rbox(bw, .16, .16, .02), pbr('#5b6b78', { rough: .45, clear: .3 })); body.position.y = .48; box.add(body);
      const blid = new THREE.Group(); blid.position.set(0, .56, -.08); box.add(blid); box.userData.lid = blid;
      const top = new THREE.Mesh(rbox(bw + .01, .03, .165, .01), pbr('#4a5864', { rough: .45 })); top.position.set(0, .015, .08); blid.add(top);
      wheelMeshes = Array.from({ length: p.box.wheels }, (_, i) => {
        const g = tagged(new THREE.Group(), 'wheel', i); g.position.set((i - (p.box.wheels - 1) / 2) * .1, .48, .082); box.add(g);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(.038, .038, .02, 28), pbr(COLOURS[0][1], { rough: .3, clear: .6 })); disc.rotation.x = Math.PI / 2; g.add(disc); g.userData.disc = disc;
        if (p.box.shapes) { const s = sign(.04, .04, (c, w, h) => drawSym(c, p.box.shapes[i], w / 2, h / 2, w * .38, '#ffffff'), { px: 96, glow: .6 }); s.position.z = .011; g.add(s); }
        g.add(hitBox(.09, .09, .05, 0));
        return g;
      });
      box.add(hitBox(bw + .1, .7, .3, .3));
      // the painting on an easel: stripes in order, or (level 3 up) the shapes in their colours, in another order
      painting = tagged(new THREE.Group(), 'painting'); painting.position.set(.38, 0, -.98); painting.rotation.y = -.25; root.add(painting);
      const legMat = gs.tabletop.wood('#9a7048');
      for (const [x, rz] of [[-.17, -.08], [.17, .08]]) { const l = new THREE.Mesh(rbox(.025, 1.02, .025, .006), legMat); l.position.set(x, .5, 0); l.rotation.z = rz; painting.add(l); }
      const back = new THREE.Mesh(rbox(.025, .95, .025, .006), legMat); back.position.set(0, .46, -.16); back.rotation.x = -.32; painting.add(back);
      const ledge = new THREE.Mesh(rbox(.42, .025, .05, .006), legMat); ledge.position.set(0, .52, .02); painting.add(ledge);
      const frame = new THREE.Mesh(rbox(.42, .34, .025, .008), pbr('#d8b86a', { rough: .35, metal: .7 })); frame.position.set(0, .71, .02); painting.add(frame);
      const canvas = sign(.37, .29, (c, w, h) => paintPicture(c, w, h), { px: 384 }); canvas.position.set(0, .71, .034); painting.add(canvas);
      painting.add(hitBox(.5, 1.0, .25));
    }

    // the lanterns (level 4 up): tap one and it and its neighbours flip; all lit, and the base opens
    lanterns = [];
    if (p.lights) {
      const n = p.lights.start.length, base = tagged(new THREE.Group(), 'lights'); base.position.set(.1, 0, .82); root.add(base); root.userData.lights = base;
      const plinth = new THREE.Mesh(rbox(.13 * n, .05, .12, .02), gs.tabletop.wood('#6e4a2e')); plinth.position.y = .025; base.add(plinth);
      lanterns = Array.from({ length: n }, (_, i) => {
        const g = tagged(new THREE.Group(), 'lantern', i); g.position.set((i - (n - 1) / 2) * .13, .05, 0); base.add(g);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, .09, 8), pbr('#3a3a40', { metal: .7, rough: .4 })); post.position.y = .045; g.add(post);
        const glass = new THREE.Mesh(new THREE.SphereGeometry(.035, 20, 14), pbr('#ffd27a', { glow: .001, glowCol: '#ffcc66', rough: .25, clear: .6 })); glass.position.y = .12; g.add(glass); g.userData.glass = glass;
        const cap = new THREE.Mesh(new THREE.ConeGeometry(.03, .03, 16), pbr('#3a3a40', { metal: .7, rough: .4 })); cap.position.y = .165; g.add(cap);
        g.add(hitBox(.12, .22, .12));
        return g;
      });
    }

    // the candles to count (level 3 up), dotted about, a couple of them easy to miss
    const CANDLE_AT = [[-.95, -1.1, 0], [.1, -1.25, 0], [.9, -.95, 0], [.72, .38, 0], [-.2, .32, 0], [.42, -.58, 0], [-.12, -1.08, 0], [-.66, .02, 0]];
    candles = shuffled(CANDLE_AT, Math.random).slice(0, p.candles).map(([x, z, y]) => {
      const g = new THREE.Group(); g.position.set(x, y, z); root.add(g);
      const wax = new THREE.Mesh(new THREE.CylinderGeometry(.018, .02, .08, 16), pbr('#f4ede0', { rough: .7 })); wax.position.y = .04; g.add(wax);
      const flame = new THREE.Mesh(new THREE.SphereGeometry(.011, 12, 8), pbr('#ffcc66', { glow: 3, glowCol: '#ffb347', rough: 1 })); flame.scale.y = 1.7; flame.position.y = .1; g.add(flame); g.userData.flame = flame;
      return g;
    });
    shadeAll(root);
    for (const m of [glowDoor]) m.castShadow = false;
  }

  function paintDial(c, w, h, n) {
    c.fillStyle = '#f4ead4'; c.beginPath(); c.roundRect(3, 3, w - 6, h - 6, 10); c.fill();
    c.fillStyle = '#2a1c10'; c.font = `900 ${h * .7}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(n), w / 2, h * .55);
  }
  function paintPicture(c, w, h) {
    c.fillStyle = '#f7f1e4'; c.fillRect(0, 0, w, h);
    const b = p.box, n = b.wheels;
    if (!b.shapes) {   // stripes, left to right: the wheels' colours in order
      for (let i = 0; i < n; i++) { c.fillStyle = COLOURS[b.want[i]][1]; c.fillRect(w * (.08 + i * .84 / n), h * .1, w * .84 / n - 6, h * .8); }
    } else {           // each shape in its colour, in another order than the wheels
      b.painted.forEach((wi, k) => drawSym(c, b.shapes[wi], w * (k + .5) / n, h * (k % 2 ? .62 : .4), Math.min(w / n, h) * .32, COLOURS[b.want[wi]][1]));
    }
  }

  /** Puts the generator's models on the hiding places as they come (the stand-in boxes go). */
  async function dressSpots() {
    const my = clk.epoch, list = p.spots;
    await Promise.all(list.map(async (s, i) => {
      let thing = null;
      try { thing = await gs.models.generate.make(s.make, { seed: 3 + i * 17 + round }); } catch { return; }
      if (!thing || !alive(my)) return;
      const b = new THREE.Box3().setFromObject(thing), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      const k = .22 / Math.max(.01, size.x, size.y, size.z);
      thing.position.set(-c.x, -b.min.y, -c.z); const g = new THREE.Group(); g.add(thing); g.scale.setScalar(k); shadeAll(g);
      const lift = spots[i].userData.lift; lift.remove(spots[i].userData.stand); lift.add(g);
    }));
  }

  // ---- what you find
  /** A thing found floats up where it was, turns to you, then goes into your pocket. */
  async function float(obj, from, hold = 1.6) {
    const my = clk.epoch; root.add(obj); obj.position.copy(from);
    const to = from.clone().add(v3(0, .3, .06)), cam = v3(...CAMERA.pos);
    await clk.tween(.5, k => { obj.position.lerpVectors(from, to, ease(k)); obj.scale.setScalar(popIn(k)); obj.lookAt(cam); });
    if (!alive(my)) return;
    await clk.wait(hold);
    if (!alive(my)) return;
    stage.sparks(obj.getWorldPosition(v3()), '#ffe2b0', 16);
    await clk.tween(.3, k => obj.scale.setScalar(Math.max(.01, 1 - k)));
    obj.removeFromParent();
  }
  function keyMesh() {
    const g = new THREE.Group(), m = pbr(p.theme.trim, { rough: .25, metal: .9, glow: .25, glowCol: p.theme.trim });
    const bow = new THREE.Mesh(new THREE.TorusGeometry(.022, .007, 10, 24), m); bow.position.x = -.04; g.add(bow);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.005, .005, .08, 8), m); shaft.rotation.z = Math.PI / 2; shaft.position.x = .02; g.add(shaft);
    for (const x of [.04, .052]) { const tooth = new THREE.Mesh(new THREE.BoxGeometry(.007, .018, .006), m); tooth.position.set(x, -.01, 0); g.add(tooth); }
    g.scale.setScalar(1.6); return g;
  }
  const noteMesh = n => { const g = new THREE.Group(); g.add(sign(.17, .1, (c, w, h) => paintNote(c, w, h, n), { px: 320, glow: .15 })); return g; };
  function findNote(at, from) {
    const n = p.notes.find(x => x.at === at); if (!n) return null;
    got['note:' + at] = true; sounds.flip();
    float(noteMesh(n), from, 2.4);
    return n;
  }
  const noteLine = n => n.count ? `a note saying "${SYMS[n.dial].id} = how many candles?"` : `a note saying ${SYMS[n.dial].id} is ${p.code[n.dial]}`;

  // ---- the locks
  async function lift(i) {
    const s = p.spots[i], g = spots[i], L = g.userData.lift, my = clk.epoch;
    if (g.userData.busy) return; g.userData.busy = true;
    const first = !searched.has(i); searched.add(i); sounds.slide();
    await clk.tween(.35, k => { L.position.y = ease(k) * .26; L.rotation.z = Math.sin(k * Math.PI) * .25; });
    if (!alive(my)) return;
    const under = g.getWorldPosition(v3()).add(v3(0, .04, 0));
    if (s.holds === 'key' && !got.key) {
      got.key = true; sounds.chime(); creature.gesture('tada'); stage.sparks(under, '#ffe27a', 30);
      float(keyMesh(), root.worldToLocal(under.clone()), 1.4);
      stage.news(`[escape] They lifted the ${s.name} and found ${p.theme.key} under it! It must open the chest.`, true);
    } else if (s.holds === 'note' && !got['note:spot']) {
      const n = findNote('spot', root.worldToLocal(under.clone()));
      stage.news(`[escape] Under the ${s.name}: ${noteLine(n)}.`, false);
    } else if (first && s.holds === 'nothing') {
      stage.say(`Just ${s.joke} under the ${s.name}!`) || null;
    }
    await clk.wait(1.2);
    if (!alive(my)) return;
    await clk.tween(.3, k => { L.position.y = (1 - ease(k)) * .26; L.rotation.z = 0; });
    sounds.clack(.6); g.userData.busy = false;
  }
  async function openChest() {
    if (done.chest) return;
    const lid = chest.userData.lid, my = clk.epoch;
    if (!got.key) {
      sounds.rattle(); clk.tween(.35, k => { chest.rotation.z = Math.sin(k * Math.PI * 5) * .04 * (1 - k); });
      if (!got.rattled) { got.rattled = true; stage.say("It's locked tight. There must be a key somewhere!"); }
      return;
    }
    done.chest = true; sounds.clink(); creature.gesture('point');
    await clk.wait(.3); if (!alive(my)) return;
    await clk.tween(.6, k => { lid.rotation.x = -ease(k) * 1.9; });
    if (!alive(my)) return;
    sounds.chime(); stage.sparks(chest.getWorldPosition(v3()).add(v3(0, .25, 0)), '#ffd27a', 30);
    const n = findNote('chest', root.worldToLocal(chest.getWorldPosition(v3()).add(v3(0, .2, 0))));
    stage.news(`[escape] The key fits! The chest creaks open, and inside is ${noteLine(n)}.`, true);
  }
  function turnWheel(i) {
    if (done.box) return;
    wheel[i] = (wheel[i] + 1) % COLOURS.length; showWheels(); sounds.tick(1.4);
    const m = wheelMeshes[i]; clk.tween(.2, k => { m.rotation.z = -k * Math.PI * 2 / COLOURS.length; }).then(() => { m.rotation.z = 0; });
    if (wheel.every((c, j) => c === p.box.want[j])) openBox();
  }
  async function openBox() {
    done.box = true; const my = clk.epoch, lid = box.userData.lid;
    await clk.wait(.25); if (!alive(my)) return;
    sounds.chime(); creature.gesture('tada');
    await clk.tween(.5, k => { lid.rotation.x = -ease(k) * 1.7; });
    if (!alive(my)) return;
    const n = findNote('box', root.worldToLocal(box.getWorldPosition(v3()).add(v3(0, .62, 0))));
    stage.news(`[escape] The colour box clicks open! Inside: ${noteLine(n)}.`, true);
  }
  function tapLantern(i) {
    if (done.lights) return;
    lit = flip(lit, i); showLights(); sounds.clink(1.2);
    if (lit.every(Boolean)) {
      done.lights = true; sounds.chime(); creature.gesture('tada');
      const base = root.userData.lights, at = base.getWorldPosition(v3()).add(v3(0, .12, 0));
      stage.sparks(at, '#ffd27a', 40);
      const n = findNote('lights', root.worldToLocal(at.clone()));
      stage.news(`[escape] All the lanterns are lit at once! A little drawer pops out of their base with ${noteLine(n)}.`, true);
    }
  }
  function turnDial(i) {
    if (done.door) return;
    dial[i] = (dial[i] + 1) % 10; showDials(); sounds.tick(1.2);
    if (dial.every((d, j) => d === p.code[j])) escape();
  }
  async function escape() {
    done.door = true; state = 'won'; focus = null; const my = clk.epoch, secs = Math.round(time);
    const best = keep(secs);
    sounds.clink(); await clk.wait(.35); if (!alive(my)) return;
    sounds.chime(); sounds.gong(.6); gs.sound.sounds.coin?.(); creature.mood('excited'); creature.gesture('tada');
    const hinge = door.userData.hinge, glow = glowDoor.material;
    clk.tween(1.4, k => { hinge.rotation.y = -ease(k) * 1.75; glow.emissiveIntensity = ease(k) * 2.4; });
    const at = door.getWorldPosition(v3()).add(v3(0, .8, .15));
    for (let i = 0; i < 4; i++) clk.wait(i * .25).then(ok => ok && stage.sparks(at, ['#ffd27a', '#7dffa0', '#9fd8ff', '#ff9fd0'][i], 40));
    stage.news(`[escape] They set the dials to ${p.code.join(' ')} and ${p.theme.out}! You escaped in ${clockText(secs)}${hintsUsed ? ` with ${hintsUsed} hint${hintsUsed > 1 ? 's' : ''}` : ' without a single hint'}${best ? `, their best time at this level` : ''}. Cheer, and offer another escape room.`, true);
  }

  // ---- how things show
  function showDials() { dialMeshes.forEach((g, i) => g.userData.face.userData.redraw((c, w, h) => paintDial(c, w, h, dial[i]))); }
  function showWheels() { wheelMeshes.forEach((g, i) => g.userData.disc.material.color.set(COLOURS[wheel[i]][1])); }
  function showLights() { lanterns.forEach((g, i) => { const m = g.userData.glass.material; m.emissiveIntensity = lit[i] ? 2.2 : 0; m.color.set(lit[i] ? '#ffd27a' : '#6a6458'); }); }

  // ---- hints: the next thing to do, and three ways to say it
  /** What is left, in the order it makes sense to do it: [{ step, tiers }]. */
  function todo() {
    const out = [], n = at => p.notes.find(x => x.at === at), unsearched = p.spots.filter((_, i) => !searched.has(i)).map(s => s.name);
    const keySpot = p.spots.find(s => s.holds === 'key'), noteSpot = p.spots.find(s => s.holds === 'note');
    if (!got.key) out.push({ step: 'key', tiers: ['The chest needs a key. Things in this room might be hiding something underneath.', `Lift the things on the floor by tapping them${unsearched.length ? `: the ${unsearched.join(', the ')}` : ''}.`, `The key is under the ${keySpot.name}.`] });
    if (!done.chest) out.push({ step: 'chest', tiers: ['That key must fit something with a keyhole.', 'Tap the chest to unlock it with the key.', 'Tap the treasure chest on the floor.'] });
    if (!got['note:spot']) out.push({ step: 'note', tiers: ['Not every hiding place has been checked. A note might be under one.', `Have you looked under ${unsearched.length ? `the ${unsearched.join(', the ')}` : 'everything'}?`, `There is a note under the ${noteSpot.name}.`] });
    if (p.box && !done.box) {
      const b = p.box, set = b.want.map((c, i) => (b.shapes ? `the ${b.shapes[i]} wheel ${COLOURS[c][0]}` : COLOURS[c][0])).join(', ');
      out.push({ step: 'box', tiers: ['The painting on the easel is more than decoration.', b.shapes ? 'Each shape on the painting has a colour. Turn the wheel with the same shape on the colour box to that colour (tap a wheel to turn it).' : 'The painting\'s stripes, left to right, are the colours for the box\'s wheels, left to right. Tap a wheel to turn it.', b.shapes ? `Set ${set}.` : `Set the wheels to ${set}, left to right.`] });
    }
    if (p.lights && !done.lights) {
      const sol = solveLights(lit) || [], nth = i => ['first', 'second', 'third', 'fourth', 'fifth'][i];
      out.push({ step: 'lights', tiers: ['The lanterns at the front want to be lit all at once.', 'Tapping a lantern flips it and the ones next to it. Try the ones at the ends, or one in the middle.', `Tap the ${sol.map(nth).join(' and the ')} lantern${sol.length > 1 ? 's' : ''}, counting from the left.`] });
    }
    const counted = p.notes.find(x => x.count && got['note:' + x.at]);
    if (counted) out.push({ step: 'count', tiers: ['One note asks a question. Look carefully round the room.', 'Count every candle in the room: some are tucked away, near the door and behind things.', `There are ${p.candles} candles, so ${SYMS[counted.dial].id} is ${p.candles}.`] });
    const allNotes = p.notes.every(x => got['note:' + x.at]);
    out.push({ step: 'door', tiers: [allNotes ? 'You have every number now. Each note has a mark on it, and so does each dial on the door.' : 'The door needs one number for each dial. The notes round the room have them.', 'Tap the door to go up close, then tap each dial until it shows the number from the note with the same mark.', allNotes ? `Set the dials to ${p.code.join(', ')}, left to right.` : 'Find the rest of the notes first.'] });
    // (the door is last; a step whose notes it needs comes first)
    return out.filter(x => x.step !== 'count' || counted);
  }
  function nextHint(stronger) {
    const step = todo()[0], k = hintTier[step.step] ?? 0;
    if (stronger) { hintTier[step.step] = Math.min(TIERS - 1, k + 1); hintsUsed++; }
    return step.tiers[stronger ? Math.min(TIERS - 1, k) : Math.max(0, k - 1)];
  }

  // ---- bits for the bar and for Reverie
  const clockText = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function keep(secs) {
    try {
      const k = JSON.parse(localStorage.getItem(KEEP) || '{}'), best = k.best || {};
      const had = best[level] != null, better = !had || secs < best[level]; if (better) best[level] = secs;
      localStorage.setItem(KEEP, JSON.stringify({ ...k, best, escapes: (k.escapes || 0) + 1 })); return had && better;
    } catch { return false; }
  }
  const pocket = () => [got.key && !done.chest ? '🔑' : '', ...p.notes.filter(n => got['note:' + n.at]).sort((a, b) => a.dial - b.dial).map(n => SYMS[n.dial].ch + (n.count ? '?' : p.code[n.dial]))].filter(Boolean).join(' ');
  const FOCUS = {
    door: () => { const d = door.getWorldPosition(v3()); return { pos: [d.x + .05, .95, d.z + .95], look: [d.x, .75, d.z] }; },
    box: () => { const b = box.getWorldPosition(v3()); return { pos: [b.x - .3, .85, b.z + .72], look: [b.x, .45, b.z] }; },
    painting: () => { const b = painting.getWorldPosition(v3()); return { pos: [b.x - .1, .85, b.z + .8], look: [b.x, .7, b.z] }; },
  };
  let focusCam = null;
  function setFocus(f) { focus = f; focusCam = f ? FOCUS[f]() : null; sounds.slide(.6); }

  const api = {
    id: 'escape', title: 'Escape Room',
    get camera() { return focus && focusCam ? focusCam : CAMERA; },
    get state() { return state; },
    get round() { return round; },
    /** The puzzle being played (for tests). */
    get puzzle() { return p; },
    /** Which lanterns are lit (for tests). */
    get lit() { return [...lit]; },
    /** A new escape room. level 1 (two dials, a key and a chest) to 5 (four dials, lanterns, more hiding places). */
    async start({ level: lv } = {}) {
      if (lv) level = Math.max(1, Math.min(5, Math.round(lv)));
      api.stop(); round++;
      p = makePuzzle(level); state = 'playing'; time = 0; focus = null; focusCam = null;
      got = {}; done = {}; searched = new Set(); hintTier = {}; hintsUsed = 0;
      dial = p.code.map(() => 0); wheel = p.box ? [...p.box.start] : []; lit = p.lights ? [...p.lights.start] : [];
      build(); showDials(); showWheels(); showLights();
      scene.add(root);
      root.scale.setScalar(.01); clk.tween(.5, k => root.scale.setScalar(popIn(k)));
      stage.sparks(v3(-.55, .8, -1.1), '#c79bff', 50); sounds.gong(.5);
      creature.gesture('shrug'); creature.mood('curious');
      const has = [p.box && 'a colour box and a painting', p.lights && 'a row of lanterns', p.candles && 'candles about the place'].filter(Boolean);
      return `Escape room "${p.theme.name}" is set up: ${p.theme.intro} The door has ${p.dials} number dials. Round the room: ${p.spots.length} things on the floor to lift, a locked chest${has.length ? ', ' + has.join(', ') : ''}. You are trapped in here with them and as puzzled as they are: you don't know the answers, you only give the hints the game gives you when they ask. Tell them, in two lively sentences, that you're locked in and the code is hidden round the room, and to tap things to search.`;
    },
    stop() {
      clk.stop(); focus = null; focusCam = null;
      if (state !== 'off') state = 'off';
      if (root) { root.removeFromParent(); root = null; }   // (geometry is shared with the engine's caches: not disposed)
    },
    update(dt) {
      if (state === 'off') return;
      t += dt; if (state === 'playing') time += dt;
      clk.update(dt);
      for (const c of candles) { const f = c.userData.flame; f.scale.x = 1 + Math.sin(t * 13 + c.position.x * 9) * .12; f.material.emissiveIntensity = 2.6 + Math.sin(t * 9 + c.position.z * 7) * .5; }
      if (state === 'playing' && !got.key) for (const [i, g] of spots.entries()) if (!searched.has(i) && !g.userData.busy) g.userData.lift.rotation.z = Math.sin(t * 2 + i) * .01;
      if (state === 'playing') glowDoor.material.emissiveIntensity = .05 + Math.max(0, Math.sin(t * 1.5)) * .05;   // (a little light round the edges)
    },
    tap(ray) {
      if (state === 'off' || !root) return false;
      const tagOf = h => { let o = h.object; while (o && !o.userData.esc) o = o.parent; return o && { o, seen: h.object.visible }; };
      // a thing you can see wins over the invisible targets round other things (generous, for fingers, so they
      // overlap); then a dial or a wheel wins over the big target round the door or box it is on
      const hits = ray.intersectObject(root, true).map(tagOf).filter(Boolean); if (!hits.length) return false;
      const first = (hits.find(x => x.seen) || hits[0]).o, within = o => { for (let p = o; p; p = p.parent) if (p === first) return true; return false; };
      const o = hits.map(x => x.o).find(x => ['dial', 'wheel', 'lantern'].includes(x.userData.esc.kind) && within(x)) || first;
      if (state !== 'playing') return true;
      const { kind, i } = o.userData.esc;
      // the door's dials and the box's wheels turn once you are up close; from afar a tap takes you there
      if (kind === 'dial') { if (focus === 'door') turnDial(i); else setFocus('door'); }
      else if (kind === 'door') setFocus('door');
      else if (kind === 'wheel') { if (focus === 'box') turnWheel(i); else setFocus('box'); }
      else if (kind === 'box') setFocus(done.box ? null : 'box');
      else if (kind === 'painting') setFocus(focus === 'painting' ? null : 'painting');
      else { if (focus) setFocus(null); if (kind === 'spot') lift(i); else if (kind === 'chest') openChest(); else if (kind === 'lantern') tapLantern(i); }
      return true;
    },
    /** What they said for Claude's game_move: "hint", a code ("4 7 2"), colours ("red blue green"), or a thing to search. */
    async command(text) {
      if (state === 'off') return 'No escape room is on.';
      if (state !== 'playing') return 'They have escaped already. Call play for another escape room.';
      const s = words(text);
      if (/\b(hint|clue|help|stuck|tip)\b/.test(s)) { creature.gesture('think'); return `Give this hint in your own words, no more: ${nextHint(true)}`; }
      const ds = digitsOf(text);
      if (ds.length >= p.dials && !/\b(colou?rs?|wheels?)\b/.test(s)) {
        setFocus('door'); dial = ds.slice(0, p.dials); showDials(); sounds.tick(1.2);
        if (dial.every((d, j) => d === p.code[j])) { escape(); return 'The dials are set and the door is opening!'; }
        return `The dials are set to ${dial.join(' ')} but the door stays locked. That is not the code.`;
      }
      const cs = coloursOf(text);
      if (p.box && !done.box && cs.length >= p.box.wheels) {
        setFocus('box'); wheel = cs.slice(0, p.box.wheels); showWheels();
        if (wheel.every((c, j) => c === p.box.want[j])) { openBox(); return 'The colour box is opening!'; }
        return `The wheels are set to ${wheel.map(c => COLOURS[c][0]).join(', ')}, but the box stays shut.`;
      }
      const i = p.spots.findIndex(x => s.includes(words(x.name)) || s.includes(words(x.name).split(' ').pop()));
      if (i >= 0) { setFocus(null); lift(i); return `Lifted the ${p.spots[i].name}.`; }
      if (/\bchest\b/.test(s)) { setFocus(null); await openChest(); return got.key ? 'The chest is open.' : 'The chest is locked: they need the key first.'; }
      if (/\b(painting|picture|easel)\b/.test(s) && painting) { setFocus('painting'); return 'Went up close to the painting.'; }
      if (/\bdoor\b/.test(s)) { setFocus('door'); return 'Went up close to the door.'; }
      return 'Use "hint", the code ("4 7 2"), the colours for the box, or the name of a thing to search.';
    },
    context() {
      if (state === 'off') return '';
      if (state !== 'playing') return `[escape room, ${p.theme.name}: they escaped in ${clockText(time)} with ${hintsUsed} hint${hintsUsed === 1 ? '' : 's'}. Offer another, maybe harder (levels 1 to 5, this was ${level}).]`;
      const found = [got.key && !done.chest && `the key (not used yet)`, ...p.notes.filter(n => got['note:' + n.at]).map(noteLine)].filter(Boolean);
      const opened = ['chest', 'box', 'lights'].filter(k => done[k]).map(k => ({ chest: 'the chest', box: 'the colour box', lights: 'the lanterns' })[k]);
      const step = todo()[0], given = hintTier[step.step] ?? 0;
      return `[escape room, ${p.theme.name}, level ${level}, ${clockText(time)} in: found ${found.length ? found.join('; ') : 'nothing yet'}.${opened.length ? ` Solved: ${opened.join(', ')}.` : ''} Searched ${searched.size} of ${p.spots.length} hiding places. You don't know the answers. Only when they ask for help, give ${given ? 'this hint again' : 'this gentle hint'}: "${nextHint(false)}"${given < TIERS - 1 ? '; if they want more, call game_move "hint" for a stronger one' : ''}. They can say the code for game_move ("4 7 2").]`;
    },
    bar() {
      if (state === 'off') return null;
      if (state === 'won') return { text: `Escaped in ${clockText(time)}!`, buttons: [{ id: 'again', label: 'Again' }, { id: 'leave', label: 'Done' }] };
      const pk = pocket();
      return { text: pk ? `${clockText(time)} · ${pk}` : `Escape room · ${clockText(time)}`, buttons: [...(focus ? [{ id: 'back', label: 'Back' }] : []), { id: 'hint', label: 'Hint' }, { id: 'leave', label: 'Done' }] };
    },
    back() { setFocus(null); },
    hint() {
      if (state !== 'playing') return;
      creature.gesture('think');
      stage.news(`[escape] They pressed Hint. Give this one in your own playful words, a sentence or two, and no more than it says: ${nextHint(true)}`, true);
    },
  };
  return api;
}
