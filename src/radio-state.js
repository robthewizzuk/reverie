// Pure state for Reverie's Cosy Workshop Radio & Ambient Soundscapes (no Three.js / Web Audio).
const KEY = 'reverie.radio.v1';

export const STATIONS = {
  fireplace: { name: 'Cosy Fireplace', about: 'warm crackling hearth fire', dial: '#ff8a3d' },
  rain: { name: 'Rain on Glass', about: 'gentle steady rain outside the window', dial: '#6db8ff' },
  forest: { name: 'Morning Forest', about: 'soft breeze and distant birdsong', dial: '#6ad482' },
  waves: { name: 'Ocean Surf', about: 'slow rolling waves on the shore', dial: '#4cd2d6' },
  cafe: { name: 'Cosy Café', about: 'warm coffee-shop hum and soft clinks', dial: '#e3b068' },
  lofi: { name: 'Lo-Fi Study Beats', about: 'chill procedural lo-fi groove for focus', dial: '#d482ff' },
};
export const STATION_NAMES = Object.keys(STATIONS);

export function stationOf(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return 'lofi';
  if (STATIONS[s]) return s;
  if (/fire|hearth|crackle|wood|cabin/.test(s)) return 'fireplace';
  if (/rain|storm|drizzle|patter/.test(s)) return 'rain';
  if (/forest|bird|woods|nature|wind/.test(s)) return 'forest';
  if (/wave|ocean|sea|beach|surf/.test(s)) return 'waves';
  if (/cafe|coffee|shop|murmur/.test(s)) return 'cafe';
  if (/lo.?fi|study|beat|chill|focus/.test(s)) return 'lofi';
  return null;
}

const memStore = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

export function makeRadioState({ store = typeof localStorage !== 'undefined' ? localStorage : memStore() } = {}) {
  let playing = false, station = 'lofi', volume = 55;
  try {
    const raw = JSON.parse(store.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      if (STATIONS[raw.station]) station = raw.station;
      if (Number.isFinite(raw.volume)) volume = Math.max(5, Math.min(100, Math.round(raw.volume)));
    }
  } catch { /* defaults */ }

  const save = () => { try { store.setItem(KEY, JSON.stringify({ station, volume })); } catch { /* private */ } };

  function play(raw) {
    const st = raw ? stationOf(raw) : station;
    if (!st) return { error: `Unknown radio station "${raw}". Stations: ${STATION_NAMES.join(', ')}.` };
    station = st; playing = true; save();
    return { station, text: `Tuned the workshop radio to ${STATIONS[st].name} (${STATIONS[st].about}).` };
  }

  function stop() {
    const was = playing;
    playing = false;
    return { was, text: was ? 'Switched off the workshop radio.' : 'The workshop radio was already off.' };
  }

  function next() {
    if (!playing) return play(STATION_NAMES[0]);
    const i = STATION_NAMES.indexOf(station);
    if (i === STATION_NAMES.length - 1) return stop();
    return play(STATION_NAMES[i + 1]);
  }

  function setVolume(v) {
    if (!Number.isFinite(v)) return { error: 'Give a volume from 0 to 100.' };
    volume = Math.max(0, Math.min(100, Math.round(v)));
    if (volume === 0) playing = false;
    save();
    return { volume, text: volume === 0 ? 'Muted the workshop radio.' : `Set the workshop radio volume to ${volume}%.` };
  }

  function list() {
    return STATION_NAMES.map(k => `${k} (${STATIONS[k].about})`).join('; ');
  }

  function line() {
    return playing ? ` Workshop radio playing: ${STATIONS[station].name} (${volume}%).` : '';
  }

  return {
    get playing() { return playing; },
    get station() { return station; },
    get volume() { return volume; },
    play, stop, next, setVolume, list, line,
  };
}
