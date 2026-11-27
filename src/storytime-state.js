// Pure storytime state (no Three.js / browser globals), testable in Node.
export function makeStoryState() {
  let active = null;

  function start({ title = 'Bedtime Story', theme = '', mood = 'night' } = {}) {
    active = {
      title: String(title || 'Bedtime Story').trim().slice(0, 60),
      theme: String(theme || '').trim().slice(0, 80),
      mood: mood || 'night',
      puppet: '',
      speaker: 'narrator',
      beats: [],
      startedAt: Date.now(),
    };
    return active;
  }

  function puppet({ character = '', prop = '' } = {}) {
    if (!active) return null;
    active.speaker = String(character || 'narrator').trim().slice(0, 40);
    if (prop) active.puppet = String(prop).trim().slice(0, 60);
    return active;
  }

  function scene({ beat = '', mood = '' } = {}) {
    if (!active) return null;
    if (beat) active.beats.push(String(beat).trim().slice(0, 120));
    if (mood) active.mood = mood;
    return active;
  }

  function end() {
    const was = active;
    active = null;
    return was;
  }

  function line() {
    if (!active) return '';
    return ` Storytime in progress ("${active.title}"${active.puppet ? `, holding puppet: ${active.puppet}` : ''}, speaking as ${active.speaker}).`;
  }

  return {
    get active() { return active; },
    start, puppet, scene, end, line,
  };
}
