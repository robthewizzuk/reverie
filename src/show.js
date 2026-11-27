// Show and tell: a little camera window in the corner of the stage. Hold something up and Reverie reacts on the spot
// (it spots 80 everyday things, hand signs and barcodes on the device, with the engine's gs.vision), then press Show
// and it gets one small photo of what you're holding, to talk about, or Make a copy for a 3D copy on its shelf.
// Barcodes and QR codes hatch a surprise in its hands (the same code always the same surprise), and a hunt ("can you
// find me a banana?") cheers when the camera sees one. The camera is asked for only when the window opens, and is let
// go when it closes. Only a press of Show or Make a copy sends anything: one photo, with that turn.
import gs from '../engine/src/gamescroll.js';
import { colourName } from './describe.js';

const PHOTO_PX = 512;        // the photo's long side
const PHOTO_Q = .72;         // its JPEG quality (about 30 to 50 KB)
const HUNT_TIME = 90;        // seconds a hunt runs before Reverie gives a hint
const REACT_GAP = 2.5;       // seconds between its on-the-spot reactions to what it sees

// what a hand sign does to it, on the spot
const SIGNS = {
  'thumbs-up': ['nod', 'happy'], 'thumbs-down': ['shake', 'sad'], victory: ['tada', 'excited'], 'open-palm': ['wave', 'happy'],
  love: ['bounce', 'happy'], fist: ['bounce', 'excited'], 'point-up': ['think', 'curious'],
};
const SIGN_WORDS = { 'thumbs-up': 'a thumbs up', 'thumbs-down': 'a thumbs down', victory: 'a peace sign', 'open-palm': 'a wave', love: 'a heart sign with their hand', fist: 'a fist bump', 'point-up': 'a finger pointing up' };

// the surprises inside barcodes: a look and a thing, picked by the code's seed
const GIFT_LOOKS = ['golden', 'glass', 'glowing blue', 'pink', 'wooden', 'silver', 'rainbow', 'green', 'purple', 'tiny red', 'candy', 'crystal'];
const GIFT_THINGS = ['dragon', 'robot', 'rocket', 'teapot', 'treasure chest', 'unicorn', 'castle', 'owl', 'cat', 'penguin', 'crown', 'lantern',
  'sailing ship', 'tortoise', 'fox', 'cupcake', 'guitar', 'hot air balloon', 'octopus', 'mushroom house', 'dinosaur', 'snail', 'trophy', 'duck'];
/** The surprise a code's seed hatches: always the same for the same code. */
export function giftFor(seed) {
  seed >>>= 0;
  return `a ${GIFT_LOOKS[(seed >>> 8) % GIFT_LOOKS.length]} ${GIFT_THINGS[seed % GIFT_THINGS.length]}`;
}
const a = w => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
const pct = s => Math.round(s * 100) + '%';

/** The everyday thing a word means for a hunt ("mug" → "cup"), or null when the camera can't spot it. */
export function huntable(word) {
  const w = String(word || '').toLowerCase().replace(/^(a|an|the|some)\s+/, '').trim();
  const names = gs.vision.Objects.names;
  if (!w || w === 'person') return null;
  return names.includes(w) ? w : names.includes(w.replace(/e?s$/, '')) ? w.replace(/e?s$/, '') : { mug: 'cup', phone: 'cell phone', mobile: 'cell phone', sofa: 'couch', fridge: 'refrigerator', teddy: 'teddy bear', telly: 'tv', television: 'tv', ball: 'sports ball', football: 'sports ball', plant: 'potted plant', laptop: 'laptop', remote: 'remote', glass: 'wine glass' }[w] || null;
}

/** The main colour inside a box of a canvas (0..1 of it), as a plain colour name, or null. */
function colourIn(cv, box) {
  try {
    const c = cv.getContext('2d', { willReadFrequently: true });
    const x = Math.max(0, Math.floor((box.left + box.w * .25) * cv.width)), y = Math.max(0, Math.floor((box.top + box.h * .25) * cv.height));
    const w = Math.max(1, Math.floor(box.w * .5 * cv.width)), h = Math.max(1, Math.floor(box.h * .5 * cv.height));
    const d = c.getImageData(x, y, Math.min(w, cv.width - x), Math.min(h, cv.height - y)).data;
    // the colour most of it is: pixels in buckets, the fullest bucket's average (a plain mean of a red cup and the wall is brown)
    const buckets = new Map();
    for (let i = 0; i < d.length; i += 16) {
      const k = (d[i] >> 5) << 6 | (d[i + 1] >> 5) << 3 | d[i + 2] >> 5, b = buckets.get(k) || [0, 0, 0, 0];
      b[0] += d[i]; b[1] += d[i + 1]; b[2] += d[i + 2]; b[3]++; buckets.set(k, b);
    }
    let best = null; for (const b of buckets.values()) if (!best || b[3] > best[3]) best = b;
    if (!best) return null;
    const hex = '#' + best.slice(0, 3).map(v => Math.round(v / best[3]).toString(16).padStart(2, '0')).join('');
    return colourName(hex);
  } catch { return null; }
}

/**
 * The camera window. el: the #show element (a canvas, a line for what it sees, and buttons with data-id flip, close,
 * copy, show). world: the stage. onNews(text, loud, image, now): what Reverie hears (image: a base64 JPEG, or null;
 * now: they pressed a button, so it answers straight away).
 */
export function makeShow({ el, world, onNews = () => {}, onOpen = () => {} }) {
  const cv = el.querySelector('canvas'), c = cv.getContext('2d'), line = el.querySelector('.seen');
  const touch = matchMedia('(pointer: coarse)').matches;
  let facing = touch ? 'back' : 'front', eyes = null, codes = null, signs = null, raf = 0, last = 0, starting = null;
  let hunt = null, reactT = 0, sawLast = null, lastSeen = [], busy = false, gifts = 0;
  const creature = world.creature;

  const react = (gesture, mood) => { if (gesture) creature.gesture(gesture); if (mood) creature.mood(mood); };

  async function start() {
    stopEyes();
    const camera = facing, shape = 4 / 3;
    line.textContent = 'Opening the camera…';
    await gs.vision.loadVision();
    if (camera !== facing || el.hidden) return;
    eyes = new gs.vision.Objects({ camera, shape, sure: .45, max: 4, every: .3 });
    codes = new gs.vision.Scanner({ camera, shape, every: .4 });
    await eyes.start();
    if (eyes.failed) { line.textContent = /denied|NotAllowed|Permission/i.test(String(eyes.failed?.name || eyes.failed)) ? 'The camera is off. Allow it in the browser to show Reverie things.' : "Couldn't open the camera."; console.warn('[reverie] show:', eyes.failed); return; }
    codes.start().catch(() => {});
    // hand signs need the front camera (the one facing you), and a computer or a phone already using it
    if (camera === 'front') { try { signs = new gs.vision.Signs(); signs.start(); } catch (e) { signs = null; console.info('[reverie] show: no hand signs', e?.message); } }
    line.textContent = hunt ? `Find ${a(hunt.name)}!` : 'Hold something up for Reverie';
  }
  function stopEyes() { eyes?.stop(); codes?.stop(); signs?.stop(); eyes = codes = signs = null; }

  function loop(now) {
    if (el.hidden) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(.1, (now - (last || now)) / 1000); last = now;
    try { tick(dt); } catch (e) { if (!e?.kitLoading) console.warn('[reverie] show:', e); }
    paint();
  }

  function tick(dt) {
    if (!eyes) return;
    eyes.update(); codes?.update(); signs?.update?.();
    reactT -= dt;
    // what it sees, a few times a second (people aren't news: you're in front of the camera)
    lastSeen = eyes.list.filter(o => o.name !== 'person');
    const arrived = eyes.seen();
    if (hunt) {
      hunt.t += dt;
      if (eyes.seeing(hunt.name)) {
        const s = Math.round(hunt.t), name = hunt.name; hunt = null;
        gs.sound.sounds.win(); react('tada', 'excited');
        line.textContent = 'Found it!';
        onNews(`[show] Hunt: they found ${a(name)} and showed it to the camera, in ${s} seconds. Cheer for them in one short line, then offer another hunt or a copy of it for your shelf.`, true, photo());
        return;
      }
      if (hunt.t > HUNT_TIME && !hunt.hinted) { hunt.hinted = true; onNews(`[show] Hunt: they've been looking for ${a(hunt.name)} for a while. Give a playful hint about where one might be in a house, or offer something else to find.`, true); }
    } else if (arrived && arrived !== 'person' && reactT <= 0) {
      reactT = REACT_GAP; sawLast = arrived;
      react(Math.random() < .5 ? 'point' : 'bounce', 'curious'); gs.sound.sounds.blip(1.2);
    }
    if (!hunt && !busy) {
      const top = lastSeen[0];
      line.textContent = top ? `Reverie spots ${a(top.name)}${lastSeen[1] ? ` and ${a(lastSeen[1].name)}` : ''}. Press Show!` : 'Hold something up for Reverie';
    }
    // a barcode or QR code: a surprise hatches from it
    const code = codes?.scan();
    if (code && !busy) gift(code);
    // a hand sign: it answers with its body, on the spot
    const made = signs?.made;
    if (made && SIGNS[made]) {
      react(...SIGNS[made]); gs.sound.sounds.pop();
      onNews(`[show] They gave you ${SIGN_WORDS[made]} through the camera, and you answered with your body.`, false);
    }
  }

  async function gift(code) {
    busy = true; const words = giftFor(code.seed);
    line.textContent = 'Something is hatching from that code…';
    gs.sound.sounds.chest(); react('tada', 'excited');
    try {
      const r = await world.make(words);
      gifts++;
      onNews(`[show] They held up ${code.kind === 'qr' ? 'a QR code' : 'a barcode'} to the camera, and a surprise hatched from it into your hands: ${r} Every code hides its own surprise, always the same one for the same code. React with delight in one or two short lines, and tell them to try another code.`, true);
      line.textContent = 'A surprise! Try another code.';
    } finally { busy = false; }
  }

  // the picture now, small, as a base64 JPEG (no "data:" part)
  function photo() {
    const p = eyes?.picture; if (!p) return null;
    const k = Math.min(1, PHOTO_PX / Math.max(p.width, p.height));
    const out = document.createElement('canvas'); out.width = Math.round(p.width * k); out.height = Math.round(p.height * k);
    out.getContext('2d').drawImage(p, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', PHOTO_Q).replace(/^data:image\/jpeg;base64,/, '');
  }
  // what the device made of it, in words: the things it spotted, how sure, and their colours
  function spotted() {
    const p = eyes?.picture; if (!p || !lastSeen.length) return 'The device did not recognise anything in it, so look at the photo.';
    return 'The device\'s spotter thought it saw: ' + lastSeen.slice(0, 3).map(o => { const col = colourIn(p, o); return `${a((col ? col + ' ' : '') + o.name)} (${pct(o.sure)})`; }).join(', ') + '. It only knows 80 everyday things, so trust the photo over it.';
  }

  function press(id) {
    if (id === 'close') return show.close();
    if (id === 'flip') { facing = facing === 'back' ? 'front' : 'back'; starting = start().catch(e => console.warn('[reverie] show:', e)); return; }
    const img = photo();
    if (!img) { line.textContent = 'The camera is still waking up…'; return; }
    gs.sound.sounds.select?.(); flash();
    creature.mood('curious'); creature.gesture('think');
    if (id === 'show') onNews(`[show] They held something up to the camera to show you: the photo is attached. ${spotted()} Say what you think it is and react like a delighted friend in one to three short lines: notice a detail or two, ask about it, or say something fun. If you aren't sure what it is, say so playfully and guess. Offer to make a copy for your shelf if it suits.`, true, img, true);
    if (id === 'copy') onNews(`[show] They held something up to the camera and want a 3D copy of it for your shelf: the photo is attached. ${spotted()} Say one short line about it, then call place with item set to 1 to 8 plain words for what it is (its colour, material and kind, the way you'd ask the maker: "a yellow rubber duck") and spot "on the shelf". Afterwards, be honest about how close the copy came out.`, true, img, true);
  }
  let flashT = 0;
  const flash = () => { flashT = 1; };

  function paint() {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height, p = eyes?.picture;
    c.fillStyle = '#1b120d'; c.fillRect(0, 0, W, H);
    if (p) c.drawImage(p, 0, 0, W, H);
    // a soft rounded box round each thing it spots, with its name
    c.lineWidth = 2.5; c.font = '600 13px system-ui, sans-serif'; c.textBaseline = 'bottom';
    for (const o of p ? lastSeen.slice(0, 3) : []) {
      const x = o.left * W, y = o.top * H, bw = o.w * W, bh = o.h * H, hit = hunt && o.name === hunt.name;
      c.strokeStyle = hit ? '#9ff0a8' : '#ffd27a'; c.beginPath(); c.roundRect(x, y, bw, bh, 10); c.stroke();
      const label = o.name, tw = c.measureText(label).width + 12;
      c.fillStyle = hit ? '#9ff0a8' : '#ffd27a'; c.beginPath(); c.roundRect(x, Math.max(0, y - 20), tw, 20, 8); c.fill();
      c.fillStyle = '#241509'; c.fillText(label, x + 6, Math.max(20, y) - 3);
    }
    if (hunt) {
      const left = Math.max(0, Math.ceil(HUNT_TIME - hunt.t)), text = `Find ${a(hunt.name)}`;
      c.font = '700 15px system-ui, sans-serif'; const tw = c.measureText(text).width + 20;
      c.fillStyle = '#241509cc'; c.beginPath(); c.roundRect((W - tw) / 2, 8, tw, 26, 13); c.fill();
      c.fillStyle = '#fff4dc'; c.textBaseline = 'middle'; c.fillText(text, (W - tw) / 2 + 10, 21);
      if (left && hunt.t > 5) { c.font = '600 12px system-ui, sans-serif'; c.fillText(`${Math.floor(hunt.t)} s`, W - 40, 21); }
    }
    if (flashT > 0) { c.fillStyle = `rgba(255,255,255,${flashT * .8})`; c.fillRect(0, 0, W, H); flashT = Math.max(0, flashT - .08); }
  }

  el.addEventListener('click', e => { const id = e.target.closest('button')?.dataset.id; if (id) press(id); });

  const show = {
    /** Whether the window is open now. (Not `open`: that is the method below, and a getter of the same name would be
     * overwritten by it, leaving show.open always truthy, so the camera button only ever closed the window.) */
    get isOpen() { return !el.hidden; },
    get hunting() { return hunt?.name || null; },
    get gifts() { return gifts; },
    /** Opens the window and the camera (the browser asks the first time). o.find: something to hunt for. Resolves a sentence for Claude. */
    async open(o = {}) {
      let note = '';
      if (o.find) {
        const name = huntable(o.find);
        if (name) { hunt = { name, t: 0 }; note = ` A hunt is on: the camera cheers when it sees ${a(name)}, and you hear about it.`; }
        else note = ` The camera can't spot "${o.find}" by itself, so no hunt timer is running: ask them to press Show when they've found it. Things it spots on its own include a cup, a banana, an apple, a book, a clock, scissors, a teddy bear, a spoon, a toothbrush, a remote, a bottle, a phone and a backpack.`;
      }
      if (el.hidden) {
        el.hidden = false; last = 0; onOpen();
        cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
        starting = start().catch(e => { console.warn('[reverie] show:', e); line.textContent = "Couldn't open the camera."; });
      } else if (hunt) line.textContent = `Find ${a(hunt.name)}!`;
      await starting;
      if (eyes?.failed) return { text: 'The camera did not open (they may have said no, or there is no camera). Tell them kindly; they can describe things instead.', error: true };
      return `The camera window is open on their screen.${note} When they press Show, you get a photo of what they are holding; Make a copy asks you to make one for your shelf. Barcodes they hold up hatch a surprise in your hands.`;
    },
    close() {
      el.hidden = true; cancelAnimationFrame(raf); stopEyes();
      if (hunt) { hunt = null; onNews('[show] They closed the camera, so the hunt is off.', false); }
    },
    /** For tests: what it sees now, and the photo it would send. */
    get seeing() { return lastSeen.map(o => o.name); },
    photo,
  };
  return show;
}
