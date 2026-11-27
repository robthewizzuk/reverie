// Spotify: Reverie plays your music. You sign in once with Spotify's own page (PKCE: no secret, nothing on our
// server), and the sign-in is kept in this browser. Music plays in the page itself through Spotify's Web Playback
// SDK (Reverie shows up as a speaker called "Reverie" in your Spotify apps), or, where the page can't play it, on
// whatever device Spotify is already playing on (your phone, a speaker). Needs Spotify Premium.
//
// Spotify has to know the app: CLIENT_ID is the app's Client ID from developer.spotify.com (public, not a secret),
// and its redirect URIs must include this page's address with a / on the end. Spotify doesn't allow "localhost", so
// on the dev server the page moves itself to http://127.0.0.1:<port>/ before signing in.

const CLIENT_ID = import.meta.env?.VITE_SPOTIFY_CLIENT_ID || '8901ee5557824a94bc35a26e04e7de61';   // (Rob's Reverie app)
const SCOPES = ['streaming', 'user-read-email', 'user-read-private', 'user-read-playback-state', 'user-modify-playback-state',
  'user-read-currently-playing', 'playlist-read-private', 'user-library-read'];
const KEY = 'reverie.spotify';
const API = 'https://api.spotify.com/v1';
const ACCOUNTS = 'https://accounts.spotify.com';

const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  set(v) { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* private window */ } },
};
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomText = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
const redirectUri = () => location.origin + '/';
const clientId = () => { try { return localStorage.getItem(KEY + '.client') || CLIENT_ID; } catch { return CLIENT_ID; } };
/** Plain words for comparing names: "Chill Vibes!" and "chill vibes" match. */
const plain = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const byWho = t => (t.artists || []).map(a => a.name).slice(0, 2).join(' and ');

/**
 * makeSpotify({ onNews, onChange }): onNews(text, loud) tells Reverie things (signed in, a song started); onChange(now)
 * is called when what is playing changes. Returns the music part: connect(), command(input) for Claude's music tool,
 * line() for the line Claude reads each turn, duck(on) to turn it down while Reverie talks or listens.
 */
export function makeSpotify({ onNews = () => {}, onChange = () => {} } = {}) {
  let auth = store.get(), listeners = [];   // { access, refresh, expires }
  let player = null, deviceId = null, sdkProblem = null, now = null, volume = .7, ducked = false, lastState = 0;

  // ---- signing in
  async function connect() {
    if (!clientId()) return { text: 'Not done: Reverie has no Spotify app yet (its Client ID is not set).', error: true };
    // (Spotify won't send people back to "localhost": go to the same page at 127.0.0.1, and sign in from there)
    if (location.hostname === 'localhost') { location.replace(location.href.replace('//localhost', '//127.0.0.1').replace(/([?&])spotify=[^&]*/, '$1') + (location.search ? '&' : '?') + 'spotify=connect'); return { text: 'Moving to 127.0.0.1 to sign in.' }; }
    const verifier = randomText(48), state = randomText(12);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    sessionStorage.setItem(KEY + '.pkce', JSON.stringify({ verifier, state }));
    const q = new URLSearchParams({ client_id: clientId(), response_type: 'code', redirect_uri: redirectUri(), scope: SCOPES.join(' '), code_challenge_method: 'S256', code_challenge: challenge, state });
    location.assign(`${ACCOUNTS}/authorize?${q}`);
    return { text: 'Off to Spotify to sign in.' };
  }

  /** Back from Spotify's page with ?code=: swap it for tokens and tidy the address. Resolves true when signed in now. */
  async function finishSignIn() {
    const q = new URLSearchParams(location.search), code = q.get('code'), err = q.get('error'), state = q.get('state');
    if (!code && !err) return false;
    const pk = JSON.parse(sessionStorage.getItem(KEY + '.pkce') || 'null');
    sessionStorage.removeItem(KEY + '.pkce');
    for (const k of ['code', 'state', 'error']) q.delete(k);
    history.replaceState(null, '', location.pathname + (q.size ? '?' + q : '') + location.hash);
    if (err) { onNews(`[music] They didn't finish signing in to Spotify (${err}).`, true); return false; }
    if (!pk || pk.state !== state) { console.warn('[reverie] spotify: a sign-in answer that was not ours'); return false; }
    const r = await fetch(`${ACCOUNTS}/api/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), client_id: clientId(), code_verifier: pk.verifier }) });
    if (!r.ok) { console.warn('[reverie] spotify sign in', r.status, await r.text().catch(() => '')); onNews('[music] Signing in to Spotify didn\'t work.', true); return false; }
    keep(await r.json());
    return true;
  }

  function keep(t) {
    auth = { access: t.access_token, refresh: t.refresh_token || auth?.refresh, expires: Date.now() + (t.expires_in - 60) * 1000 };
    store.set(auth);
  }

  let refreshing = null;
  async function token() {
    if (!auth) throw new Error('not signed in to Spotify');
    if (Date.now() < auth.expires) return auth.access;
    refreshing ||= fetch(`${ACCOUNTS}/api/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refresh, client_id: clientId() }) })
      .then(async r => { if (!r.ok) { auth = null; store.set(null); throw new Error('the Spotify sign-in ran out; sign in again'); } keep(await r.json()); })
      .finally(() => { refreshing = null; });
    await refreshing;
    return auth.access;
  }

  /** A Web API call. Resolves the JSON (or null for an empty answer). */
  async function call(path, { method = 'GET', body, query } = {}) {
    const url = `${API}${path}${query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v != null)) : ''}`;
    for (let i = 0; i < 2; i++) {
      const r = await fetch(url, { method, headers: { authorization: `Bearer ${await token()}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 401 && i === 0) { auth.expires = 0; continue; }
      if (r.status === 429 && i === 0) { await new Promise(res => setTimeout(res, 1000 * Math.min(5, +r.headers.get('retry-after') || 1))); continue; }
      if (r.status === 204 || r.status === 202) return null;
      const text = await r.text(), json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
      if (!r.ok) { const e = new Error(json?.error?.message || `Spotify said ${r.status}`); e.status = r.status; e.reason = json?.error?.reason; throw e; }
      return json;
    }
  }

  // ---- the player in the page (Spotify's Web Playback SDK, loaded the first time music is wanted)
  let sdk = null;
  function loadSdk() {
    sdk ||= new Promise((resolve, reject) => {
      if (window.Spotify?.Player) return resolve();
      window.onSpotifyWebPlaybackSDKReady = resolve;
      const s = document.createElement('script'); s.src = 'https://sdk.scdn.co/spotify-player.js'; s.async = true;
      s.onerror = () => reject(new Error("Spotify's player didn't load"));
      document.head.append(s);
      setTimeout(() => reject(new Error("Spotify's player took too long to load")), 15000);
    });
    return sdk;
  }
  let ready = null;
  function startPlayer() {
    ready ||= (async () => {
      await loadSdk();
      player = new window.Spotify.Player({ name: 'Reverie', getOAuthToken: cb => token().then(cb, () => cb('')), volume });
      const id = new Promise(res => {
        player.addListener('ready', ({ device_id }) => { deviceId = device_id; console.info('[reverie] spotify: the page is a speaker now'); res(device_id); });
        player.addListener('not_ready', () => { deviceId = null; });
        for (const k of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) player.addListener(k, ({ message }) => {
          console.warn(`[reverie] spotify ${k}: ${message}`);
          if (k !== 'playback_error') { sdkProblem = k === 'account_error' ? 'this Spotify account has no Premium' : k === 'initialization_error' ? "this browser can't play Spotify in the page" : 'Spotify said no to the sign-in'; res(null); }
        });
        setTimeout(() => res(null), 10000);
      });
      player.addListener('player_state_changed', st => fromSdk(st));
      await player.connect();
      return id;
    })().catch(e => { sdkProblem = e.message; console.warn('[reverie] spotify player', e); return null; });
    return ready;
  }
  /** A tap lets the page make sound: the player needs one too (Safari, phones). */
  function tapped() { try { player?.activateElement?.(); } catch { /* fine */ } }

  function fromSdk(st) {
    lastState = performance.now();
    if (!st) { setNow(null); return; }
    const t = st.track_window?.current_track;
    setNow(t ? { title: t.name, by: byWho(t), uri: t.uri, id: t.id, durationMs: st.duration, playing: !st.paused, here: true } : null, st.position);
  }
  // where in the song it is: positionMs at performance.now() posAt (moving on while it plays)
  let posMs = 0, posAt = 0;
  function setNow(n, position) {
    if (position != null) { posMs = position; posAt = performance.now(); }
    const was = now; now = n;
    if (was?.uri !== n?.uri || was?.playing !== n?.playing) { onChange(now); for (const f of listeners) try { f(now); } catch (e) { console.warn('[reverie] spotify listener', e); } }
  }
  /** What is playing, asked of Spotify (any device). */
  async function refresh() {
    const p = await call('/me/player').catch(() => null);
    const t = p?.item;
    if (!(deviceId && p?.device?.id === deviceId && player)) setNow(t ? { title: t.name, by: byWho(t), uri: t.uri, id: t.id, durationMs: t.duration_ms, playing: !!p.is_playing, here: p.device?.id === deviceId, device: p.device?.name } : null, p?.progress_ms);
    return p;
  }

  /** The device to play on: the page if it can, else the one already playing, else the most recent one. */
  async function device() {
    const here = await startPlayer();
    if (here) return { id: here, here: true };
    const { devices = [] } = await call('/me/player/devices').catch(() => ({}));
    const d = devices.find(x => x.is_active) || devices[0];
    if (!d) throw new Error(`I can't play here (${sdkProblem || 'no player'}), and no other Spotify app is open. Open Spotify on a phone or computer first`);
    return { id: d.id, name: d.name, here: false };
  }

  // ---- finding music
  async function find(query, kind) {
    const q = String(query || '').trim();
    if (kind === 'liked' || /^(my )?(liked|saved|favou?rite)( songs| tracks)?$/i.test(q)) {
      const r = await call('/me/tracks', { query: { limit: 50 } });
      const uris = (r?.items || []).map(x => x.track?.uri).filter(Boolean);
      if (!uris.length) throw new Error('there are no liked songs');
      return { uris: shuffle(uris), say: 'your liked songs, shuffled' };
    }
    if (kind === 'playlist' || /\bplaylist\b/i.test(q)) {
      const name = plain(q.replace(/\b(my|the|playlist)\b/gi, ''));
      const mine = await call('/me/playlists', { query: { limit: 50 } }).catch(() => null);
      const own = (mine?.items || []).filter(Boolean).sort((a, b) => score(b.name, name) - score(a.name, name))[0];
      if (own && score(own.name, name) > 0) return { context: own.uri, say: `your playlist ${own.name}` };
    }
    const types = kind && kind !== 'any' ? [kind] : ['track', 'artist', 'playlist', 'album'];
    const r = await call('/search', { query: { q, type: types.join(','), limit: 5 } });
    const top = { track: r.tracks?.items?.filter(Boolean)[0], artist: r.artists?.items?.filter(Boolean)[0], album: r.albums?.items?.filter(Boolean)[0], playlist: r.playlists?.items?.filter(Boolean)[0] };
    // what was asked for: an artist when the words are just a name ("Taylor Swift"), a playlist for "chill music", else the song
    const pick = kind && kind !== 'any' ? kind
      : top.artist && plain(top.artist.name) === plain(q) ? 'artist'
      : top.track && (score(top.track.name, plain(q)) > .5 || score(`${top.track.name} ${byWho(top.track)}`, plain(q)) > .6) ? 'track'
      : /\b(music|songs|mix|vibes|hits|party|playlist|chill|workout|focus|study|relax|sleep|happy|dance|rock|pop|jazz|classical|christmas)\b/i.test(q) && top.playlist ? 'playlist'
      : top.track ? 'track' : top.playlist ? 'playlist' : top.artist ? 'artist' : top.album ? 'album' : null;
    const x = top[pick];
    if (!x) throw new Error(`nothing on Spotify matches "${q}"`);
    if (pick === 'track') return { context: x.album?.uri, offset: x.uri, uris: [x.uri], say: `${x.name} by ${byWho(x)}` };
    if (pick === 'artist') return { context: x.uri, say: `songs by ${x.name}` };
    if (pick === 'album') return { context: x.uri, say: `the album ${x.name} by ${byWho(x)}` };
    return { context: x.uri, say: `the playlist ${x.name}` };
  }
  // how much of the asked-for words are in a name: 0..1
  function score(name, want) {
    const a = plain(name).split(' '), w = plain(want).split(' ').filter(Boolean);
    if (!w.length) return 0;
    return w.filter(x => a.includes(x)).length / w.length;
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  async function play(query, kind) {
    const [what, d] = await Promise.all([find(query, kind), device()]);
    const body = what.context ? { context_uri: what.context, ...(what.offset ? { offset: { uri: what.offset } } : {}) } : { uris: what.uris };
    tapped();
    try { await call('/me/player/play', { method: 'PUT', query: { device_id: d.id }, body }); }
    catch (e) {
      // (some albums won't start from a track: play the track alone)
      if (what.context && what.uris) await call('/me/player/play', { method: 'PUT', query: { device_id: d.id }, body: { uris: what.uris } });
      else throw e;
    }
    if (!d.here) setTimeout(() => refresh(), 1200);
    return `Playing ${what.say}${d.here ? '' : ` on ${d.name}`}.`;
  }

  /** Claude's music tool: { action: connect | play | pause | resume | next | previous | volume | now | disconnect, query, kind, level } */
  async function command(input = {}) {
    const act = input.action;
    if (act === 'connect') return connect();
    if (act === 'disconnect') { auth = null; store.set(null); try { player?.disconnect(); } catch { /* gone */ } player = null; ready = null; deviceId = null; setNow(null); return 'Signed out of Spotify on this device.'; }
    if (!auth) return { text: 'Not done: you are not signed in to their Spotify yet. A "Connect Spotify" button is on their screen; ask them to tap it (or use action connect when they say yes).', error: true, needsSignIn: true };
    try {
      switch (act) {
        case 'play': return input.query ? await play(input.query, input.kind) : await resume();
        case 'resume': return await resume();
        case 'pause': if (player && now?.here) await player.pause(); else await call('/me/player/pause', { method: 'PUT' }); setNow(now && { ...now, playing: false }); return 'Paused.';
        case 'next': if (player && now?.here) await player.nextTrack(); else await call('/me/player/next', { method: 'POST' }); return 'Skipped to the next song.';
        case 'previous': if (player && now?.here) await player.previousTrack(); else await call('/me/player/previous', { method: 'POST' }); return 'Back to the last song.';
        case 'volume': {
          const lv = Math.max(0, Math.min(100, Math.round(+input.level)));
          if (!isFinite(lv)) return { text: 'Not done: level must be 0 to 100.', error: true };
          volume = lv / 100;
          if (player && now?.here) await player.setVolume(ducked ? volume * DUCK : volume); else await call('/me/player/volume', { method: 'PUT', query: { volume_percent: lv } });
          return `The volume is ${lv}.`;
        }
        case 'now': { if (!player || !now?.here) await refresh(); return now ? `${now.playing ? 'Playing' : 'Paused on'} ${now.title} by ${now.by}${now.device && !now.here ? ` on ${now.device}` : ''}.` : 'Nothing is playing.'; }
        default: return { text: 'Not done: action must be connect, play, pause, resume, next, previous, volume, now or disconnect.', error: true };
      }
    } catch (e) {
      const m = e.status === 403 ? 'Spotify says this needs Premium, or it is not allowed right now' : e.status === 404 ? 'no Spotify device is active; open Spotify on a device, or try again in a moment' : String(e.message || e);
      return { text: `Not done: ${m}.`, error: true };
    }
  }
  async function resume() {
    if (player && now?.here) { tapped(); await player.resume(); return 'Playing again.'; }
    const d = await device();
    await call('/me/player/play', { method: 'PUT', query: { device_id: d.id } });
    if (!d.here) setTimeout(() => refresh(), 1200);
    return 'Playing again.';
  }

  // ---- turning it down while Reverie talks or listens (only the page's own player: other devices are left alone)
  const DUCK = .3;
  let duckGoal = false, duckBusy = false;
  async function duck(on) {
    duckGoal = !!on;
    if (!player || !now?.here || !now.playing || duckBusy || duckGoal === ducked) return;
    duckBusy = true;
    try { ducked = duckGoal; await player.setVolume(ducked ? volume * DUCK : volume); } catch { /* fine */ } finally { duckBusy = false; }
    if (duckGoal !== ducked) duck(duckGoal);
  }

  // (another device's music is asked about now and then, so Reverie knows when it stops)
  let pollT = 0;
  function update(dt) {
    if (!auth) return;
    pollT -= dt;
    if (pollT <= 0) { pollT = now?.playing ? 15 : 45; if (!(now?.here && performance.now() - lastState < 30000)) refresh().catch(() => {}); }
  }

  return {
    get signedIn() { return !!auth; },
    get hasApp() { return !!clientId(); },
    /** What is playing: { title, by, playing, here, device } or null. */
    get now() { return now; },
    get playing() { return !!now?.playing; },
    /** How far into the song it is now, in ms (worked out between Spotify's updates; for karaoke lyrics). */
    positionMs() { return now ? posMs + (now.playing ? performance.now() - posAt : 0) : 0; },
    /** Calls fn(now) whenever the song or play/pause changes (as well as the onChange it was made with). */
    onState(fn) { listeners.push(fn); },
    /** True when the music comes out of this page (so the mic hearing lyrics is the page's own sound). */
    get here() { return !!now?.here; },
    connect, finishSignIn, command, duck, tapped, update, startPlayer,
    /** The line Claude reads at the top of each turn. */
    line() {
      if (!auth) return '';
      return now ? ` Music: ${now.playing ? 'playing' : 'paused on'} "${now.title}" by ${now.by}${now.here ? '' : now.device ? ` on ${now.device}` : ''}.` : ' Music: Spotify is connected, nothing playing.';
    },
  };
}
