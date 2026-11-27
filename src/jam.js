// Pocket Jam Session: interactive looping groove using gs.sound.music (compose.js) with voice-controlled style,
// mood, tempo, and toggleable layers (drums, bass, chords, lead), plus 6 tactile sound pads at the bottom of the
// screen while Reverie, its pet, and the party lights bounce in time.
import gs from '../engine/src/gamescroll.js';
import { playCue } from './sounds.js';
import { FUN } from './mood.js';
import { JAM_STYLES, JAM_MOODS, JAM_PADS, makeJamState } from './jam-state.js';

export { JAM_STYLES, JAM_MOODS, JAM_PADS, makeJamState };

Object.assign(FUN, { jam: FUN.jam || [.04, .7] });

export function makeJam({ world, el = null, music = null, karaoke = null, onNews = () => {} }) {
  const state = makeJamState();
  const creature = world.creature;
  let loop = null, seed = 1;

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

  function rebuildLoop() {
    if (loop) { try { loop.stop(); } catch { /* gone */ } loop = null; }
    if (!state.playing) return;
    try {
      const active = state.activeLayers();
      loop = gs.sound.music({
        style: state.style,
        mood: state.mood,
        bpm: state.bpm,
        layers: active,
        seed: seed++,
        vol: .72,
      });
      loop.start();
    } catch { /* audio not unlocked or headless */ }
  }

  async function startOrChange(input = {}) {
    if (karaoke?.playing) await karaoke.tools.karaoke({ action: 'stop' }).catch(() => {});
    if (music?.spotify?.playing) await music.spotify.command({ action: 'pause' }).catch(() => {});
    const desc = state.playing ? state.change(input) : state.start(input);
    world.party.on = true;
    rebuildLoop();
    renderBar();
    return `Jam session going: ${desc}! The sound pads are up on their screen so they can tap along.`;
  }

  function stop() {
    const was = state.stop();
    if (loop) { try { loop.stop(); } catch { /* gone */ } loop = null; }
    if (!karaoke?.playing) world.party.on = false;
    creature.groove = null;
    renderBar();
    return was;
  }

  let beatClock = 0;
  function update(dt) {
    if (!state.playing) return;
    beatClock += dt;
    const beats = beatClock * state.bpm / 60, phase = beats % 1;
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
