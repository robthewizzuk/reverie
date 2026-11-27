// Karaoke: Reverie sings a song with the band playing, the words on screen lighting up syllable by syllable as they
// are sung, a mirror ball and party lights in the room (party.js), and Reverie bopping to the beat. Three ways:
//   sing: Reverie sings it all; duet: it sings a line, then you sing the next; you: you sing, it dances and cheers
//   (the tune played softly as a guide). Songs: its own (songs.js), two old ones (Twinkle Twinkle, Happy Birthday), or
//   new words Claude writes on the spot (tune.js sets them to a tune over the composer's band).
// And with their own music: a Spotify song they have added an LRC file for (lyrics.js) shows its words in time with
// the song, the party lights come up, and Reverie dances; they sing.
// Its voice sings through the engine (gs.sound.say with sing: each syllable held on its note), each line written ahead
// of time and started when the band reaches it. While a song plays the mic only takes words with its name in them or
// a stop, so the singing isn't heard as talk.
import gs from '../engine/src/gamescroll.js';
import { written, fixed, lengthOf } from './tune.js';
import { OWN, songNamed, songList } from './songs.js';
import { sayOptions } from './looks.js';

const LEAD = .03;            // seconds early each line is started (the voice's own start-up)
const AHEAD = 4;             // lines written ahead of where the song is
const NAME = /\b(reverie|revurry|revery|riverie|reveri)\b/i;
const STOP = /^\s*(hey\s+)?(stop|enough|that's enough|end (the|this) song|stop (the )?(song|singing|karaoke))\b/i;
// the room it sings in: a little hall, unless its voice already has an echo of its own (looks.js)
const HALL = { tail: 1.5, wet: .26 };

/**
 * makeKaraoke({ world, el (#karaoke), music (music.js), lyrics (lyrics.js), memory, onNews(text, loud), echo() (its voice's own echo) })
 * Returns { tools: { karaoke }, update(dt), line(), heardOk(text), playing, lyricsFor(file) }.
 */
export function makeKaraoke({ world, el, music = null, lyrics = null, memory = null, onNews = () => {}, echo = () => null }) {
  const creature = world.creature;
  const titleEl = el?.querySelector('.title'), nowEl = el?.querySelector('.now'), nextEl = el?.querySelector('.next'), whoEl = el?.querySelector('.who');
  let song = null, tune = null, mode = 'sing', ni = 0, prepared = 0, shownLine = -2, ending = 0, started = false, spotLyrics = null, spotKey = '';

  const sings = i => mode === 'sing' || (mode === 'duet' && i % 2 === 0);
  const singOpts = line => ({ ...sayOptions(), sing: line.notes });

  /** The song asked for, planned: Claude's own words, a song by name, or one of its own picked at random. */
  function planFor(input) {
    const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : memory?.name || null;
    if (Array.isArray(input.verse) || Array.isArray(input.chorus)) {
      return written({ title: input.title || 'A new song', verse: input.verse, chorus: input.chorus, verse2: input.verse2, bridge: input.bridge, mood: input.mood || 'happy', style: input.style || null, seed: input.title || input.chorus?.[0] });
    }
    const hit = songNamed(input.song) || (input.song ? null : { own: Object.values(OWN)[Math.floor(Math.random() * Object.keys(OWN).length)] });
    if (!hit) return null;
    return hit.own ? written(hit.own) : fixed(hit.fixed, { name });
  }

  function render(t) {
    if (!el || !song) return;
    // the line being sung now (or about to be), its syllables lit as they are sung, the next line under it
    let i = -1; for (let j = 0; j < song.lines.length; j++) if (song.lines[j].start - .35 <= t) i = j;
    const L = song.lines[i], N = song.lines[i + 1];
    if (i !== shownLine) {
      shownLine = i;
      nowEl.replaceChildren(...(L ? spansOf(L) : [document.createTextNode(i < 0 ? '♪ ♪ ♪' : '')]));
      nextEl.textContent = N ? N.text : '';
      el.classList.toggle('yours', !!L && !sings(i));
      if (whoEl) whoEl.textContent = mode === 'sing' || !L ? '' : sings(i) ? 'Reverie' : 'You!';
    }
    if (L) {
      const spans = nowEl.children;
      L.syl.forEach((s, k) => { const sp = spans[k]; if (sp) sp.style.setProperty('--k', Math.max(0, Math.min(1, (t - s.at) / Math.max(.08, Math.min(s.len, .5)))).toFixed(3)); });
    }
  }
  // each syllable a span (with the spaces between words kept), lit by --k 0..1
  function spansOf(L) {
    const out = [], text = L.text, syl = gs.sound.syllables(text); let at = 0;
    syl.forEach((s, k) => {
      const sp = document.createElement('span'); sp.textContent = text.slice(at, k + 1 < syl.length ? syl[k + 1].at : text.length); at = k + 1 < syl.length ? syl[k + 1].at : text.length;
      sp.style.setProperty('--k', '0'); out.push(sp);
    });
    return out;
  }

  async function start(input) {
    stop(false);
    const plan = planFor(input);
    if (!plan) return { text: `Not started: "${input.song}" is not a song you know. You know: ${songList()}. Or write new words (verse and chorus).`, error: true };
    song = plan; mode = ['duet', 'you'].includes(input.mode) ? input.mode : 'sing'; ni = 0; prepared = 0; shownLine = -2; ending = 0; started = false;
    if (music?.spotify?.playing) await music.spotify.command({ action: 'pause' }).catch(() => {});
    el.hidden = false; el.classList.add('on'); titleEl.textContent = song.title; nowEl.textContent = 'Warming up…'; nextEl.textContent = '';
    world.party.on = true;
    try { gs.sound.mixer.place(echo() || HALL, .5); } catch { /* no audio yet */ }
    // the first lines written before the band starts (a few seconds at most), the rest while it plays
    const first = song.lines.filter((_, i) => sings(i)).slice(0, 2);
    await Promise.race([Promise.all(first.map(l => gs.sound.prepare(l.text, singOpts(l)).catch(() => false))), new Promise(r => setTimeout(r, 7000))]);
    prepared = Math.min(song.lines.length, 2);
    if (song !== plan) return { text: 'The song was stopped.' };
    const guide = mode === 'sing' ? {} : { lead: song.guide, layers: undefined };
    tune = gs.sound.music({ ...song.music, ...guide, vol: .85 });
    tune.start(); started = true;
    const who = mode === 'sing' ? 'You are singing it' : mode === 'duet' ? 'You are singing it as a duet: you sing the first line, they sing the next, and so on (the screen shows whose line it is)' : 'They are singing it, and you dance and cheer them on (the tune plays softly to guide them)';
    return { text: `"${song.title}" is starting, about ${Math.round(lengthOf(song) / 60 * 2) / 2} minutes long, the words on their screen and party lights up. ${who}. Stay quiet while it plays (talking stops the song's voice): you will be told when it ends.` };
  }

  /** Stops the song (and the lights). done: it reached its end. */
  function stop(done = false) {
    const was = song;
    if (tune) { try { tune.stop(); } catch { /* gone */ } tune = null; }
    if (song) { try { gs.sound.stopTalking(); } catch { /* none */ } }
    song = null; started = false; creature.groove = null;
    if (!spotLyrics) { world.party.on = false; if (el) { el.classList.remove('on'); el.hidden = true; } }
    try { gs.sound.mixer.place(echo(), .8); } catch { /* no audio */ }
    if (was && done) {
      creature.gesture?.('tada'); world.celebrate?.();
      onNews(`[karaoke] "${was.title}" just finished${mode === 'you' ? ' (they sang it: cheer them on!)' : mode === 'duet' ? ' (your duet together)' : ''}. Say one short happy line about it.`, true);
    }
    return was;
  }

  // their Spotify song's own lyrics, if they added them (lyrics.js)
  function spotifyLyrics() {
    const now = music?.spotify?.now;
    const key = now ? `${now.title}|${now.by}` : '';
    if (key !== spotKey) { spotKey = key; spotLyrics = now && lyrics ? lyrics.get(now.title, now.by) : null; shownLine = -2; }
    return now?.playing && spotLyrics ? spotLyrics : null;
  }
  function renderLrc(L, t) {
    let i = -1; for (let j = 0; j < L.lines.length; j++) if (L.lines[j].at - .4 <= t) i = j;
    const cur = L.lines[i], nxt = L.lines[i + 1];
    if (i !== shownLine) {
      shownLine = i;
      titleEl.textContent = music.spotify.now?.title || L.title;
      nowEl.replaceChildren(...(cur ? (cur.words || [{ text: cur.text }]).map(w => { const s = document.createElement('span'); s.textContent = w.text; s.style.setProperty('--k', '0'); return s; }) : [document.createTextNode('♪ ♪ ♪')]));
      nextEl.textContent = nxt?.text || ''; el.classList.add('yours'); if (whoEl) whoEl.textContent = '';
    }
    if (cur) {
      const spans = nowEl.children;
      if (cur.words) cur.words.forEach((w, k) => { const nx = cur.words[k + 1]?.at ?? cur.end; spans[k]?.style.setProperty('--k', Math.max(0, Math.min(1, (t - w.at) / Math.max(.1, Math.min(nx - w.at, .8)))).toFixed(3)); });
      else spans[0]?.style.setProperty('--k', Math.max(0, Math.min(1, (t - cur.at) / Math.max(.4, Math.min(cur.end - cur.at, 8) * .85))).toFixed(3));
    }
  }

  return {
    get playing() { return !!song; },
    tools: {
      karaoke: async input => {
        if (input?.action === 'stop') { const was = stop(false); return was ? `You stopped "${was.title}".` : 'No song was playing.'; }
        if (input?.action === 'list') return `Songs you know: ${songList()}. You can also write new words for any song they ask for.${lyrics?.list().length ? ` They have added the words of these songs of theirs (for when they play them on Spotify): ${lyrics.list().join(', ')}.` : ''}`;
        return start(input || {});
      },
    },
    update(dt) {
      // their own song with its lyrics: the words in time with Spotify, the lights up
      if (!song) {
        const L = spotifyLyrics();
        if (L && el) { el.hidden = false; el.classList.add('on'); world.party.on = true; renderLrc(L, music.spotify.positionMs() / 1000); const b = music.groove?.now?.(); if (b) world.party.beat(b.phase); }
        else if (el && !el.hidden && el.classList.contains('on')) { el.classList.remove('on'); el.hidden = true; world.party.on = false; shownLine = -2; }
        return;
      }
      if (!started || !tune) return;
      const pos = tune.pos; if (pos < 0) return;
      const t = pos * song.stepSec, beats = t * song.bpm / 60, phase = beats % 1;
      world.party.beat(phase);
      creature.groove = { beat: Math.floor(beats), phase, amount: creature.state.speaking ? .5 : .85 };
      // each of its lines started as the band reaches it (a line it is late for by more than half a second is let go)
      while (ni < song.lines.length && t >= song.lines[ni].start - LEAD) {
        const i = ni++, L = song.lines[i];
        if (!sings(i) || t > L.start + .5) continue;
        creature.say(L.text, singOpts(L)).catch(() => {});
      }
      // the next few written ahead
      while (prepared < Math.min(song.lines.length, ni + AHEAD)) { const L = song.lines[prepared], i = prepared++; if (sings(i)) gs.sound.prepare(L.text, singOpts(L)).catch(() => {}); }
      render(t);
      if (t >= lengthOf(song) - .05) stop(true);
    },
    /** The line Claude reads each turn. */
    line() {
      if (song) return ` You are in the middle of karaoke: "${song.title}" (${mode === 'sing' ? 'you are singing' : mode === 'duet' ? 'a duet' : 'they are singing'}).`;
      if (spotLyrics && music?.spotify?.playing) return ' The words of the song playing are on their screen, karaoke style, and the party lights are up.';
      return '';
    },
    /** Is what the mic heard them talking? While a song plays, only with its name or a stop in it. */
    heardOk: text => !song || NAME.test(text) || STOP.test(text),
    /** An LRC file they picked: kept for the song playing (or the one it names). Returns a sentence for Claude. */
    async lyricsFor(file) {
      const text = await file.text(), now = music?.spotify?.now;
      const r = lyrics?.add(text, { title: now?.title, artist: now?.by });
      spotKey = ''; shownLine = -2;
      return r ? `[karaoke] They added the words of "${r.title}"${r.artist ? ` by ${r.artist}` : ''} (${r.lines.length} lines). They show in time whenever it plays on Spotify.`
        : '[karaoke] They tried to add a lyrics file, but it had no timed lines (it needs to be an LRC file, with a time like [00:12.34] before each line).';
    },
  };
}
