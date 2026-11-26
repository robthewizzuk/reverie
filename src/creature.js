// The creature: a small round body with stubby arms, mitten hands, big eyes, a mouth with blend shapes (so the
// engine's Face does blinking and lip sync) and a glowing core in its chest that shows what it is doing.
// Built in code from the engine's shapes and materials: no model files. About 0.68 m tall, feet at y = 0.
import gs from '../engine/src/gamescroll.js';

const MOODS = {
  calm: { smile: .25 },
  happy: { smile: .8 },
  excited: { smile: 1, surprise: .25 },
  curious: { round: .25, smile: .2 },
  sad: { frown: .8 },
  surprised: { surprise: 1 },
};
const FACE_SHAPES = ['smile', 'frown', 'surprise', 'round'];

// arm poses: [x (forward is negative), z (out from the side)] for the left arm; the right arm mirrors z
const REST = [0, .35], HOLD = [-1.15, .2];

export function makeCreature() {
  const { THREE, pbr } = gs.hd, { Face, shapes } = gs.characters;
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const shade = m => { m.castShadow = true; m.receiveShadow = true; return m; };

  // the body: one soft plush blob
  // (sss: light passes into the plush, so the core warms the belly round it the way a torch glows through a hand)
  const plush = pbr('#e8dccb', { rough: .75, sheen: .5, sheenColor: '#fff3e4', sheenRoughness: .5, sss: { colour: '#ff8a4a', power: 2.5, scale: .9, distortion: .3, ambient: .04 } });
  const blob = shade(new THREE.Mesh(new THREE.SphereGeometry(.28, 48, 32), plush));
  blob.scale.set(1, 1.12, .95); blob.position.y = .33; body.add(blob);

  // the core: a hot ember in the chest under a glass dome, set in a little ring, with a soft halo round it. Its
  // brightness is in lamp numbers (gs.hd "glow by numbers": 4 to 6 reads as a lamp), so the view's bloom makes the glow.
  const coreMat = pbr('#ff4a00', { glow: 2.5, glowCol: '#ff5200', rough: .3 });
  const core = new THREE.Mesh(new THREE.SphereGeometry(.05, 32, 16), coreMat);
  core.position.set(0, .26, .258); core.scale.z = .7; body.add(core);
  const heart = new THREE.Mesh(new THREE.SphereGeometry(.016, 16, 12), pbr('#ffb060', { glow: 3.5, glowCol: '#ff9a40' }));   // (a white-hot middle)
  heart.position.set(0, .26, .285); body.add(heart);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(.066, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), pbr('#ffffff', { rough: .05, glass: { thin: true, tint: '#ffb98a' } }));
  dome.rotation.x = Math.PI / 2; dome.scale.y = .55; dome.position.set(0, .26, .262); body.add(dome);
  const ring = shade(new THREE.Mesh(new THREE.TorusGeometry(.07, .012, 12, 40), pbr('#c9a77e', { rough: .35, metal: .6 })));
  ring.position.set(0, .26, .262); ring.rotation.x = -.18; body.add(ring);
  // the halo: a soft round glow made in code, always facing the camera, added over what is behind it
  const haloTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,150,70,1)'); g.addColorStop(.2, 'rgba(255,110,40,.5)'); g.addColorStop(.55, 'rgba(255,80,20,.1)'); g.addColorStop(1, 'rgba(255,70,20,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .5 }));
  halo.position.set(0, .26, .3); halo.scale.setScalar(.3); halo.renderOrder = 2; body.add(halo);

  // eyes: glossy and dark, a light in each, and lids made by squashing them (the Face's blink)
  const eyeMat = pbr('#1c1714', { rough: .15, clear: 1 }), glint = pbr('#ffffff', { glow: 1.5 });
  const eyes = [-1, 1].map(s => {
    const g = new THREE.Group(); g.position.set(s * .088, .46, .232); g.rotation.y = s * .32;
    const e = new THREE.Mesh(new THREE.SphereGeometry(.046, 24, 16), eyeMat); e.scale.z = .55;
    const h = new THREE.Mesh(new THREE.SphereGeometry(.011, 8, 6), glint); h.position.set(-.014, .016, .022);
    g.add(e, h); body.add(g); return g;
  });
  const cheekMat = pbr('#ff9e8a', { rough: .8, transparent: true, opacity: .55 });
  for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.CircleGeometry(.03, 20), cheekMat); c.position.set(s * .16, .395, .21); c.rotation.y = s * .62; c.scale.y = .6; body.add(c); }

  // the mouth: a closed line that opens, widens, rounds and curves (the engine's Face eases these for speech)
  const mg = new THREE.CircleGeometry(.036, 28); mg.scale(1, .16, 1);
  shapes(mg, {
    open: (p, o) => o.set(0, p.y * 4.5, 0),
    wide: (p, o) => o.set(p.x * .55, 0, 0),
    round: (p, o) => o.set(-p.x * .35, p.y * 3, 0),
    smile: (p, o) => o.set(0, p.x * p.x * 11, 0),
    frown: (p, o) => o.set(0, -p.x * p.x * 11, 0),
    surprise: (p, o) => o.set(-p.x * .2, p.y * 6, 0),
    blink: () => {},   // (no change to the mouth: read back for the eyelids)
  });
  const mouth = new THREE.Mesh(mg, pbr('#3b2420', { rough: .6 }));
  mouth.position.set(0, .385, .262); mouth.rotation.x = -.12; body.add(mouth);
  const face = new Face(mouth, { blinkEvery: 3.2, speed: 10 });
  const blinkIndex = mouth.morphTargetDictionary.blink;

  // arms and mitten hands, each on a shoulder pivot
  const arms = [-1, 1].map(s => {
    const pivot = new THREE.Group(); pivot.position.set(s * .25, .34, .02);
    const arm = shade(new THREE.Mesh(new THREE.CapsuleGeometry(.036, .1, 6, 12), plush)); arm.position.y = -.075;
    const hand = shade(new THREE.Mesh(new THREE.SphereGeometry(.05, 16, 12), plush)); hand.position.y = -.16; hand.scale.set(1, .9, .85);
    pivot.add(arm, hand); body.add(pivot);
    return { s, pivot, x: REST[0], z: REST[1] };
  });

  // feet, and a sprout on top with a glowing bead that sways
  for (const s of [-1, 1]) { const f = shade(new THREE.Mesh(new THREE.SphereGeometry(.07, 16, 12), plush)); f.position.set(s * .1, .03, .05); f.scale.set(1, .55, 1.35); root.add(f); }
  const sprout = new THREE.Group(); sprout.position.set(0, .63, 0); body.add(sprout);
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(.007, .01, .1, 8), pbr('#d9c6ad', { rough: .6 })); stalk.position.y = .05; sprout.add(stalk);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(.024, 16, 12), coreMat); bead.position.y = .105; sprout.add(bead);

  // where a prop is held: in front of the chest, between the hands
  const hold = new THREE.Group(); hold.position.set(0, .3, .5); body.add(hold);

  // ---- life
  let t = 0, mood = 'calm', gesture = null, gT = 0, bounce = 0, giggle = 0, holding = false;
  let lean = 0, tilt = 0, turn = 0, nod = 0, coreLevel = .6, coreGlow = .6;
  const state = { listening: false, thinking: false, speaking: false };

  function setMood(m) {
    mood = MOODS[m] ? m : 'calm';
    for (const k of FACE_SHAPES) face.set(k, 0);
    for (const [k, v] of Object.entries(MOODS[mood])) face.set(k, v);
  }
  setMood('calm');

  /** A gesture: wave, point, tada, shrug, think, nod, shake, bounce. */
  function doGesture(g) {
    if (!g || g === 'none') return;
    gesture = g; gT = 0;
    if (g === 'bounce' || g === 'tada') bounce = 1;
  }

  // where each arm wants to be this frame: [x, z]
  function armGoal(a) {
    const L = a.s < 0, d = gT;
    if (gesture === 'wave' && !L) return [-.3, 2.5 + Math.sin(d * 14) * .35];
    if (gesture === 'point' && !L) return [-1.45, .05];
    if (gesture === 'tada') return [-.4, 2.2];
    if (gesture === 'shrug') return [-.35, 1.15];
    if (gesture === 'think' && !L) return [-2.1, -.55];
    if (holding) return HOLD;
    if (state.listening) return [-.2, .25];
    return [REST[0] + Math.sin(t * 1.3 + a.s) * .03, REST[1] + Math.sin(t * 1.1) * .04];
  }
  const GESTURE_TIME = { wave: 1.6, point: 1.4, tada: 1.3, shrug: 1.2, think: 2.2, nod: .9, shake: 1, bounce: .8 };

  function update(dt, cam) {
    t += dt; gT += dt;
    if (gesture && gT > (GESTURE_TIME[gesture] || 1.2)) gesture = null;
    // body: breathing, a bounce, leaning in to listen, tilting the head to think
    const breathe = 1 + Math.sin(t * 2.2) * .014;
    blob.scale.set(1 / Math.sqrt(breathe), 1.12 * breathe, .95);
    bounce = Math.max(0, bounce - dt * 1.4);
    giggle = Math.max(0, giggle - dt * 1.5);
    root.position.y = Math.abs(Math.sin(t * 11)) * .07 * bounce + Math.abs(Math.sin(t * 24)) * .015 * giggle;
    const e = 1 - Math.exp(-dt * 6);
    lean += ((state.listening ? .14 : state.thinking ? -.05 : 0) - lean) * e;
    tilt += ((state.thinking ? .13 : gesture === 'shrug' ? .08 : giggle * Math.sin(t * 30) * .1) - tilt) * e;
    nod = gesture === 'nod' ? Math.sin(gT * 14) * .12 : 0;
    const shake = gesture === 'shake' ? Math.sin(gT * 16) * .18 : 0;
    body.rotation.set(lean + nod, shake, tilt);
    // turn to face the camera a little
    if (cam) { const want = Math.atan2(cam.position.x - root.position.x, cam.position.z - root.position.z) * .5; turn += (want - turn) * e; root.rotation.y = turn; }
    // arms
    for (const a of arms) {
      const [gx, gz] = armGoal(a), k = 1 - Math.exp(-dt * 10);
      a.x += (gx - a.x) * k; a.z += (gz - a.z) * k;
      a.pivot.rotation.set(a.x, 0, a.s * a.z);
    }
    sprout.rotation.z = Math.sin(t * 1.7) * .12 + tilt * -.8; sprout.rotation.x = Math.sin(t * 1.3) * .08 - lean;
    // the core: slow pulse when idle, brighter while listening, a quick swirl while thinking, steady while talking
    coreLevel = state.thinking ? .9 + Math.sin(t * 9) * .35 : state.listening ? 1.2 : state.speaking ? .9 : .55 + Math.sin(t * 1.6) * .12;
    coreGlow += (coreLevel - coreGlow) * (1 - Math.exp(-dt * 8));
    coreMat.emissiveIntensity = 1.6 + coreGlow * 1.8;
    halo.material.opacity = .12 + coreGlow * .22; halo.scale.setScalar(.2 + coreGlow * .08 + Math.sin(t * 2.4) * .01);
    core.rotation.z += dt * (state.thinking ? 6 : 1);
    // the face: speech and blinking (the engine's Face), eyelids from its blink shape
    face.update(dt);
    const shut = Math.min(1, mouth.morphTargetInfluences[blinkIndex] || 0);
    for (const g of eyes) g.scale.y = Math.max(.08, 1 - shut) * (state.thinking ? .85 : 1);
  }

  return {
    root, hold, face, core,
    state,
    get coreGlow() { return coreGlow; },
    get holding() { return holding; }, set holding(v) { holding = !!v; },
    mood: setMood,
    gesture: doGesture,
    /** Says a line with its mouth moving (the engine's Face.say), and calls onStart once the voice is really heard. */
    say(line, o, onStart = () => {}) {
      const { visemes } = gs.characters;
      const L = face.line = { v: visemes(line, o), t: 0, i: 0, spoken: null };
      let started = false;
      const p = gs.sound.say(line, { ...o, onWord: at => {
        if (!started) { started = true; onStart(); }
        if (face.line !== L) return;
        const k = L.v.findIndex((x, j) => j >= at); if (k >= 0 && k < L.v.length) L.t = L.v[k].t;
      } });
      p.then(ok => { if (face.line === L && ok) L.t = Math.max(L.t, L.v.end); }, () => {});
      return p;
    },
    /** A tap on it: a giggle and a look. */
    poke() { giggle = 1; setMood('happy'); face.blink(); },
    /** The world position of the core, for its light. */
    coreAt(v) { core.updateWorldMatrix(true, false); return v.setFromMatrixPosition(core.matrixWorld); },
    update,
  };
}
