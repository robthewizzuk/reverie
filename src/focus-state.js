// Pure state for Reverie's Focus / Pomodoro Buddy (no Three.js / DOM, testable in Node).
const KEY = 'reverie.focus.v1';

const memStore = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const dayOf = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);

export function formatClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function makeFocusState({ store = typeof localStorage !== 'undefined' ? localStorage : memStore(), clock = () => Date.now() } = {}) {
  let stats = { sessions: 0, minutes: 0, streak: 0, lastDay: '' };
  try {
    const raw = JSON.parse(store.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      stats.sessions = Math.max(0, raw.sessions | 0);
      stats.minutes = Math.max(0, raw.minutes | 0);
      stats.streak = Math.max(0, raw.streak | 0);
      stats.lastDay = typeof raw.lastDay === 'string' ? raw.lastDay : '';
    }
  } catch { /* fresh */ }

  let active = null; // { phase: 'focus'|'break', label, durationMs, remainingMs, paused }

  const save = () => { try { store.setItem(KEY, JSON.stringify(stats)); } catch { /* private */ } };

  function start({ minutes = 25, label = 'Focus', phase = 'focus' } = {}) {
    const mins = Math.max(1, Math.min(120, Number(minutes) || (phase === 'break' ? 5 : 25)));
    const cleanLabel = String(label || (phase === 'break' ? 'Break' : 'Focus')).trim().slice(0, 48);
    active = { phase, label: cleanLabel, durationMs: mins * 60e3, remainingMs: mins * 60e3, paused: false };
    return {
      session: { ...active },
      text: phase === 'break'
        ? `Started a ${mins}-minute break! Stretch your arms and relax.`
        : `Started a ${mins}-minute focus session for "${cleanLabel}". Reverie will sit quietly with you until the chime.`,
    };
  }

  function pause() {
    if (!active) return { error: 'No focus session is running.' };
    if (active.paused) return { text: 'The focus timer is already paused.' };
    active.paused = true;
    return { text: `Paused your ${active.phase} timer with ${formatClock(active.remainingMs)} left.` };
  }

  function resume() {
    if (!active) return { error: 'No focus session is running.' };
    if (!active.paused) return { text: 'The focus timer is already running.' };
    active.paused = false;
    return { text: `Resumed your ${active.phase} timer (${formatClock(active.remainingMs)} left).` };
  }

  function stop() {
    if (!active) return { was: null, text: 'No focus session was running.' };
    const was = active;
    active = null;
    return { was, text: `Ended the ${was.phase} session ("${was.label}").` };
  }

  /** Advances active session by dtMs; returns { done, phase, label, minutes } when a phase finishes, or null. */
  function tick(dtMs) {
    if (!active || active.paused) return null;
    active.remainingMs -= dtMs;
    if (active.remainingMs > 0) return null;
    const done = active;
    active = null;
    const mins = Math.round(done.durationMs / 60e3);
    if (done.phase === 'focus') {
      const today = dayOf(clock());
      const yesterday = dayOf(clock() - 86400e3);
      if (stats.lastDay === yesterday) stats.streak++;
      else if (stats.lastDay !== today) stats.streak = 1;
      stats.lastDay = today;
      stats.sessions++;
      stats.minutes += mins;
      save();
    }
    return { done: true, phase: done.phase, label: done.label, minutes: mins, stats: { ...stats } };
  }

  function status() {
    const s = `Completed ${stats.sessions} focus session${stats.sessions === 1 ? '' : 's'} (${stats.minutes} minutes total${stats.streak ? `, ${stats.streak}-day streak` : ''}).`;
    if (!active) return `No focus timer running. ${s}`;
    return `${active.phase === 'break' ? 'Break' : 'Focus'} ("${active.label}"): ${formatClock(active.remainingMs)} left${active.paused ? ' (paused)' : ''}. ${s}`;
  }

  function line() {
    if (!active) return '';
    return ` ${active.phase === 'break' ? 'Break' : 'Focus session'} in progress ("${active.label}", ${formatClock(active.remainingMs)} left${active.paused ? ', paused' : ''}) — keep replies brief and encouraging so you don't distract them.`;
  }

  return {
    get active() { return active ? { ...active } : null; },
    get stats() { return { ...stats }; },
    start, pause, resume, stop, tick, status, line,
  };
}
