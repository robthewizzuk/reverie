// Bedtime / Puppet Theatre Stories: dims the workshop into cosy storytime lighting, holds up 3D props as character
// puppets in Reverie's hands, switches character voices for NPCs (restoring Reverie's own voice afterwards), and
// lets the user steer interactive story forks.
import gs from '../engine/src/gamescroll.js';
import { setVoice, voiceNow } from './looks.js';
import { FUN } from './mood.js';
import { makeStoryState } from './storytime-state.js';

export { makeStoryState };

Object.assign(FUN, { story: FUN.story || [.04, .65] });

export function makeStorytime({ world, memory = null, onNews = () => {} }) {
  const state = makeStoryState();
  let savedVoice = null, savedSky = null;

  function restoreVoice() {
    if (!savedVoice) return;
    setVoice(savedVoice);
    savedVoice = null;
  }

  async function command(input = {}) {
    const a = input.action || 'start';

    if (a === 'start') {
      if (!savedVoice) savedVoice = { ...voiceNow() };
      if (!savedSky) savedSky = { ...(world.daylight?.state?.asked || { time: 'live', weather: 'live' }) };
      const st = state.start({ title: input.title, theme: input.theme, mood: input.time || 'night' });
      const time = ['night', 'sunset', 'dusk', 'dawn'].includes(input.time) ? input.time : 'night';
      world.daylight?.set({ time, weather: input.weather || 'clear' });
      world.show?.('magic');
      world.creature?.mood('curious');
      world.creature?.gesture('wave');
      let made = '';
      if (input.prop) {
        const r = await world.make(input.prop).catch(() => '');
        if (r) made = ` ${r}`;
      }
      return `Storytime started ("${st.title}")! The room dimmed to ${time}.${made} Tell the opening in two or three cosy spoken sentences, then pause and ask what they want to happen next.`;
    }

    if (a === 'puppet') {
      if (!state.active) return { text: 'No story is running — start one with action start first.', error: true };
      state.puppet({ character: input.character, prop: input.prop });
      const bits = [];
      if (input.prop) {
        const r = await world.make(input.prop).catch(() => '');
        if (r) bits.push(r);
      }
      if (input.narrator) {
        if (savedVoice) setVoice(savedVoice);
        bits.push('Back to your narrator voice.');
      } else if (input.voice || input.pitch != null || input.size != null || input.speed != null || input.effect) {
        const vr = setVoice({
          name: input.voice,
          pitch: input.pitch,
          size: input.size,
          speed: input.speed,
          effect: input.effect,
        });
        if (!vr.error) bits.push(vr.text);
      }
      world.creature?.gesture('bounce');
      return bits.join(' ') || `Speaking now as ${state.active.speaker}.`;
    }

    if (a === 'scene') {
      if (!state.active) return { text: 'No story is running — start one with action start first.', error: true };
      state.scene({ beat: input.beat, mood: input.time });
      const bits = [];
      if (input.time || input.weather) {
        const r = world.daylight?.set({ time: input.time, weather: input.weather });
        if (r) bits.push(typeof r === 'string' ? r : r.text);
      }
      if (input.effect) {
        const r = world.show?.(input.effect);
        if (r) bits.push(typeof r === 'string' ? r : r.text);
      }
      return bits.join(' ') || 'Scene updated.';
    }

    if (a === 'end') {
      const was = state.end();
      restoreVoice();
      if (savedSky) { world.daylight?.set(savedSky); savedSky = null; }
      else world.daylight?.set({ time: 'live', weather: 'live' });
      if (!was) return 'No story was running.';
      gs.sound.sounds.bell?.();
      world.creature?.gesture('tada');
      memory?.note('day', { line: `told the story "${was.title}"` });
      return `Storytime ("${was.title}") ended. Your normal voice and the real sky are back.`;
    }

    return { text: 'Story action must be start, puppet, scene or end.', error: true };
  }

  function stopFromBar() {
    command({ action: 'end' }).then(t => onNews(`[story] They pressed Done. ${typeof t === 'string' ? t : t.text}`, false));
  }

  return {
    state,
    get on() { return !!state.active; },
    command,
    line: () => state.line(),
    bar: () => state.active ? { text: `Storytime · ${state.active.title}`, buttons: [{ id: 'story_end', label: 'Done' }] } : null,
    button(id) { if (id === 'story_end') stopFromBar(); },
  };
}
