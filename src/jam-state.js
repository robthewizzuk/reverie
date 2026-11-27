// Pure Pocket Jam Session state (no Three.js / audio), testable in Node.
export const JAM_STYLES = ['lofi', 'funk', 'disco', 'pop', 'rock', 'jazz', 'bossa', 'reggae', 'electro', 'arcade', 'cinematic', 'waltz'];
export const JAM_MOODS = ['groovy', 'happy', 'calm', 'dreamy', 'silly', 'heroic', 'spooky', 'epic'];
export const JAM_PADS = [
  { id: 'kick', label: 'Kick', colour: '#ff6b5b', sound: 'boing', cue: 'boing' },
  { id: 'snare', label: 'Rimshot', colour: '#ffaa44', sound: 'hit', cue: 'rimshot' },
  { id: 'clap', label: 'Clap', colour: '#ffd94a', sound: 'coin', cue: 'applause' },
  { id: 'bell', label: 'Chime', colour: '#5ce08a', sound: 'bell', cue: 'tada' },
  { id: 'zap', label: 'Zap', colour: '#58b8ff', sound: 'laser', cue: 'boing' },
  { id: 'pop', label: 'Sparkle', colour: '#c582ff', sound: 'heart', cue: 'magic' },
];

const clampBpm = b => Math.max(68, Math.min(168, Math.round(b)));

export function makeJamState() {
  let playing = false, style = 'lofi', mood = 'groovy', bpm = 104;
  const layers = { drums: true, bass: true, chords: true, lead: true };

  function apply(input = {}) {
    if (typeof input.style === 'string' && JAM_STYLES.includes(input.style.toLowerCase())) style = input.style.toLowerCase();
    if (typeof input.mood === 'string' && JAM_MOODS.includes(input.mood.toLowerCase())) mood = input.mood.toLowerCase();
    if (typeof input.bpm === 'number' && Number.isFinite(input.bpm)) bpm = clampBpm(input.bpm);
    if (input.faster) bpm = clampBpm(bpm + 16);
    if (input.slower) bpm = clampBpm(bpm - 16);
    for (const k of ['drums', 'bass', 'chords', 'lead']) {
      if (typeof input[k] === 'boolean') layers[k] = input[k];
    }
    if (!Object.values(layers).some(Boolean)) layers.drums = true;
  }

  function start(input = {}) { playing = true; apply(input); return summary(); }
  function change(input = {}) { if (!playing) playing = true; apply(input); return summary(); }
  function stop() { const was = playing; playing = false; return was; }
  function activeLayers() { return Object.entries(layers).filter(([, v]) => v).map(([k]) => k); }
  function summary() { return `${style} (${mood}) at ${bpm} bpm with ${activeLayers().join(', ')}`; }
  function line() { return playing ? ` Jam session playing: ${summary()}.` : ''; }

  return {
    get playing() { return playing; },
    get style() { return style; },
    get mood() { return mood; },
    get bpm() { return bpm; },
    get layers() { return { ...layers }; },
    activeLayers, start, change, stop, summary, line,
  };
}
