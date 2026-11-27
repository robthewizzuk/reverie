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
  const heartMat = pbr('#ffb060', { glow: 3.5, glowCol: '#ff9a40' }), heart = new THREE.Mesh(new THREE.SphereGeometry(.016, 16, 12), heartMat);   // (a white-hot middle)
  heart.position.set(0, .26, .285); body.add(heart);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(.066, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), pbr('#ffffff', { rough: .05, glass: { thin: true, tint: '#ffb98a' } }));
  dome.rotation.x = Math.PI / 2; dome.scale.y = .55; dome.position.set(0, .26, .262); body.add(dome);
  const ring = shade(new THREE.Mesh(new THREE.TorusGeometry(.07, .012, 12, 40), pbr('#c9a77e', { rough: .35, metal: .6 })));
  ring.position.set(0, .26, .262); ring.rotation.x = -.18; body.add(ring);
  // the halo: a soft round glow made in code, always facing the camera, added over what is behind it
  // (white in the middle fading out: the sprite's colour is the glow's, so the halo changes with it)
  const haloTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.2, 'rgba(255,187,146,.5)'); g.addColorStop(.55, 'rgba(255,136,73,.1)'); g.addColorStop(1, 'rgba(255,119,73,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .5 }));
  halo.material.color.set('#ff9646');
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
    return { s, pivot, x: REST[0], z: REST[1], long: 1 };
  });

  // feet, and a sprout on top with a glowing bead that sways
  for (const s of [-1, 1]) { const f = shade(new THREE.Mesh(new THREE.SphereGeometry(.07, 16, 12), plush)); f.position.set(s * .1, .03, .05); f.scale.set(1, .55, 1.35); root.add(f); }
  const sprout = new THREE.Group(); sprout.position.set(0, .63, 0); body.add(sprout);
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(.007, .01, .1, 8), pbr('#d9c6ad', { rough: .6 })); stalk.position.y = .05; sprout.add(stalk);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(.024, 16, 12), coreMat); bead.position.y = .105; sprout.add(bead);

  // where a prop is held: in front of the chest, between the hands
  const hold = new THREE.Group(); hold.position.set(0, .3, .5); body.add(hold);
  // the middle of its face, for the light that puts a glint in its eyes (it leans and tilts with the body)
  const face3d = new THREE.Object3D(); face3d.position.set(0, .43, .2); body.add(face3d);

  // ---- life
  let t = 0, mood = 'calm', gesture = null, gT = 0, bounce = 0, giggle = 0, holding = false;
  let lean = 0, tilt = 0, turn = 0, nod = 0, coreLevel = .6, coreGlow = .6;
  // how happy it is (0..1, from mood.js): a readier smile, a brighter and quicker glow, a happy bob, arms more open;
  // low, a softer glow, heavier lids and a little droop. faceCheer is the cheer its face was last set for.
  let cheer = .5, faceCheer = .5;
  // idle moves (chosen on the device by body.js, between replies): what it is doing, for how long, which way it glances
  let idle = null, iT = 0, side = 1, look = 0, perk = 0, drowse = 0, drowsy = false, yawned = false;
  const IDLE_TIME = { rest: 0, glance: 2.4, peek: 2.2, sway: 4, hop: .9, stretch: 2.8, perk: .8 };
  const state = { listening: false, thinking: false, speaking: false };
  // a point in the world it is reaching for with one hand (a chess piece it is moving), or null
  let reachAt = null, reachArm = 1;
  // walking (carrying something across the room): which way it faces (null: towards you) and how hard it waddles, 0..1
  let heading = null, stride = 0;
  const tmpV = new THREE.Vector3();

  function setMood(m) {
    mood = MOODS[m] ? m : 'calm';
    for (const k of FACE_SHAPES) face.set(k, 0);
    for (const [k, v] of Object.entries(MOODS[mood])) face.set(k, v);
    // (a happier Reverie smiles more in every mood but sad; a low one less)
    faceCheer = cheer;
    if (mood !== 'sad') face.set('smile', Math.max(0, Math.min(1, (MOODS[mood].smile || 0) + (cheer - .5) * .45)));
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
    if (reachAt && a.s === reachArm) {
      // aim the arm (which hangs down) along the line from its shoulder to the point, in the body's own frame
      const p = a.pivot.parent.worldToLocal(tmpV.copy(reachAt)).sub(a.pivot.position);
      a.want = Math.min(2.6, Math.max(1, p.length() / .19)); p.normalize();   // (a stretchy toy arm: it grows to reach)
      const side = Math.asin(Math.max(-1, Math.min(1, p.x))), fwd = Math.atan2(-p.z, -p.y);
      return [fwd, side / a.s];
    }
    if (gesture === 'wave' && !L) return [-.3, 2.5 + Math.sin(d * 14) * .35];
    if (gesture === 'point' && !L) return [-1.45, .05];
    if (gesture === 'tada') return [-.4, 2.2];
    if (gesture === 'shrug') return [-.35, 1.15];
    if (gesture === 'think' && !L) return [-2.1, -.55];
    if (idle === 'stretch' && !holding) { const up = Math.sin(Math.min(1, iT / 2.8) * Math.PI); return [-.15 * up, .35 + up * 1.9]; }
    if (holding) return HOLD;
    if (state.listening) return [-.2, .25];
    return [REST[0] + Math.sin(t * 1.3 + a.s) * .03, REST[1] + (cheer - .5) * .18 + Math.sin(t * (1.1 + cheer * .6)) * .04 * (.6 + cheer)];
  }
  // an idle move: none while a gesture runs; 'perk' (you started talking) cuts any idle move short
  function doIdle(a) {
    if (gesture || !(a in IDLE_TIME)) return false;
    if (idle === 'stretch' && yawned) setMood(mood);
    idle = a; iT = 0; yawned = false;
    if (a === 'glance') side = Math.random() < .5 ? -1 : 1;
    if (a === 'hop') bounce = Math.max(bounce, .55);
    if (a === 'perk') { perk = 1; bounce = Math.max(bounce, .3); face.blink(); }
    return true;
  }
  const GESTURE_TIME = { wave: 1.6, point: 1.4, tada: 1.3, shrug: 1.2, think: 2.2, nod: .9, shake: 1, bounce: .8 };

  function update(dt, cam) {
    t += dt; gT += dt;
    if (gesture && gT > (GESTURE_TIME[gesture] || 1.2)) gesture = null;
    iT += dt;
    if (gesture && idle) idle = null;
    if (Math.abs(cheer - faceCheer) > .06 && !(idle === 'stretch' && yawned)) setMood(mood);
    if (idle === 'stretch' && !yawned && iT > .6) { yawned = true; face.set('round', .9); face.set('smile', 0); }
    if (idle && iT > IDLE_TIME[idle]) { if (idle === 'stretch' && yawned) setMood(mood); idle = null; }
    perk = Math.max(0, perk - dt * 1.6);
    drowse += ((drowsy && !state.listening && !state.speaking ? 1 : 0) - drowse) * (1 - Math.exp(-dt * (drowsy ? .6 : 5)));
    // where it looks: a glance one way, then the other, then back
    const lookGoal = idle === 'glance' ? (iT < .9 ? side * .5 : iT < 1.8 ? -side * .4 : 0) : 0;
    look += (lookGoal - look) * (1 - Math.exp(-dt * 5));
    const env = idle ? Math.sin(Math.min(1, iT / IDLE_TIME[idle]) * Math.PI) : 0;   // (eases each move in and out)
    // body: breathing, a bounce, leaning in to listen, tilting the head to think
    const breathe = 1 + Math.sin(t * 2.2) * .014;
    blob.scale.set(1 / Math.sqrt(breathe), 1.12 * breathe, .95);
    bounce = Math.max(0, bounce - dt * 1.4);
    giggle = Math.max(0, giggle - dt * 1.5);
    // (happy: a little bob now and then, as if it can't keep still)
    const bob = state.thinking || stride ? 0 : Math.pow(Math.max(0, Math.sin(t * 3.1)), 6) * .014 * Math.max(0, cheer - .55) * 2.2;
    root.position.y = Math.abs(Math.sin(t * 11)) * .07 * bounce + Math.abs(Math.sin(t * 24)) * .015 * giggle + Math.abs(Math.sin(t * 12)) * .045 * stride + bob;
    root.rotation.z = Math.sin(t * 12) * .09 * stride;
    const e = 1 - Math.exp(-dt * 6);
    const leanIdle = idle === 'peek' ? .2 * env : idle === 'stretch' ? -.08 * env : 0;
    lean += ((reachAt ? .24 : state.listening ? .14 : state.thinking ? -.05 : leanIdle + drowse * .06 + Math.max(0, .4 - cheer) * .12) - lean) * e - perk * dt * .8;
    const tiltIdle = idle === 'sway' ? Math.sin(iT * 2.4) * .1 * env : idle === 'peek' ? .07 * env : 0;
    tilt += ((state.thinking ? .13 : gesture === 'shrug' ? .08 : giggle * Math.sin(t * 30) * .1 + tiltIdle) - tilt) * e;
    nod = gesture === 'nod' ? Math.sin(gT * 14) * .12 : 0;
    const shake = gesture === 'shake' ? Math.sin(gT * 16) * .18 : 0;
    body.rotation.set(lean + nod, shake + look * .55, tilt);
    // turn to face the camera a little
    if (heading != null) { let d = heading - turn; d = Math.atan2(Math.sin(d), Math.cos(d)); turn += d * (1 - Math.exp(-dt * 8)); root.rotation.y = turn; }
    else if (cam) { const want = Math.atan2(cam.position.x - root.position.x, cam.position.z - root.position.z) * .5; let d = want - turn; d = Math.atan2(Math.sin(d), Math.cos(d)); turn += d * e; root.rotation.y = turn; }
    // arms
    for (const a of arms) {
      const [gx, gz] = armGoal(a), k = 1 - Math.exp(-dt * 10);
      a.x += (gx - a.x) * k; a.z += (gz - a.z) * k;
      a.pivot.rotation.set(a.x, 0, a.s * a.z);
      a.long += ((reachAt && a.s === reachArm ? a.want || 1 : 1) - a.long) * k; a.pivot.scale.set(1, a.long, 1);
    }
    sprout.rotation.z = Math.sin(t * (1.7 + cheer * .8)) * .12 * (.7 + cheer * .7) + tilt * -.8; sprout.rotation.x = Math.sin(t * 1.3) * .08 - lean;
    // the core: slow pulse when idle, brighter while listening, a quick swirl while thinking, steady while talking
    coreLevel = state.thinking ? .9 + Math.sin(t * 9) * .35 : state.listening ? 1.2 : state.speaking ? .9 : (.55 + Math.sin(t * (1.6 + cheer * .9 - drowse * .7)) * .12) * (1 - drowse * .35) * (.8 + cheer * .45) + perk * .5;
    coreGlow += (coreLevel - coreGlow) * (1 - Math.exp(-dt * 8));
    coreMat.emissiveIntensity = 1.6 + coreGlow * 1.8;
    halo.material.opacity = .12 + coreGlow * .22; halo.scale.setScalar(.2 + coreGlow * .08 + cheer * .03 + Math.sin(t * 2.4) * .01);
    core.rotation.z += dt * (state.thinking ? 6 : 1);
    // the face: speech and blinking (the engine's Face), eyelids from its blink shape
    face.update(dt);
    const shut = Math.min(1, mouth.morphTargetInfluences[blinkIndex] || 0);
    const lids = (state.thinking ? .85 : 1) * (1 - drowse * .5) * (idle === 'stretch' && yawned ? .55 : 1) * (1 + perk * .18) * (1 - Math.max(0, .4 - cheer) * .4);
    for (const g of eyes) { g.scale.y = Math.max(.08, (1 - shut) * lids); g.scale.x = 1 + perk * .1; }
  }

  /**
   * Recolours it: body is its plush (arms, hands and feet too), glow its core, the bead on its sprout, the halo and the
   * light the plush lets through. Colours as '#rrggbb'. The default glow is the core's own orange, and every other
   * part of the glow is moved the same way from where it was made, so the default looks as it always did.
   */
  const WHITE = new THREE.Color(1, 1, 1), made = { plush: plush.color.clone(), sheen: plush.sheenColor.clone(), sss: plush.userData.sss?.colour.clone(), core: coreMat.color.clone(), coreGlow: coreMat.emissive.clone(), heart: heartMat.color.clone(), heartGlow: heartMat.emissive.clone(), halo: halo.material.color.clone() };
  const BASE_GLOW = new THREE.Color('#ff5200'), glowNow = BASE_GLOW.clone(), hsl = {}, base = {}, x = {};
  BASE_GLOW.getHSL(base);
  // a part of the glow as it was made, moved to the glow it has now: the new hue, its own lightness and saturation
  // kept in step with the core's orange (so the default is unchanged)
  const shift = (into, from) => {
    glowNow.getHSL(hsl); from.getHSL(x);
    return into.setHSL((x.h + hsl.h - base.h + 1) % 1, Math.min(1, x.s * hsl.s / Math.max(.01, base.s)), Math.min(1, x.l * hsl.l / Math.max(.01, base.l)));
  };
  function setColours({ body, glow } = {}) {
    // (each Color is changed in place: the WebGPU view's materials share these objects, so they follow)
    if (body) {
      plush.color.set(body);
      // its soft sheen, a near-white of its own colour (the cream plush keeps the sheen it was made with)
      if (plush.color.equals(made.plush)) plush.sheenColor.copy(made.sheen);
      else plush.sheenColor.copy(plush.color).lerp(WHITE, .75);
    }
    if (glow) {
      glowNow.set(glow);
      shift(coreMat.color, made.core); shift(coreMat.emissive, made.coreGlow);
      shift(heartMat.color, made.heart); shift(heartMat.emissive, made.heartGlow);
      shift(halo.material.color, made.halo);
      if (made.sss) shift(plush.userData.sss.colour, made.sss);
    }
  }
  /** One of the glow's colours as it was made ('#ff7020'), as it is with the glow it has now: for the lights and embers. */
  const glowed = hex => '#' + shift(new THREE.Color(), new THREE.Color(hex)).getHexString();

  return {
    root, hold, face, core, face3d,
    setColours, glowed,
    state,
    get coreGlow() { return coreGlow; },
    /** How happy it looks, 0..1 (mood.js sets it every frame). */
    get cheer() { return cheer; }, set cheer(v) { cheer = Math.max(0, Math.min(1, +v || 0)); },
    get holding() { return holding; }, set holding(v) { holding = !!v; },
    mood: setMood,
    gesture: doGesture,
    /** An idle move, chosen by body.js: rest, glance, peek, sway, hop, stretch, or perk (you started talking). */
    idle: doIdle,
    get idling() { return idle; },
    /** True while a gesture (one Claude asked for, or a greeting) is playing. */
    get busy() { return !!gesture; },
    /** Drowsy: eyes half shut, a slower glow. Anything that happens wakes it. */
    get drowsy() { return drowsy; }, set drowsy(v) { drowsy = !!v; },
    /**
     * Says a line with its mouth moving (the engine's Face.say: the mouth follows the sound itself, shut until it is
     * heard and in its pauses), and calls onStart once the voice is really heard.
     */
    say(line, o, onStart = () => {}) { return face.say(line, { ...o, onStart }); },
    /** A tap on it: a giggle and a look. */
    poke() { giggle = 1; setMood('happy'); face.blink(); },
    /** Reaches for a point in the world (a THREE.Vector3) with the nearer hand; null puts the hand back. */
    reach(p) {
      if (!p) { reachAt = null; return; }
      if (!reachAt) { reachAt = new THREE.Vector3(); reachArm = root.worldToLocal(tmpV.copy(p)).x >= 0 ? 1 : -1; }
      reachAt.copy(p);
    },
    /** Walking: stride 0..1 (how hard it waddles) and the way it faces (radians about y, 0 towards you; null faces you). */
    walk(s = 0, face = null) { stride = Math.max(0, Math.min(1, s)); heading = face; },
    /** The world position of the core, for its light. */
    coreAt(v) { core.updateWorldMatrix(true, false); return v.setFromMatrixPosition(core.matrixWorld); },
    update,
  };
}
