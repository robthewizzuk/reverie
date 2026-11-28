// Reverie's Cosy Workshop Radio: a little retro wooden radio on the desk with a glowing tuning dial and
// procedural Web Audio ambient soundscapes (fireplace crackle, rain on glass, forest birds, ocean waves,
// cosy café hum, and procedural lo-fi study beats via gs.sound.compose). Tap the radio to cycle stations.
import gs from '../engine/src/gamescroll.js';
import { audio } from '../engine/src/sfx.js';
import { makeRadioState, STATIONS } from './radio-state.js';
import { makeSoundscapeMixer, SOUNDSCAPE_PRESETS } from './soundscape.js';
import { DESK, onBoard } from './room.js';
import { FUN } from './mood.js';

export { makeRadioState, STATIONS };

Object.assign(FUN, { radio: FUN.radio || [.025, .45] });

// sits cleanly on the desk between the aquarium (x = 0.52) and desk lamp (x = 1.3)
const RADIO_X = 1.14;

export function makeRadio({ world, onNews = () => {} }) {
  const { THREE, pbr, rbox } = gs.hd;
  const scene = world.view.scene;
  const state = makeRadioState();

  const root = new THREE.Group(); root.name = 'radio';
  const [rx, ry, rz] = onBoard(DESK, RADIO_X);
  root.position.set(rx, ry, rz);
  root.rotation.y = -.16;
  scene.add(root);

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

  // ---- retro wooden radio mesh
  const body = new THREE.Mesh(rbox(.155, .105, .078, .014), pbr('#a87449', { rough: .55 }));
  body.position.y = .056; body.castShadow = true; body.receiveShadow = true; root.add(body);

  const face = new THREE.Mesh(rbox(.138, .086, .008, .006), pbr('#ece1ce', { rough: .65 }));
  face.position.set(0, .056, .038); root.add(face);

  // speaker grille slats on the left
  const slatMat = pbr('#5c4432', { rough: .85 });
  for (let i = 0; i < 4; i++) {
    const slat = new THREE.Mesh(rbox(.062, .006, .004, .001), slatMat);
    slat.position.set(-.028, .034 + i * .014, .043); root.add(slat);
  }

  // glowing tuning dial on the right
  const DIAL_OFF = new THREE.Color('#3b322b');
  const dialMat = new THREE.MeshBasicMaterial({ color: DIAL_OFF });
  const dial = new THREE.Mesh(new THREE.CircleGeometry(.017, 20), dialMat);
  dial.position.set(.038, .064, .043); root.add(dial);

  // brass tuning knob
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(.01, .011, .012, 16), pbr('#c8a25a', { metal: .75, rough: .3 }));
  knob.rotation.x = Math.PI / 2; knob.position.set(.038, .032, .044); root.add(knob);

  // slim tilted antenna
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(.002, .003, .13, 8), pbr('#bfc6cc', { metal: .8, rough: .25 }));
  ant.position.set(.055, .16, -.01); ant.rotation.z = -.22; root.add(ant);

  // ---- procedural Web Audio ambient engine (zero external audio files)
  let nodes = [], extraTimer = null, lofiLoop = null, gainNode = null, lofiSeed = 11;

  function stopAudio() {
    clearInterval(extraTimer); extraTimer = null;
    if (lofiLoop) { try { lofiLoop.stop(); } catch { /* gone */ } lofiLoop = null; }
    for (const n of nodes) { try { n.stop?.(); n.disconnect?.(); } catch { /* gone */ } }
    nodes = []; gainNode = null;
    dialMat.color.copy(DIAL_OFF);
  }

  function makeNoiseBuffer(ctx, brown = false) {
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const out = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + .025 * w) / 1.025; out[i] = last * 3.2; }
      else out[i] = w * .5;
    }
    return buf;
  }

  function startAudio() {
    stopAudio();
    if (!state.playing) return;
    dialMat.color.set(STATIONS[state.station]?.dial || '#ffbe6b');
    const vol = (state.volume / 100) * .28;
    if (state.station === 'lofi') {
      try {
        const comp = gs.sound.compose({ mood: 'calm', style: 'lofi', seed: lofiSeed++ });
        lofiLoop = gs.sound.music({ ...comp, set: 'style', layers: null, vol: (state.volume / 100) * .55 });
        lofiLoop.start();
      } catch { /* audio locked */ }
      return;
    }
    try {
      const ctx = audio();
      if (!ctx) return;
      const master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);
      gainNode = master; nodes.push(master);

      const src = ctx.createBufferSource();
      src.buffer = makeNoiseBuffer(ctx, state.station !== 'rain');
      src.loop = true;

      const filter = ctx.createBiquadFilter();
      if (state.station === 'fireplace') { filter.type = 'lowpass'; filter.frequency.value = 340; }
      else if (state.station === 'rain') { filter.type = 'bandpass'; filter.frequency.value = 1400; filter.Q.value = .65; }
      else if (state.station === 'forest') { filter.type = 'bandpass'; filter.frequency.value = 520; filter.Q.value = 1.1; }
      else if (state.station === 'waves') {
        filter.type = 'lowpass'; filter.frequency.value = 480;
        const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
        lfo.frequency.value = .11; lfoGain.gain.value = 260;
        lfo.connect(lfoGain); lfoGain.connect(filter.frequency);
        lfo.start(); nodes.push(lfo, lfoGain);
      } else { // cafe
        filter.type = 'bandpass'; filter.frequency.value = 620; filter.Q.value = .9;
      }
      src.connect(filter); filter.connect(master); src.start();
      nodes.push(src, filter);

      // occasional gentle accents: hearth crackles, distant bird chirps, or café clinks
      if (state.station === 'fireplace' || state.station === 'forest' || state.station === 'cafe') {
        extraTimer = setInterval(() => {
          if (!state.playing || !gainNode || Math.random() > .45) return;
          try {
            const osc = ctx.createOscillator(), g = ctx.createGain(), now = ctx.currentTime;
            if (state.station === 'fireplace') {
              osc.type = 'triangle'; osc.frequency.setValueAtTime(900 + Math.random() * 1400, now);
              g.gain.setValueAtTime(.14, now); g.gain.exponentialRampToValueAtTime(.001, now + .035);
              osc.connect(g); g.connect(gainNode); osc.start(now); osc.stop(now + .04);
            } else if (state.station === 'forest') {
              osc.type = 'sine'; const f0 = 2200 + Math.random() * 1200;
              osc.frequency.setValueAtTime(f0, now); osc.frequency.exponentialRampToValueAtTime(f0 * 1.25, now + .08);
              g.gain.setValueAtTime(.06, now); g.gain.exponentialRampToValueAtTime(.001, now + .14);
              osc.connect(g); g.connect(gainNode); osc.start(now); osc.stop(now + .16);
            } else {
              osc.type = 'sine'; osc.frequency.setValueAtTime(1750 + Math.random() * 400, now);
              g.gain.setValueAtTime(.05, now); g.gain.exponentialRampToValueAtTime(.001, now + .09);
              osc.connect(g); g.connect(gainNode); osc.start(now); osc.stop(now + .1);
            }
          } catch { /* audio busy */ }
        }, 1200);
      }
    } catch { /* headless / audio locked */ }
  }

  const mixer = makeSoundscapeMixer();

  let t = 0;
  function update(dt) {
    if (!state.playing && !mixer.active) return;
    t += dt;
    const s = 1 + Math.sin(t * 3.5) * .04;
    dial.scale.setScalar(s);
  }

  function tap(x, y, w, h) {
    ndc.set(x / w * 2 - 1, -(y / h) * 2 + 1);
    ray.setFromCamera(ndc, world.view.cam);
    if (!ray.intersectObject(root, true).length) return false;
    mixer.stop();
    const r = state.next();
    if (state.playing) startAudio(); else stopAudio();
    knob.rotation.y += .7;
    gs.sound.sounds.pop?.() || gs.sound.sounds.bell?.();
    world.mood?.fun('radio');
    onNews(`[radio] They tapped the workshop radio: ${r.text}`, false);
    return true;
  }

  async function command(input = {}) {
    const a = input.action || (input.preset ? 'preset' : input.layers ? 'mix' : input.station ? 'play' : 'play');
    if (a === 'stop') {
      const r = state.stop();
      stopAudio();
      mixer.stop();
      return r.text;
    }
    if (a === 'preset') {
      stopAudio(); state.stop();
      const res = mixer.preset(input.preset);
      if (res.error) return { text: res.error, error: true };
      dialMat.color.set('#7be0ff');
      return res.text;
    }
    if (a === 'mix') {
      stopAudio(); state.stop();
      const text = mixer.mix(input.layers || {}, input.binaural_mode || input.binauralMode || null);
      if (mixer.active) dialMat.color.set('#7be0ff'); else dialMat.color.copy(DIAL_OFF);
      return `Soundscape mix updated: ${text}.`;
    }
    if (a === 'list') {
      return `Workshop radio stations: ${state.list()}. Soundscape presets: ${Object.keys(SOUNDSCAPE_PRESETS).join(', ')}. Mixable layers: rain, fire, cafe, waves, wind, binaural (focus 40 Hz / calm 10 Hz / sleep 6 Hz).`;
    }
    if (a === 'next') { mixer.stop(); const r = state.next(); if (state.playing) startAudio(); else stopAudio(); return r.text; }
    if (a === 'volume') {
      const r = state.setVolume(input.level);
      if (r.error) return { text: r.error, error: true };
      if (!state.playing) stopAudio();
      else if (gainNode) gainNode.gain.value = (state.volume / 100) * .28;
      else startAudio();
      return r.text;
    }
    mixer.stop();
    const r = state.play(input.station);
    if (r.error) return { text: r.error, error: true };
    startAudio();
    return r.text;
  }

  return {
    state,
    mixer,
    get playing() { return state.playing || mixer.active; },
    update, tap, command, stop: () => { state.stop(); stopAudio(); mixer.stop(); },
    line: () => mixer.active ? ` Workshop soundscape playing: ${mixer.summary()}.` : state.line(),
  };
}
