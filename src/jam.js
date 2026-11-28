// Pocket Jam Session: interactive looping groove using gs.sound.compose + gs.sound.music with voice-controlled
// style, mood, tempo, and live-toggleable layers (drums, bass, chords, lead), plus 6 tactile sound pads at the
// bottom of the screen while Reverie, its pet, and the party lights bounce in time.
import gs from '../engine/src/gamescroll.js';
import { playCue } from './sounds.js';
import { FUN } from './mood.js';
import { JAM_STYLES, JAM_MOODS, JAM_PADS, makeJamState } from './jam-state.js';

export { JAM_STYLES, JAM_MOODS, JAM_PADS, makeJamState };

Object.assign(FUN, { jam: FUN.jam || [.04, .7] });

const LAYER_MAP = {
  drums: ['drums', 'drums2'],
  bass: ['bass'],
  chords: ['pad', 'pad2', 'pad3', 'arp'],
  lead: ['lead', 'lead2'],
};

export function makeJam({ world, el = null, music = null, karaoke = null, onNews = () => {} }) {
  const state = makeJamState();
  const creature = world.creature;
  let loop = null, composed = null, baseBpm = 104, stepSec = .25, seed = 1, beatClock = 0;

  function renderBar() {
    if (!el) return;
    el.hidden = !state.playing;
    if (!state.playing) return;
    const head = el.querySelector('.title');
    if (head) head.textContent = `Jam · ${state.style} · ${state.bpm} bpm`;
  }

  // wire pad buttons once
  if (el) {
    const padsEl = el.querySelector('.pads');
    if (padsEl && !padsEl.children.length) {
      padsEl.replaceChildren(...JAM_PADS.map(p => {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.pad = p.id; b.textContent = p.label;
        b.style.setProperty('--pad', p.colour);
        return b;
      }));
    }
    el.addEventListener('click', e => {
      const stopBtn = e.target.closest('[data-id="stop"]');
      if (stopBtn) {
        const was = stop();
        if (was) onNews('[jam] They pressed Stop on the jam session.', false);
        return;
      }
      const padBtn = e.target.closest('[data-pad]');
      if (padBtn) triggerPad(padBtn.dataset.pad);
    });
  }

  function triggerPad(id) {
    const p = JAM_PADS.find(x => x.id === id) || JAM_PADS[0];
    try {
      if (gs.sound.sounds[p.sound]) gs.sound.sounds[p.sound]();
      else playCue(p.cue);
    } catch { /* no audio yet */ }
    creature.gesture?.('bounce');
    const at = creature.coreAt(new gs.hd.THREE.Vector3());
    world.sparks?.({ x: at.x, y: at.y + .25, z: at.z }, p.colour, 8);
    world.mood?.fun('jam');
    return `Hit the ${p.label} pad!`;
  }

  function applyLiveMix(fade = .25) {
    if (!loop) return;
    try {
      const L = state.layers;
      for (const [group, parts] of Object.entries(LAYER_MAP)) {
        const lvl = L[group] ? 1 : 0;
        for (const name of parts) loop.layer?.(name, lvl, fade);
      }
      if (baseBpm > 0) loop.speed?.(state.bpm / baseBpm);
    } catch { /* audio not unlocked */ }
  }

  function rebuildLoop() {
    if (loop) { try { loop.stop(); } catch { /* gone */ } loop = null; }
    composed = null; beatClock = 0;
    if (!state.playing) return;
    try {
      composed = gs.sound.compose({ mood: state.mood, style: state.style, seed: seed++ });
      baseBpm = composed.info?.bpm || state.bpm || 104;
      stepSec = 30 / (composed.tempo || 200);
      loop = gs.sound.music({ ...composed, set: 'style', layers: null, vol: .72 });
      loop.start();
      applyLiveMix(0);
    } catch { /* audio not unlocked or headless */ }
  }

  async function startOrChange(input = {}) {
    if (karaoke?.playing) await karaoke.tools.karaoke({ action: 'stop' }).catch(() => {});
    if (music?.spotify?.playing) await music.spotify.command({ action: 'pause' }).catch(() => {});
    const wasPlaying = state.playing, prevStyle = state.style, prevMood = state.mood;
    const desc = wasPlaying ? state.change(input) : state.start(input);
    world.party.on = true;
    if (!wasPlaying || !loop || state.style !== prevStyle || state.mood !== prevMood) rebuildLoop();
    else applyLiveMix(.25);
    renderBar();
    return `Jam session going: ${desc}! The sound pads are up on their screen so they can tap along.`;
  }

  function stop() {
    const was = state.stop();
    if (loop) { try { loop.stop(); } catch { /* gone */ } loop = null; }
    composed = null; beatClock = 0;
    if (!karaoke?.playing) world.party.on = false;
    creature.groove = null;
    renderBar();
    return was;
  }

  function update(dt) {
    if (!state.playing) return;
    beatClock += dt;
    const t = loop && loop.pos >= 0 ? loop.pos * stepSec * (baseBpm / Math.max(1, state.bpm)) : beatClock;
    const beats = t * state.bpm / 60, phase = beats % 1;
    world.party.beat(phase);
    creature.groove = { beat: Math.floor(beats), phase, amount: creature.state.speaking ? .4 : .85 };
  }

  return {
    state,
    get playing() { return state.playing; },
    tools: {
      jam: async (input = {}) => {
        if (input.action === 'stop') {
          const was = stop();
          return was ? 'Stopped the jam session.' : 'No jam session was playing.';
        }
        if (input.action === 'pad') return triggerPad(input.pad || 'bell');
        return startOrChange(input);
      },
    },
    triggerPad, stop, update,
    line: () => state.line(),
  };
}
