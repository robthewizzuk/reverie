// Music and dancing: Spotify (spotify.js) plays the songs, the microphone hears the beat (groove.js), and Reverie
// dances to it with its core and the room's lights pulsing on the beat. It dances by itself whenever its Spotify music
// plays, and to any music in the room when asked ("dance with me!"). The music is turned down while it talks or
// listens. A little pill on the stage shows the song, with pause and skip, and the Connect Spotify button.
import { makeSpotify } from './spotify.js';
import { makeGroove, freeBeat } from './groove.js';

// heard while music plays: a lyric coming through the mic isn't them talking, so it counts only with its name in it
// or as a music command ("pause", "skip", "turn it down")
const NAME = /\b(reverie|revurry|revery|reverie's|riverie|reveri)\b/i;
const COMMAND = /^\s*(hey\s+)?(stop|pause|skip|next|previous|go back|louder|quieter|turn (it |the music )?(up|down|off)|volume|play\b|change (the )?song|stop dancing|what('s| is) (this|playing))/i;

/**
 * makeMusic({ world, el, onNews }): el is the #music pill. Returns { tools, update(dt), line(), tapped(), heardOk(text),
 * spotify, groove }. onNews(text, loud) passes news on to Claude.
 */
export function makeMusic({ world, el, onNews = () => {} }) {
  const creature = world.creature, label = el?.querySelector('span');
  let want = null;         // why it dances: 'music' (its Spotify is playing) or 'asked'; null: not dancing
  let free = null, t = 0, askConnect = false;
  const groove = makeGroove();

  const spotify = makeSpotify({
    onNews,
    onChange: now => {
      // its own music started: dance; it stopped: stop (unless asked to dance anyway)
      if (now?.playing) { if (!want) start('music'); }
      else if (want === 'music') stop();
      show();
    },
  });

  async function start(why) {
    want = why;
    const heard = await groove.start();
    if (why === 'asked' && world.pet) world.pet({ action: 'trick', trick: 'dance' }).catch?.(() => {});
    return heard;
  }
  function stop() { want = null; free = null; groove.stop(); creature.groove = null; if (world.light) world.light.pulse = 0; }

  function show() {
    if (!el) return;
    const n = spotify.now;
    el.hidden = !(n || askConnect);
    el.classList.toggle('connect', !n && askConnect);
    if (label) label.textContent = n ? `${n.title} · ${n.by}` : 'Play music with Reverie';
    for (const b of el.querySelectorAll('button')) b.hidden = b.dataset.id === 'connect' ? !!n || !askConnect : !n;
    const pp = el.querySelector('[data-id="toggle"]');
    if (pp) { pp.textContent = n?.playing ? '❚❚' : '▶'; pp.ariaLabel = n?.playing ? 'Pause' : 'Play'; }
  }
  el?.addEventListener('click', async e => {
    const id = e.target.closest('button')?.dataset.id; if (!id) return;
    spotify.tapped();
    if (id === 'connect') spotify.connect();
    else if (id === 'toggle') await spotify.command({ action: spotify.playing ? 'pause' : 'resume' });
    else if (id === 'next') await spotify.command({ action: 'next' });
    show();
  });

  // back from Spotify's sign-in page, or sent on from localhost to sign in at 127.0.0.1
  const q = new URLSearchParams(location.search);
  if (q.get('spotify') === 'connect') { q.delete('spotify'); history.replaceState(null, '', location.pathname + (q.size ? '?' + q : '')); spotify.connect(); }
  spotify.finishSignIn().then(ok => {
    if (!ok) return;
    onNews('[music] They just signed in to Spotify, so you can play their music now. Ask what they fancy, in one short line.', true);
    spotify.startPlayer();
  }).catch(e => console.warn('[reverie] spotify', e));
  if (spotify.signedIn) spotify.startPlayer();   // (so "Reverie" is a speaker in their Spotify apps straight away)

  return {
    spotify, groove,
    tools: {
      music: async input => {
        const r = await spotify.command(input);
        if (r?.needsSignIn) { askConnect = true; show(); }
        if (input.action === 'play' && !r?.error) { askConnect = false; show(); }
        return r;
      },
      dance: async input => {
        if (input?.stop) { const was = !!want; stop(); return was ? 'You stopped dancing.' : 'You were not dancing.'; }
        const heard = await start('asked');
        return heard ? 'You are dancing, in time to the beat you hear (it takes a few seconds to find it). You keep dancing until they ask you to stop.'
          : "You are dancing, to a beat of your own: you can't hear the music (the microphone is off). You keep dancing until they ask you to stop.";
      },
    },
    /** Every frame: the beat into its body and the lights, and the music down while it talks or listens. */
    update(dt) {
      t += dt;
      spotify.update(dt);
      const st = creature.state;
      spotify.duck(st.speaking || st.listening);
      if (!want) return;
      // no beat heard (yet, or in a quiet bit, or the mic is off): a steady beat of its own, a gentler dance while it listens
      let b = groove.now();
      if (!b) { free ||= freeBeat(); b = { ...free.now(t), quiet: groove.on }; }
      creature.groove = b ? { beat: b.beat, phase: b.phase, amount: b.quiet ? .45 : 1 } : null;
      if (world.light) world.light.pulse = b ? Math.pow(1 - b.phase, 3) * (b.quiet ? .3 : 1) : 0;
    },
    /** The line Claude reads each turn. */
    line() {
      const n = spotify.line();
      const d = want ? ` You are dancing${groove.bpm && groove.sure > .15 ? ` (the beat is about ${Math.round(groove.bpm)} a minute)` : ''}.` : '';
      return n + d;
    },
    /** A tap on the page: Spotify's player may make sound after one (Safari, phones). */
    tapped: () => spotify.tapped(),
    /** Is what the mic heard them talking? While music plays, only with its name or a music command in it. */
    heardOk: text => !spotify.playing || NAME.test(text) || COMMAND.test(text),
  };
}
