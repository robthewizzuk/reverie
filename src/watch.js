// Watching a video together. A screen rolls down in the room, the video plays on it (YouTube's own player, or a video
// file from this device), and Reverie walks over, sits down beside you and watches. The camera moves back to a seat
// behind it, as if you were on the sofa together.
//
// What it knows of the video is words only: the title, the channel, the start of the description and the captions as
// timed lines (from /api/video: server/video.js asks YouTube, since a page can't), or, with no captions, what its ears
// catch of the sound. Nothing about the picture leaves the device, and nothing is sent while it just watches, except:
//  - now and then, at a quiet moment (a gap in the captions), what was said since it last spoke goes to Claude as
//    news, for a short reaction out loud (about every 80 s; "chatty" 40 s, "quiet" never). Its voice ducks the video
//    while it talks;
//  - when the video ends, for its take on it;
//  - with everything you say while it's on: where you are in the video and the last minute of what was said, so you
//    can ask "what did she mean?" or "go back to the bit about volcanoes" (find, seek and back look through the captions).
// Laughs, applause, music and gasps in the captions get a reaction from its body on the spot, on the device, for free.
// While a video plays the mic hears it too: speech that matches the captions is the video, not you; with no captions
// it is only you when you say its name (or the video is paused). Typing always works.
import gs from '../engine/src/gamescroll.js';
import { videoOf, clock, fitQuad } from './videos.js';

export { videoOf };

const API = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '') + '/api/video';
const SCREEN = { x: .1, y: 1.36, z: -.95, w: 1.7 };          // the pull-down screen's middle and width, in metres
SCREEN.h = SCREEN.w * 9 / 16;
// the sofa: behind it, looking a little down at the screen over its head (further back on a wide screen, which sees less
// up and down, so its head and the whole picture both fit)
// and where it sits to watch: in front, to the left, below the picture (further left on a wide screen, clear of its words)
const SOFA = { tall: { pos: [.1, 1.2, 2.3], look: [.05, .95, -.95], seat: { x: -.32, z: .35 } }, wide: { pos: [.1, 1.15, 3], look: [0, .72, -.95], seat: { x: -.68, z: .35 } } };
const BASE = { w: 640, h: 360 };                             // the player's own size in CSS pixels, before it is fitted
const GAPS = { quiet: Infinity, normal: 80, chatty: 40 };   // seconds between its comments
const FIRST_AFTER = 25;          // seconds into a video before its first comment
const LULL = 1.6;                // seconds of no captions ahead that make a quiet moment to talk in
const MIN_NEW = 140;             // characters said since its last comment, at least, before it has something to say about
const DUCK = .3;                 // the video's volume while it talks
const CONTEXT_SECONDS = 60;      // how much of what was said goes with each thing you say
const NAME = /\b(reverie|reveries|revery|reverie's|riverie|reverb|rev)\b/i;

const wordsOf = s => String(s).toLowerCase().replace(/\[[^\]]*\]/g, ' ').replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(w => w.length > 2);
const quote = lines => lines.map(l => l.text).join(' ').replace(/\s+/g, ' ').trim();
const tail = (s, n) => s.length > n ? '…' + s.slice(s.length - n).replace(/^\S*\s/, '') : s;

// ---- the players: YouTube's, a video file's, and a pretend one for tests. Each is
//   { el, ready: Promise, time(), duration(), state(): 'playing'|'paused'|'ended'|'waiting', play(), pause(), seek(s),
//     volume(0..1), title(), destroy() }

let ytLoading = null;
function loadYouTube() {
  return ytLoading ||= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { before?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
    s.onerror = () => { ytLoading = null; reject(new Error('YouTube could not be reached')); };
    document.head.append(s);
    setTimeout(() => { if (!window.YT?.Player) { ytLoading = null; reject(new Error('YouTube took too long to answer')); } }, 15000);
  });
}

function youTubePlayer(id, start, onError) {
  const el = document.createElement('div'), inner = document.createElement('div'); el.append(inner);
  let p = null, vol = 100, failed = null;
  const ready = loadYouTube().then(YT => new Promise((resolve, reject) => {
    p = new YT.Player(inner, {
      width: BASE.w, height: BASE.h, videoId: id,
      playerVars: { playsinline: 1, rel: 0, start: Math.floor(start) || undefined, origin: location.origin, iv_load_policy: 3 },
      events: {
        onReady: () => { try { vol = p.getVolume() || 100; } catch { /* fine */ } resolve(); },
        // 2 bad id, 5 can't play here, 100 gone or private, 101 and 150 the owner doesn't allow it on other sites
        onError: e => { failed = { 2: 'that link is not a video', 5: 'it cannot play here', 100: 'the video is gone or private', 101: 'its owner only lets it play on YouTube', 150: 'its owner only lets it play on YouTube', 153: 'its owner only lets it play on YouTube' }[e.data] || 'YouTube could not play it'; onError(failed); reject(new Error(failed)); },
      },
    });
  }));
  const S = { 0: 'ended', 1: 'playing', 2: 'paused', 3: 'waiting', 5: 'paused', '-1': 'paused' };
  return {
    el, ready, get failed() { return failed; },
    time: () => { try { return p?.getCurrentTime?.() || 0; } catch { return 0; } },
    duration: () => { try { return p?.getDuration?.() || 0; } catch { return 0; } },
    state: () => { try { return S[p?.getPlayerState?.()] || 'waiting'; } catch { return 'waiting'; } },
    play: () => p?.playVideo?.(), pause: () => p?.pauseVideo?.(), seek: s => p?.seekTo?.(Math.max(0, s), true),
    volume(k) { try { p?.setVolume?.(Math.round(vol * k)); } catch { /* fine */ } },
    keepVolume() { try { vol = p?.getVolume?.() ?? vol; } catch { /* fine */ } },
    title: () => { try { return p?.getVideoData?.().title || ''; } catch { return ''; } },
    destroy() { try { p?.destroy?.(); } catch { /* gone */ } el.remove(); },
  };
}

function filePlayer(file) {
  const el = document.createElement('video'), url = URL.createObjectURL(file);
  Object.assign(el, { src: url, controls: true, playsInline: true, preload: 'auto' });
  el.style.cssText = `width:${BASE.w}px;height:${BASE.h}px;background:#000`;
  let vol = 1;
  const ready = new Promise((resolve, reject) => { el.onloadedmetadata = resolve; el.onerror = () => reject(new Error('this browser cannot play that file')); });
  return {
    el, ready, failed: null,
    time: () => el.currentTime || 0, duration: () => el.duration || 0,
    state: () => el.ended ? 'ended' : el.paused ? 'paused' : el.readyState < 3 ? 'waiting' : 'playing',
    play: () => el.play().catch(() => {}), pause: () => el.pause(), seek: s => { el.currentTime = Math.max(0, s); },
    volume(k) { el.volume = Math.max(0, Math.min(1, vol * k)); }, keepVolume() { vol = el.volume; },
    title: () => file.name.replace(/\.[a-z0-9]+$/i, ''),
    destroy() { el.pause(); el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); el.remove(); },
  };
}

/** A pretend player for tests (dev server only): a coloured card whose clock runs. */
function testPlayer(seconds = 180) {
  const el = document.createElement('div');
  el.style.cssText = `width:${BASE.w}px;height:${BASE.h}px;background:linear-gradient(135deg,#3a7bd5,#8e54e9);color:#fff;font:700 40px system-ui;display:grid;place-items:center`;
  let t = 0, on = false, last = performance.now(), vol = 1, now = 1;
  const tick = () => { const n = performance.now(); if (on) t = Math.min(seconds, t + (n - last) / 1000); last = n; if (t >= seconds) on = false; el.textContent = clock(t); };
  return {
    el, ready: Promise.resolve(), failed: null, test: true,
    time: () => { tick(); return t; }, duration: () => seconds,
    state: () => { tick(); return t >= seconds ? 'ended' : on ? 'playing' : 'paused'; },
    play() { tick(); on = true; }, pause() { tick(); on = false; }, seek(s) { tick(); t = Math.max(0, Math.min(seconds, s)); },
    volume(k) { now = vol * k; }, keepVolume() {}, get level() { return now; },
    title: () => 'A test video', destroy() { el.remove(); },
  };
}

/**
 * makeWatch({ host, sheet, world, onNews(text, loud), state: () => ({ speaking, busy }), memory })
 * host: the element over the canvas the player is fitted into; sheet: the "what shall we watch?" sheet.
 */
export function makeWatch({ host, sheet, world, onNews = () => {}, state = () => ({}), memory = null, onOpen = () => {} }) {
  const { THREE, rbox, pbr } = gs.hd;
  let player = null, info = null, ears = [], screen = null, roll = 0, on = false, seated = false;
  let lastState = 'waiting', pausedFor = 0, toldPause = false, ended = false, sinceComment = 0, saidUpTo = 0, watched = 0;
  let opened = 0, chatter = 'normal', ducked = false, moodBack = 0, reactAt = 0, lastLine = -1, lastT = 0, error = null;
  const corner = new THREE.Vector3();

  // ---- the screen: a slim roller bar near the ceiling, a white sheet that rolls down, its dark picture area
  function makeScreen() {
    const g = new THREE.Group(), S = SCREEN;
    const pale = pbr('#ece6dd', { rough: .5 }), dark = pbr('#0d0d10', { rough: .35, metal: .1 });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, S.w + .16, 24), pale); bar.rotation.z = Math.PI / 2; bar.position.y = .02; g.add(bar);
    for (const s of [-1, 1]) { const cord = new THREE.Mesh(new THREE.CylinderGeometry(.004, .004, 3 - (S.y + S.h / 2) - .05, 6), pale); cord.position.set(s * (S.w / 2 - .1), (3 - (S.y + S.h / 2)) / 2, 0); g.add(cord); }
    const sheetG = new THREE.Group(); g.add(sheetG);
    const cloth = new THREE.Mesh(rbox(S.w + .08, S.h + .1, .008, .004), pbr('#f6f3ee', { rough: .9 })); cloth.position.set(0, -(S.h + .1) / 2, -.006); sheetG.add(cloth);
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(S.w, S.h), dark); pic.position.set(0, -.05 - S.h / 2, .0); sheetG.add(pic);
    const weight = new THREE.Mesh(rbox(S.w + .1, .03, .025, .01), pale); weight.position.set(0, -(S.h + .1), 0); sheetG.add(weight);
    g.position.set(S.x, S.y + S.h / 2 + .05, S.z);
    g.traverse(m => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
    g.userData.sheet = sheetG; g.userData.pic = pic;
    sheetG.scale.y = .001;
    world.view.scene.add(g);
    return g;
  }

  function fit() {
    if (!player || !screen) return;
    const show = roll > .98 && !error;
    host.hidden = !show; if (!show) return;
    const cam = world.view.cam, r = host.parentElement.getBoundingClientRect(), S = SCREEN, pts = [];
    cam.updateMatrixWorld();
    for (const [sx, sy] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
      corner.set(S.x + sx * S.w / 2, S.y + sy * S.h / 2, S.z + .002);
      // (behind the camera: nothing sensible to draw)
      if (corner.clone().applyMatrix4(cam.matrixWorldInverse).z > -.05) { host.hidden = true; return; }
      corner.project(cam);
      pts.push([(corner.x + 1) / 2 * r.width, (1 - corner.y) / 2 * r.height]);
    }
    host.firstElementChild.style.transform = fitQuad(BASE.w, BASE.h, pts);
  }

  // ---- what was said: the captions, or what its ears caught
  const lines = () => info?.lines?.length ? info.lines : ears;
  const between = (a, b) => lines().filter(l => l.t + (l.d || 0) > a && l.t <= b);
  const hasCaptions = () => !!info?.lines?.length;

  function newsSince(t) {
    const said = quote(between(saidUpTo, t));
    return tail(said, 650);
  }

  /** A comment: what was said since it last spoke, as news for a short reaction. */
  function comment(why) {
    const t = player.time(), said = newsSince(t);
    saidUpTo = t; sinceComment = 0;
    const title = info?.title || player.title() || 'the video';
    onNews(`[watch] ${why} (${clock(t)} into "${title}").${said ? ` Said since you last spoke: "${said}"` : ''} React out loud in one short line, like a friend on the sofa, or say nothing if nothing's worth it.`, true);
  }

  // ---- its body: sits, watches, turns to you to talk, reacts to laughs and music
  const faceScreen = () => Math.atan2(SCREEN.x - world.creature.root.position.x, SCREEN.z - world.creature.root.position.z);
  const faceYou = () => { const c = world.view.cam.position, p = world.creature.root.position; return Math.atan2(c.x - p.x, c.z - p.z); };
  function react(text) {
    const c = world.creature, now = performance.now();
    if (now < reactAt || c.busy) return;
    if (/\[(laughter|laughs?|laughing|chuckles?)\]|\((laughs?|laughter)\)|\bha(ha)+\b|\blol\b/i.test(text)) { c.gesture('bounce'); c.mood('happy'); }
    else if (/\[(applause|cheering|cheers|clapping)\]/i.test(text)) { c.gesture('tada'); c.mood('excited'); }
    else if (/\b(wow|whoa|woah|no way|oh my (god|gosh)|incredible|unbelievable)\b|\[gasps?\]/i.test(text)) c.mood('surprised');
    else if (/\[music\]|♪/i.test(text)) c.mood('happy');
    else return;
    reactAt = now + 5000; moodBack = 2.5;
  }

  const sofa = () => SOFA[world.view.cam.aspect < 1.1 ? 'tall' : 'wide'];
  async function sitDown() {
    seated = false;
    const s = sofa().seat;
    await world.walkTo(s.x, s.z);
    if (on) seated = true;
  }

  async function standUp() {
    seated = false;
    world.creature.walk(0, null);
    await world.goHome();
  }

  // ---- opening and closing
  async function open(src, o = {}) {
    if (!src) { sheet.show(); return 'The "what shall we watch?" sheet is open on their screen: they paste a YouTube link or pick a video file. You hear when it starts.'; }
    if (world.game) await world.stopGame();
    if (on) close(true);
    const my = ++opened;
    on = true; error = null; info = null; ears = []; ended = false; toldPause = false; pausedFor = 0; sinceComment = 0; saidUpTo = 0; watched = 0; lastLine = -1; lastState = 'waiting';
    sheet.hide();
    world.seat = { get pos() { return sofa().pos; }, get look() { return sofa().look; } };
    host.parentElement.classList.add('watching');
    screen ||= makeScreen(); screen.visible = true; roll = 0; gs.sound.sounds.whoosh?.();
    const c = world.creature; c.mood('excited'); c.gesture('tada');
    sitDown();
    const testing = import.meta.env.DEV && new URLSearchParams(location.search).has('fakeplayer');
    if (src.kind === 'file') player = filePlayer(src.file);
    else if (testing) player = testPlayer(o.seconds || 180);
    else player = youTubePlayer(src.id, src.start || 0, why => { error = why; });
    host.replaceChildren(player.el); host.hidden = true;
    player.el.style.transformOrigin = '0 0';
    onOpen();
    // what it says (in the background: the video can start before it comes)
    const said = src.kind === 'youtube' ? fetch(`${API}?v=${src.id}&lang=${encodeURIComponent(navigator.language || 'en')}`).then(r => r.json()).catch(() => null) : Promise.resolve(null);
    try { await Promise.race([player.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('the video took too long to load')), 20000))]); }
    catch (e) { if (my !== opened) return gone(); const why = error || e.message; close(); return { text: `Not shown: ${why}. Tell them kindly, and offer to watch something else.`, error: true }; }
    if (my !== opened) return gone();
    const got = await Promise.race([said, new Promise(r => setTimeout(() => r(null), 6000))]) || { lines: [] };
    if (my !== opened) return gone();
    info = got;
    if (!info.title) info.title = player.title();
    if (src.start) player.seek(src.start);
    player.play();
    // (a browser may not let a video start with sound until they tap it)
    for (let i = 0; i < 12 && player.state() !== 'playing'; i++) await new Promise(r => setTimeout(r, 200));
    if (my !== opened) return gone();
    const playing = player.state() === 'playing';
    memory?.note('watched', { what: info.title || 'a video' });
    const long = player.duration() || info.seconds || 0;
    return `The screen rolled down and "${info.title || 'the video'}"${info.channel ? ` by ${info.channel}` : ''} is on it${long ? `, ${clock(long)} long` : ''}. You're sitting down to watch it with them. `
      + (hasCaptions() ? 'It has captions, so you will know what is said. ' : src.kind === 'file' ? 'It is a video from their device, with no captions: you only know what your ears catch of it. ' : `You can't read its captions (${info.why || 'none'}), so you only know what your ears catch of it. `)
      + (playing ? 'It is playing now: say one short excited line and then let them watch.' : 'They press play on the screen to start it: tell them in one short line.')
      + (info.about ? ` Its description starts: "${info.about.slice(0, 300)}"` : '');
  }

  // (closed, or another video opened, while this one was still loading)
  const gone = () => ({ text: 'It was put away before it started.', error: true });

  function close(quietly = false) {
    if (!on) return 'Nothing was on the screen.';
    opened++;
    const title = info?.title || player?.title() || 'the video';
    on = false; seated = false; player?.destroy(); player = null; host.hidden = true; host.replaceChildren();
    world.seat = null; sheet.hide(); host.parentElement.classList.remove('watching');
    if (!quietly) { standUp(); world.creature.mood('calm'); gs.sound.sounds.whoosh?.(); }
    return `Rolled the screen back up and put "${title}" away.`;
  }

  /** Where they say something during a matching window: the lines with those words, best first. */
  function find(words) {
    const want = wordsOf(words); if (!want.length) return 'Give some words to look for.';
    const L = lines(); if (!L.length) return { text: hasCaptions() ? 'No captions yet.' : 'This video has no captions to look through.', error: true };
    const scored = L.map((l, i) => {
      const has = ws => want.filter(w => ws.has(w) || [...ws].some(x => x.length > 4 && (x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5))))).length;
      // (words in the line itself count double: a line next to one about it comes after the line itself)
      const hit = has(new Set(wordsOf(l.text))) * 2 + has(new Set(wordsOf(quote([L[i - 1], L[i + 1]].filter(Boolean)))));
      return { i, l, hit };
    }).filter(x => x.hit).sort((a, b) => b.hit - a.hit || a.i - b.i);
    const picked = []; for (const s of scored) { if (picked.every(p => Math.abs(p.l.t - s.l.t) > 20)) picked.push(s); if (picked.length >= 4) break; }
    if (!picked.length) return `Nothing about "${words}" is said in it.`;
    return `Where "${words}" comes up: ` + picked.map(p => `at ${clock(p.l.t)}: "${quote(L.slice(Math.max(0, p.i - 1), p.i + 2)).slice(0, 160)}"`).join('; ') + '. Use seek to go to one.';
  }

  /** Claude's watch tool. */
  async function command(input = {}) {
    const a = input.action;
    if (a === 'open') {
      const v = videoOf(input.video, true);
      if (v) return open(v);
      if (input.video && /\S/.test(input.video)) {
        // words, not a link: search YouTube (only when the backend has a search key)
        const r = await fetch(`${API}?q=${encodeURIComponent(input.video)}`).then(x => x.json()).catch(() => ({ error: 'no answer' }));
        if (r.results?.length) { const top = r.results[0]; const said = await open({ kind: 'youtube', id: top.id }); return typeof said === 'string' ? `Searched YouTube for "${input.video}" and picked the top one. ${said}` : said; }
        sheet.show(input.video);
        return { text: `Could not search YouTube (${r.error || 'nothing found'}). The "what shall we watch?" sheet is open: ask them to paste a YouTube link into it or into the chat.`, error: true };
      }
      return open(null);
    }
    if (!on || !player) return { text: 'Nothing is on the screen. Use open first.', error: true };
    if (a === 'close') return close();
    if (a === 'play') { player.play(); return 'Playing.'; }
    if (a === 'pause') { player.pause(); toldPause = true; return `Paused at ${clock(player.time())}.`; }
    if (a === 'seek' || a === 'back') {
      const to = a === 'back' ? player.time() - (Number(input.seconds) || 10) : Number(input.seconds);
      if (!Number.isFinite(to)) return { text: 'seek needs seconds from the start.', error: true };
      player.seek(to); saidUpTo = Math.max(0, to); player.play();
      return `Jumped to ${clock(to)}.`;
    }
    if (a === 'find') return find(input.words || '');
    if (a === 'chatter') { chatter = GAPS[input.chatter] ? input.chatter : 'normal'; return chatter === 'quiet' ? 'You will stay quiet while it plays, unless they talk to you.' : `You will chip in about every ${GAPS[chatter]} seconds, at quiet moments.`; }
    return { text: `Unknown watch action "${a}".`, error: true };
  }

  return {
    open, close, command, find,
    get on() { return on; },
    get player() { return player; },
    get info() { return info; },
    get playing() { return on && player?.state() === 'playing'; },
    get chatter() { return chatter; },

    /** Every frame, after the world: roll the screen, seat it, duck the sound, and pick moments to chip in. */
    update(dt) {
      if (screen) {
        const want = on ? 1 : 0; roll += Math.sign(want - roll) * Math.min(Math.abs(want - roll), dt / .9);
        const k = roll < .5 ? 2 * roll * roll : 1 - Math.pow(-2 * roll + 2, 2) / 2;
        screen.userData.sheet.scale.y = Math.max(.001, k); screen.visible = roll > .002;
      }
      if (!on || !player) return;
      fit();
      if (world.game) { close(); return; }
      const c = world.creature, st = player.state(), t = player.time(), talk = state();
      // sitting: facing the screen while it plays, round to you while it talks or it's paused
      if (seated && !world.walking) {
        const p = c.root.position;
        const s = sofa().seat;
        if (Math.hypot(p.x - s.x, p.z - s.z) > .3) sitDown();
        else c.walk(0, talk.speaking || st !== 'playing' ? faceYou() : faceScreen());
      }
      if (moodBack > 0 && (moodBack -= dt) <= 0) c.mood('curious');
      // its voice over the video: the video ducks while it talks
      if (talk.speaking !== ducked) { if (talk.speaking) player.keepVolume(); ducked = !!talk.speaking; player.volume(ducked ? DUCK : 1); }
      // what it changed to
      if (st !== lastState) {
        if (st === 'playing' && lastState !== 'waiting') { toldPause = false; c.mood('curious'); }
        if (st === 'playing' && !watched) c.mood('curious');
        if (st === 'ended' && !ended) { ended = true; comment('The video just finished'); c.mood('happy'); }
        lastState = st;
      }
      // (counted in the video's own seconds, which keep time even when frames are slow)
      const ran = st === 'playing' ? Math.max(0, Math.min(1, t - lastT)) : 0;
      if (st === 'playing') { watched += ran; sinceComment += ran; pausedFor = 0; ended = false; }
      if (st === 'paused' && watched > 0) {
        pausedFor += dt;
        if (pausedFor > 2 && !toldPause) { toldPause = true; onNews(`[watch] They paused it at ${clock(t)}.`, false); }
      }
      // a jump back or forward: carry on from there
      if (Math.abs(t - lastT - (st === 'playing' ? dt : 0)) > 3) saidUpTo = Math.min(saidUpTo, t);
      lastT = t;
      if (st !== 'playing') return;
      // new lines: its body reacts to laughs, applause, music and gasps
      const L = lines();
      for (let i = lastLine + 1; i < L.length && L[i].t <= t; i++) { lastLine = i; if (t - L[i].t < 4) react(L[i].text); }
      if (lastLine >= 0 && L[lastLine] && L[lastLine].t > t + 1) lastLine = L.findIndex(l => l.t > t) - 1;
      // a moment to chip in: long enough since the last time, enough said, and a quiet moment (no captions just ahead)
      const gap = GAPS[chatter];
      if (!Number.isFinite(gap) || watched < FIRST_AFTER || sinceComment < gap || talk.busy || talk.speaking || talk.listening) return;
      if (newsSince(t).length < MIN_NEW) return;
      const now = L.find(l => l.t <= t && t < l.t + l.d), next = L.find(l => l.t > t);
      const quiet = hasCaptions() ? !now && (!next || next.t - t >= LULL) : (!ears.length || t - ears[ears.length - 1].t > 4);
      // (no quiet moment for a long while, as in a talk with no pauses: at the end of a line)
      const lineEnd = now && now.t + now.d - t < .25;
      if (quiet || (sinceComment > gap + 30 && lineEnd) || (/\[music\]/i.test(now?.text || '') && sinceComment > gap)) comment('A quiet moment in the video');
    },

    /** The state of the watching, sent with everything they say while it's on. */
    context() {
      if (!on || !player) return '';
      const t = player.time(), st = player.state(), long = player.duration() || info?.seconds || 0;
      const said = tail(quote(between(t - CONTEXT_SECONDS, t)), 700);
      return `[watching "${info?.title || player.title() || 'a video'}"${info?.channel ? ` by ${info.channel}` : ''} on the screen together: ${clock(t)}${long ? ` of ${clock(long)}` : ''}, ${st === 'waiting' ? 'loading' : st}. `
        + (said ? `${hasCaptions() ? 'Said in the last minute' : 'What your ears caught lately (patchy)'}: "${said}"` : hasCaptions() ? 'Nothing said in the last minute.' : 'No captions; your ears caught nothing lately.') + ']';
    },

    /** The line above the chat bar. */
    bar() {
      if (!on || !player) return null;
      const st = player.state(), t = player.time(), long = player.duration();
      const hint = !hasCaptions() && st === 'playing' ? ' · say "Reverie…" to talk' : '';
      return { text: `${info?.title || player.title() || 'Watching'} · ${clock(t)}${long ? ' / ' + clock(long) : ''}${hint}`,
        buttons: [{ id: 'toggle', label: st === 'playing' ? 'Pause' : 'Play' }, { id: 'chatter', label: chatter === 'quiet' ? 'Quiet 🤫' : chatter === 'chatty' ? 'Chatty' : 'Chat: some' }, { id: 'close', label: 'Done' }] };
    },
    /** A button on that line. */
    button(id) {
      if (!player) return;
      if (id === 'toggle') { if (player.state() === 'playing') player.pause(); else player.play(); }
      else if (id === 'close') close();
      else if (id === 'chatter') chatter = chatter === 'normal' ? 'chatty' : chatter === 'chatty' ? 'quiet' : 'normal';
    },

    /**
     * The mic heard something while it's on: is it the video talking rather than them? With captions, words matching
     * what is being said now are the video; with none, anything not calling its name while it plays is.
     */
    isVideo(text) {
      if (!on || !player || player.state() !== 'playing' || !text) return false;
      if (NAME.test(text)) return false;
      if (!hasCaptions()) return true;
      const t = player.time(), heard = wordsOf(text); if (!heard.length) return false;
      const near = new Set(wordsOf(quote(between(t - 15, t + 3))));
      return heard.filter(w => near.has(w)).length / heard.length >= .4;
    },
    /** Something the mic heard from the video: kept as what its ears caught (when the video has no captions). */
    overheard(text) {
      if (!on || !player || hasCaptions()) return;
      const t = player.time(), s = String(text).trim(); if (!s) return;
      ears.push({ t: Math.max(0, t - Math.min(6, s.split(/\s+/).length * .35)), d: 2, text: s.slice(0, 300) });
      if (ears.length > 600) ears.shift();
      react(s);
    },
  };
}

/** The "what shall we watch?" sheet: paste a link, or pick a file. */
export function makeWatchSheet({ el, onPick }) {
  const input = el.querySelector('input[type=url]'), file = el.querySelector('input[type=file]'), note = el.querySelector('.note');
  const go = () => {
    const v = videoOf(input.value, true);
    if (!v) { note.textContent = "That doesn't look like a YouTube link. Copy it from the Share button on YouTube."; return; }
    onPick(v); input.value = '';
  };
  el.addEventListener('click', e => {
    const id = e.target.closest('button')?.dataset.id;
    if (id === 'close') sheet.hide(); else if (id === 'go') go(); else if (id === 'file') file.click();
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  file.addEventListener('change', () => { const f = file.files?.[0]; if (f) onPick({ kind: 'file', file: f }); file.value = ''; });
  const sheet = {
    get open() { return !el.hidden; },
    show(words = '') { el.hidden = false; note.textContent = words ? `I couldn't search for "${words}". Paste its YouTube link here instead.` : ''; setTimeout(() => input.focus({ preventScroll: true }), 50); },
    hide() { el.hidden = true; },
  };
  return sheet;
}
