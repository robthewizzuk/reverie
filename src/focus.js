// Focus / Pomodoro Buddy: Reverie puts on glasses, enters calm study posture (via body.setFocus), optionally tunes
// the workshop radio to a focus soundscape, shows a live countdown in #gamebar, and celebrates with a 5-minute break
// prompt when the session finishes.
import gs from '../engine/src/gamescroll.js';
import { makeFocusState, formatClock } from './focus-state.js';
import { FUN } from './mood.js';

export { makeFocusState, formatClock };

Object.assign(FUN, { focus: FUN.focus || [.045, .7] });

export function makeFocus({ world, body = null, radio = null, memory = null, onNews = () => {} }) {
  const state = makeFocusState();
  let putOnGlasses = false;

  async function enterStudyVisuals(station) {
    body?.setFocus?.(true);
    try {
      await world.wear({ put_on: ['glasses'] });
      putOnGlasses = true;
    } catch { /* glasses optional */ }
    if (station && radio && !radio.playing) {
      await radio.command({ action: 'play', station }).catch(() => {});
    }
  }

  async function leaveStudyVisuals() {
    body?.setFocus?.(false);
    if (putOnGlasses) {
      putOnGlasses = false;
      try { await world.wear({ take_off: ['glasses'] }); } catch { /* ok */ }
    }
  }

  function update(dt) {
    const done = state.tick(dt * 1000);
    if (!done) return;
    gs.sound.sounds.win?.() || gs.sound.sounds.bell?.();
    if (done.phase === 'focus') {
      leaveStudyVisuals();
      world.celebrate?.();
      world.creature?.gesture('tada');
      world.creature?.mood('excited');
      world.mood?.fun('focus');
      memory?.note('day', { line: `finished a ${done.minutes}-minute focus session (${done.label})` });
      onNews(`[focus] Their ${done.minutes}-minute focus session ("${done.label}") just finished! Total completed: ${done.stats.sessions}. Celebrate warmly and offer a 5-minute break!`, true);
    } else {
      world.creature?.gesture('wave');
      world.creature?.mood('happy');
      onNews(`[focus] Their ${done.minutes}-minute break is up! Ask gently if they want another focus round.`, true);
    }
  }

  async function command(input = {}) {
    const a = input.action || 'start';
    if (a === 'status') return state.status();
    if (a === 'pause') {
      const r = state.pause();
      if (r.error) return { text: r.error, error: true };
      body?.setFocus?.(false);
      return r.text;
    }
    if (a === 'resume') {
      const r = state.resume();
      if (r.error) return { text: r.error, error: true };
      if (state.active?.phase === 'focus') body?.setFocus?.(true);
      return r.text;
    }
    if (a === 'stop') {
      const r = state.stop();
      await leaveStudyVisuals();
      return r.text;
    }
    if (a === 'break') {
      await leaveStudyVisuals();
      const r = state.start({ minutes: input.minutes || 5, label: input.label || 'Break', phase: 'break' });
      world.creature?.gesture('bounce');
      return r.text;
    }
    // start focus
    const r = state.start({ minutes: input.minutes || 25, label: input.label || 'Focus', phase: 'focus' });
    await enterStudyVisuals(input.radio || null);
    world.creature?.gesture('nod');
    world.creature?.mood('calm');
    return r.text;
  }

  function bar() {
    const a = state.active;
    if (!a) return null;
    const prefix = a.phase === 'break' ? 'Break' : 'Focus';
    const buttons = [
      { id: a.paused ? 'focus_resume' : 'focus_pause', label: a.paused ? 'Resume' : 'Pause' },
      ...(a.phase === 'focus' ? [{ id: 'focus_break', label: 'Break' }] : []),
      { id: 'focus_stop', label: 'Done' },
    ];
    return { text: `${prefix} · ${formatClock(a.remainingMs)} · ${a.label}${a.paused ? ' (paused)' : ''}`, buttons };
  }

  function button(id) {
    if (id === 'focus_pause') command({ action: 'pause' });
    else if (id === 'focus_resume') command({ action: 'resume' });
    else if (id === 'focus_break') command({ action: 'break' }).then(t => onNews(`[focus] They started a 5-minute break. ${t}`, false));
    else if (id === 'focus_stop') command({ action: 'stop' }).then(t => onNews(`[focus] They pressed Done. ${t}`, false));
  }

  return {
    state,
    get on() { return !!state.active; },
    get focusing() { return state.active?.phase === 'focus' && !state.active?.paused; },
    update, command, bar, button,
    line: () => state.line(),
  };
}
