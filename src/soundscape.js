// Ambient World Radio & Binaural Focus Soundscape Mixer: 6 independently mixable procedural Web Audio layers
// (rain, fire, cafe, waves, wind, binaural beats) with zero external audio downloads and smooth gain crossfades.
import { audio } from '../engine/src/sfx.js';

export const LAYERS = ['rain', 'fire', 'cafe', 'waves', 'wind', 'binaural'];

export const BINAURAL_MODES = {
  focus: { base: 200, beat: 40, label: '40 Hz gamma focus' },
  calm:  { base: 180, beat: 10, label: '10 Hz alpha calm' },
  sleep: { base: 140, beat: 6,  label: '6 Hz theta relax' },
};

export const SOUNDSCAPE_PRESETS = {
  rainy_cafe: { label: 'Rainy Coffee Shop', layers: { rain: 65, cafe: 55, fire: 20 } },
  fireplace:  { label: 'Cosy Fireplace',    layers: { fire: 75, wind: 25 } },
  ocean:      { label: 'Ocean Breeze',      layers: { waves: 75, wind: 30 } },
  deep_focus: { label: 'Deep Focus (40 Hz)', layers: { rain: 35, binaural: 45 }, binauralMode: 'focus' },
  forest:     { label: 'Forest Wind',       layers: { wind: 60, rain: 20 } },
  calm_alpha: { label: 'Calm Alpha (10 Hz)', layers: { waves: 40, binaural: 40 }, binauralMode: 'calm' },
};

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function makeSoundscapeMixer() {
  const levels = { rain: 0, fire: 0, cafe: 0, waves: 0, wind: 0, binaural: 0 };
  let binauralMode = 'focus';
  let active = false;
  let running = null; // { ctx, master, gains, nodes, crackleTimer, oscL, oscR }

  function makeNoise(ctx, type = 'pink') {
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, brown = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'brown') { brown = (brown + .02 * w) / 1.02; d[i] = brown * 3.5; }
      else {
        b0 = .99765 * b0 + w * .0990460;
        b1 = .96300 * b1 + w * .2965164;
        b2 = .57000 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * .1848) * .16;
      }
    }
    return buf;
  }

  function ensureAudio() {
    if (running) return running;
    const ctx = audio()?.ctx;
    if (!ctx) return null;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const master = ctx.createGain();
    master.gain.value = .32;
    master.connect(ctx.destination);

    const pink = makeNoise(ctx, 'pink');
    const brown = makeNoise(ctx, 'brown');
    const nodes = [master];
    const gains = {};

    const addNoiseLayer = (name, buf, filterType, freq, q, lfoHz = 0, lfoDepth = 0) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const flt = ctx.createBiquadFilter(); flt.type = filterType; flt.frequency.value = freq; flt.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(flt); flt.connect(g); g.connect(master);
      src.start();
      nodes.push(src, flt, g);
      if (lfoHz > 0) {
        const lfo = ctx.createOscillator(); lfo.frequency.value = lfoHz;
        const lg = ctx.createGain(); lg.gain.value = lfoDepth;
        lfo.connect(lg); lg.connect(flt.frequency);
        lfo.start();
        nodes.push(lfo, lg);
      }
      gains[name] = g;
    };

    addNoiseLayer('rain', pink, 'bandpass', 2400, .55);
    addNoiseLayer('fire', brown, 'lowpass', 280, .8);
    addNoiseLayer('cafe', pink, 'bandpass', 620, 1.1, .28, 120);
    addNoiseLayer('waves', pink, 'lowpass', 520, .7, .12, 260);
    addNoiseLayer('wind', pink, 'bandpass', 420, 2.2, .18, 190);

    // Stereo binaural beat (L = base Hz, R = base + beat Hz)
    const bm = BINAURAL_MODES[binauralMode] || BINAURAL_MODES.focus;
    const oscL = ctx.createOscillator(), oscR = ctx.createOscillator();
    oscL.type = oscR.type = 'sine';
    oscL.frequency.value = bm.base;
    oscR.frequency.value = bm.base + bm.beat;
    const gBin = ctx.createGain(); gBin.gain.value = 0;
    if (typeof ctx.createStereoPanner === 'function') {
      const pL = ctx.createStereoPanner(), pR = ctx.createStereoPanner();
      pL.pan.value = -1; pR.pan.value = 1;
      oscL.connect(pL); pL.connect(gBin);
      oscR.connect(pR); pR.connect(gBin);
      nodes.push(pL, pR);
    } else {
      oscL.connect(gBin); oscR.connect(gBin);
    }
    gBin.connect(master);
    oscL.start(); oscR.start();
    nodes.push(oscL, oscR, gBin);
    gains.binaural = gBin;

    // Gentle stochastic fireplace crackles when fire layer > 0
    const crackleTimer = setInterval(() => {
      if (!running || levels.fire <= 5 || Math.random() > .45) return;
      try {
        const o = ctx.createOscillator(), cg = ctx.createGain();
        o.type = 'triangle';
        o.frequency.value = 900 + Math.random() * 2400;
        const v = (levels.fire / 100) * .045 * (.4 + Math.random() * .6);
        cg.gain.setValueAtTime(v, ctx.currentTime);
        cg.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .028);
        o.connect(cg); cg.connect(master);
        o.start(); o.stop(ctx.currentTime + .03);
      } catch { /* audio busy */ }
    }, 260);

    running = { ctx, master, gains, nodes, crackleTimer, oscL, oscR };
    return running;
  }

  function applyGains() {
    const anyOn = LAYERS.some(k => levels[k] > 0);
    active = anyOn;
    if (!anyOn) { stop(); return; }
    const r = ensureAudio();
    if (!r) return;
    const now = r.ctx.currentTime;
    const bm = BINAURAL_MODES[binauralMode] || BINAURAL_MODES.focus;
    r.oscL.frequency.setTargetAtTime(bm.base, now, .15);
    r.oscR.frequency.setTargetAtTime(bm.base + bm.beat, now, .15);
    for (const k of LAYERS) {
      const scale = k === 'binaural' ? .14 : k === 'rain' ? .55 : .7;
      r.gains[k]?.gain.setTargetAtTime((levels[k] / 100) * scale, now, .25);
    }
  }

  function mix(patch = {}, mode = null) {
    if (mode && BINAURAL_MODES[mode]) binauralMode = mode;
    for (const k of LAYERS) {
      if (patch[k] != null && Number.isFinite(Number(patch[k]))) {
        levels[k] = clamp(Math.round(Number(patch[k])), 0, 100);
      }
    }
    applyGains();
    return summary();
  }

  function preset(name) {
    const key = String(name || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
    const p = SOUNDSCAPE_PRESETS[key];
    if (!p) return { error: `Unknown soundscape preset "${name}". Presets: ${Object.keys(SOUNDSCAPE_PRESETS).join(', ')}.` };
    for (const k of LAYERS) levels[k] = p.layers[k] || 0;
    if (p.binauralMode) binauralMode = p.binauralMode;
    applyGains();
    return { text: `Playing "${p.label}" soundscape (${summary()}).` };
  }

  function stop() {
    for (const k of LAYERS) levels[k] = 0;
    active = false;
    if (!running) return;
    clearInterval(running.crackleTimer);
    for (const n of running.nodes) { try { n.stop?.(); n.disconnect?.(); } catch {} }
    running = null;
  }

  function summary() {
    const on = LAYERS.filter(k => levels[k] > 0).map(k => k === 'binaural' ? `binaural (${BINAURAL_MODES[binauralMode].label}) ${levels[k]}%` : `${k} ${levels[k]}%`);
    return on.length ? on.join(', ') : 'all layers off';
  }

  return {
    get active() { return active; },
    get levels() { return { ...levels }; },
    get binauralMode() { return binauralMode; },
    mix,
    preset,
    stop,
    summary,
  };
}
