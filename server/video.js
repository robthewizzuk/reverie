// What a YouTube video says, for watching it together (src/watch.js). The page can't read YouTube's captions itself
// (another site), so it asks here, and this asks YouTube: the video's title, channel, length, the start of its
// description, and its captions as timed lines. Only text comes back; the video itself plays in YouTube's own player.
// Runs in the Vite dev server (server/dev.js) and in the Worker (worker/src/index.js), like turn.js.
//
//   GET /api/video?v=<11-letter id>&lang=en   -> { id, title, channel, seconds, about, lang, lines: [{ t, d, text }] }
//                                                 (lines empty, with why, when the video has no captions or YouTube said no)
//   GET /api/video?q=<words>                  -> { results: [{ id, title, channel }] } (only with YOUTUBE_API_KEY set)
//
// YouTube has no open API for captions, so this asks the way its Android app does, then its web page. Either can stop
// working when YouTube changes them; the page then watches without captions (its ears and the title still work).

const ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_LINES = 4000;                 // about three hours of captions
const ANDROID = { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'en', gl: 'GB' };
const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip';
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const json = (status, body, cache = 0) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache ? `public, max-age=${cache}` : 'no-store' } });

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const unescape = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e.toLowerCase()] ?? m);
const tidy = s => unescape(unescape(String(s).replace(/<[^>]+>/g, ''))).replace(/\s+/g, ' ').trim();

/** Captions as YouTube sends them (its two XML shapes, or json3) -> [{ t, d, text }] in seconds, in order. */
export function parseCaptions(body) {
  const out = [];
  const s = String(body || '').trim();
  if (s.startsWith('{')) {
    try {
      for (const e of JSON.parse(s).events || []) {
        const text = tidy((e.segs || []).map(x => x.utf8 || '').join(''));
        if (text) out.push({ t: (e.tStartMs || 0) / 1000, d: (e.dDurationMs || 0) / 1000, text });
      }
    } catch { /* not captions */ }
  } else {
    // <text start="1.2" dur="3.4">...</text>   or   <p t="1200" d="3400">...<s>...</s></p>
    for (const m of s.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
      const a = attrs(m[1]), text = tidy(m[2]);
      if (text) out.push({ t: +a.start || 0, d: +a.dur || 0, text });
    }
    if (!out.length) for (const m of s.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
      const a = attrs(m[1]), text = tidy(m[2]);
      if (text) out.push({ t: (+a.t || 0) / 1000, d: (+a.d || 0) / 1000, text });
    }
  }
  // (auto captions repeat a line as it rolls up: drop a line that is the end of the one before it)
  const lines = [];
  for (const l of out.sort((a, b) => a.t - b.t)) {
    const prev = lines[lines.length - 1];
    if (prev && prev.text === l.text) { prev.d = +Math.max(prev.d, l.t + l.d - prev.t).toFixed(2); continue; }
    lines.push({ t: +l.t.toFixed(2), d: +Math.max(.5, l.d).toFixed(2), text: l.text.slice(0, 300) });
    if (lines.length >= MAX_LINES) break;
  }
  return lines;
}
const attrs = s => Object.fromEntries([...String(s).matchAll(/([a-z]+)="([^"]*)"/gi)].map(m => [m[1], m[2]]));

/** The caption track to use: one in their language written by a person, then made by YouTube, then English, then any. */
export function pickTrack(tracks, lang = 'en') {
  if (!Array.isArray(tracks) || !tracks.length) return null;
  const base = String(lang).toLowerCase().split('-')[0];
  const is = (t, l) => String(t.languageCode || '').toLowerCase().split('-')[0] === l;
  const auto = t => t.kind === 'asr';
  return tracks.find(t => is(t, base) && !auto(t)) || tracks.find(t => is(t, base)) || tracks.find(t => is(t, 'en') && !auto(t))
    || tracks.find(t => is(t, 'en')) || tracks.find(t => !auto(t)) || tracks[0];
}

/** What YouTube says about the video (the player's data), asked as its Android app, then from its web page. */
async function playerData(id, fetcher) {
  try {
    const r = await fetcher('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': ANDROID_UA, 'x-youtube-client-name': '3', 'x-youtube-client-version': ANDROID.clientVersion },
      body: JSON.stringify({ context: { client: ANDROID }, videoId: id, contentCheckOk: true, racyCheckOk: true }),
    });
    if (r.ok) { const j = await r.json(); if (j?.videoDetails) return j; }
  } catch { /* try the page */ }
  try {
    const r = await fetcher(`https://www.youtube.com/watch?v=${id}&hl=en&bpctr=9999999999&has_verified=1`, { headers: { 'user-agent': WEB_UA, 'accept-language': 'en-GB,en;q=0.8' } });
    if (!r.ok) return null;
    const html = await r.text();
    const at = html.indexOf('ytInitialPlayerResponse = ');
    if (at < 0) return null;
    const start = html.indexOf('{', at + 'ytInitialPlayerResponse = '.length);
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; }
      else if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { end = i + 1; break; }
    }
    return end > start ? JSON.parse(html.slice(start, end)) : null;
  } catch { return null; }
}

/** Everything the page needs to watch video `id` with Reverie. */
export async function videoInfo(id, lang = 'en', fetcher = fetch) {
  if (!ID.test(id)) return { error: 'not a YouTube video id' };
  const p = await playerData(id, fetcher);
  const d = p?.videoDetails || {};
  const info = { id, title: d.title || '', channel: d.author || '', seconds: +d.lengthSeconds || 0, about: String(d.shortDescription || '').slice(0, 600), lang: '', lines: [] };
  if (!p) return { ...info, why: 'YouTube did not answer' };
  const status = p.playabilityStatus?.status;
  if (status && status !== 'OK') info.why = `YouTube says ${String(p.playabilityStatus?.reason || status).slice(0, 120)}`;
  const track = pickTrack(p.captions?.playerCaptionsTracklistRenderer?.captionTracks, lang);
  if (!track?.baseUrl) return { ...info, why: info.why || 'no captions' };
  try {
    const url = new URL(track.baseUrl);
    if (!/(^|\.)youtube\.com$/.test(url.hostname)) return { ...info, why: 'odd caption address' };
    url.searchParams.delete('fmt');
    const r = await fetcher(url.toString(), { headers: { 'user-agent': ANDROID_UA } });
    const lines = r.ok ? parseCaptions(await r.text()) : [];
    return { ...info, lang: track.languageCode || '', auto: track.kind === 'asr', lines, ...(lines.length ? {} : { why: 'the captions came back empty' }) };
  } catch (e) { return { ...info, why: 'the captions could not be fetched' }; }
}

/** YouTube search, with the YouTube Data API (only when YOUTUBE_API_KEY is set: 100 searches a day free). */
export async function search(words, env, fetcher = fetch) {
  if (!env.YOUTUBE_API_KEY) return { error: 'search is not set up' };
  const u = new URL('https://www.googleapis.com/youtube/v3/search');
  for (const [k, v] of Object.entries({ part: 'snippet', type: 'video', maxResults: '5', videoEmbeddable: 'true', safeSearch: 'strict', q: words.slice(0, 120), key: env.YOUTUBE_API_KEY })) u.searchParams.set(k, v);
  const r = await fetcher(u.toString());
  if (!r.ok) return { error: `search said ${r.status}` };
  const j = await r.json();
  return { results: (j.items || []).filter(x => x.id?.videoId).map(x => ({ id: x.id.videoId, title: tidy(x.snippet?.title || ''), channel: tidy(x.snippet?.channelTitle || '') })) };
}

/** Handles GET /api/video. */
export async function handleVideo(request, env = {}, fetcher = fetch) {
  if (request.method !== 'GET') return json(405, { error: 'GET only' });
  const q = new URL(request.url).searchParams;
  if (q.get('q')) return json(200, await search(String(q.get('q')), env, fetcher).catch(() => ({ error: 'search failed' })));
  const id = q.get('v') || '', lang = (q.get('lang') || 'en').slice(0, 12);
  if (!ID.test(id)) return json(400, { error: 'v must be a YouTube video id' });
  const info = await videoInfo(id, lang, fetcher).catch(() => ({ id, lines: [], why: 'it went wrong' }));
  // (a day in the browser's and Cloudflare's caches when it worked; not at all when it didn't, so a retry asks again)
  return json(200, info, info.lines?.length ? 86400 : 0);
}
