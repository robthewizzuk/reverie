// Lyrics for their own songs: LRC files they add themselves (a song's words with the time each line starts, the
// format karaoke players use: "[01:02.50]Words of the line"; word times "<01:02.80>" inside a line are read too).
// Kept in this browser only, by song (title and artist), and shown in time with what Spotify is playing. Reverie never
// fetches lyrics from the web: the lyrics of chart songs are owned by their publishers, and no free source is licensed
// to hand them out, so they come from the person, for their own use.

const KEY = 'reverie.lyrics.v1';
const MAX = 60;   // songs kept

/** Seconds from "mm:ss.xx" (or "mm:ss:xx", "h:mm:ss.xx"). */
function secs(s) {
  const p = String(s).replace(/:(\d\d)$/, '.$1').split(':').map(Number);
  if (p.some(x => !isFinite(x))) return NaN;
  return p.reduce((a, x) => a * 60 + x, 0);
}

/**
 * An LRC file read: { title, artist, lines: [{ at (s), end (s), text, words: [{ text, at }] | null }] }, or null if it
 * has no timed lines. [offset:+/-ms] is applied; lines with several times ("[00:12.00][01:30.00]Chorus") are copied.
 */
export function parseLrc(src) {
  const lines = [], tags = {};
  for (const raw of String(src || '').split(/\r?\n/)) {
    const tag = /^\s*\[(ti|ar|al|offset|length|by):([^\]]*)\]\s*$/i.exec(raw);
    if (tag) { tags[tag[1].toLowerCase()] = tag[2].trim(); continue; }
    const times = []; let rest = raw, m;
    while ((m = /^\s*\[(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)\]/.exec(rest))) { times.push(secs(m[1])); rest = rest.slice(m[0].length); }
    if (!times.length) continue;
    // word times: <mm:ss.xx>word
    let words = null;
    if (/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/.test(rest)) {
      words = [];
      for (const w of rest.matchAll(/<(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)>([^<]*)/g)) if (w[2].trim()) words.push({ text: w[2], at: secs(w[1]) });
      rest = rest.replace(/<[^>]*>/g, '');
    }
    const text = rest.replace(/\s+/g, ' ').trim();
    for (const at of times) if (isFinite(at)) lines.push({ at, text, words: words && times.length === 1 ? words : null });
  }
  if (!lines.length) return null;
  const off = (+tags.offset || 0) / 1000;   // (positive: the words come sooner)
  lines.sort((a, b) => a.at - b.at);
  for (const l of lines) { l.at = Math.max(0, l.at - off); if (l.words) for (const w of l.words) w.at = Math.max(0, w.at - off); }
  lines.forEach((l, i) => { l.end = i + 1 < lines.length ? lines[i + 1].at : l.at + 5; });
  return { title: tags.ti || '', artist: tags.ar || '', lines: lines.filter(l => l.text) };
}

/** The line being sung at time t (s) and how far through it (0..1), and the next: { i, line, k, next }. */
export function lineAt(lyrics, t) {
  const L = lyrics?.lines || [];
  let i = -1; for (let j = 0; j < L.length; j++) { if (L[j].at <= t) i = j; else break; }
  const line = L[i] || null;
  return { i, line, k: line ? Math.max(0, Math.min(1, (t - line.at) / Math.max(.3, Math.min(line.end, line.at + 8) - line.at))) : 0, next: L[i + 1] || null };
}

const norm = s => String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]|-\s*(remaster|live|radio edit|feat).*$/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const keyOf = (title, artist) => `${norm(title)}|${norm(String(artist || '').split(/,|&| and /)[0])}`;

function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
function store(all) {
  const ks = Object.keys(all); while (ks.length > MAX) delete all[ks.shift()];
  try { localStorage.setItem(KEY, JSON.stringify(all)); return true; } catch { return false; }
}

/** Kept lyrics: get(title, artist), add(lrcText, { title, artist }) -> { title, artist, lines } | null, remove, list. */
export function makeLyrics() {
  return {
    get(title, artist) {
      const all = load(), hit = all[keyOf(title, artist)] || Object.entries(all).find(([k]) => k.split('|')[0] === norm(title))?.[1];
      return hit ? parseLrc(hit.lrc) : null;
    },
    /** Adds an LRC file's words for a song: its own [ti:] and [ar:] tags, else the song given (what is playing). */
    add(lrc, { title = '', artist = '' } = {}) {
      const p = parseLrc(lrc); if (!p) return null;
      const t = p.title || title, a = p.artist || artist; if (!t) return null;
      const all = load(); all[keyOf(t, a)] = { title: t, artist: a, lrc: String(lrc).slice(0, 60000) }; store(all);
      return { ...p, title: t, artist: a };
    },
    remove(title, artist) { const all = load(); delete all[keyOf(title, artist)]; store(all); },
    list: () => Object.values(load()).map(x => `${x.title}${x.artist ? ' by ' + x.artist : ''}`),
  };
}
