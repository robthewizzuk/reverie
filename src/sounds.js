// Plays Reverie's sound cues (cues.js) through the engine's mixer: the ready-made sounds of gs.sound, and a few of its
// own made the same way, in code (a drum roll with a crash, ba dum tss, applause, a slide whistle...). They play on the
// mixer's effects channel, so they ring in the room's echo with its voice (looks.js echo) and dip under nothing.
import gs from '../engine/src/gamescroll.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const S = () => gs.sound;

// each: plays it now and gives how long to wait before the next words (a crash or a clap's tail can ring under them)
const PLAY = {
  drumroll() {
    const { noise, tone } = S();
    for (let i = 0; i < 30; i++) noise(.035, { vol: .022 + i * .0016, from: 3800, to: 1400, filter: 'bandpass', q: .8, at: i * .045 });
    tone(62, { len: .35, wave: 'sine', vol: .14, slide: -22, at: 1.38 });
    noise(1.1, { vol: .09, from: 9000, to: 4200, filter: 'highpass', q: .5, at: 1.38 });
    return 1.55;
  },
  rimshot() {
    const { noise, tone } = S();
    tone(196, { len: .12, wave: 'sine', vol: .1, slide: -70 }); noise(.05, { vol: .05, from: 2400, to: 900, filter: 'bandpass', q: 1 });
    tone(150, { len: .14, wave: 'sine', vol: .1, slide: -55, at: .17 }); noise(.05, { vol: .05, from: 2000, to: 800, filter: 'bandpass', q: 1, at: .17 });
    tone(55, { len: .25, wave: 'sine', vol: .12, slide: -18, at: .36 }); noise(.7, { vol: .07, from: 10000, to: 5500, filter: 'highpass', q: .6, at: .36 });
    return .75;
  },
  tada: () => { S().sounds.tada(); return .55; },
  fanfare: () => { S().sounds.fanfare(); return 1; },
  applause() {
    const { noise } = S();
    // a crowd: claps at random, swelling and dying away
    for (let i = 0; i < 70; i++) { const at = rnd(0, 1.9), k = Math.sin(Math.PI * Math.min(1, at / 1.9)) * .7 + .3;
      noise(rnd(.015, .035), { vol: rnd(.025, .05) * k, from: rnd(900, 2600), to: rnd(600, 1400), filter: 'bandpass', q: rnd(.8, 1.6), at }); }
    return 1.4;
  },
  sad_trombone: () => { S().sounds.sad(); return 1.6; },
  boing: () => { S().sounds.boing(); return .3; },
  whoosh: () => { S().sounds.whoosh(); return .3; },
  pop: () => { S().sounds.pop(); return .15; },
  ding: () => { S().sounds.bell(); return .35; },
  buzzer: () => { S().sounds.buzzer(); return .45; },
  gong: () => { S().sounds.gong(); return .9; },
  magic: () => { S().sounds.twinkle(); S().tone(520, { len: .6, wave: 'sine', vol: .025, slide: 1400, wobble: [14, 40], attack: .1 }); return .55; },
  slide_up: () => { S().tone(420, { len: .55, wave: 'sine', vol: .05, slide: 1500, wobble: [9, 25], attack: .03 }); return .5; },
  slide_down: () => { S().tone(1900, { len: .7, wave: 'sine', vol: .05, slide: -1550, wobble: [9, 25], attack: .03 }); return .65; },
  honk: () => { S().sounds.honk(); setTimeout(() => S().sounds.honk(), 220); return .5; },
  crickets() { const { sounds } = S(); for (const at of [0, .22, .9, 1.12]) setTimeout(() => sounds.chirp(rnd(.95, 1.05)), at * 1000); return 1.5; },
  heartbeat() { const { sounds } = S(); for (const at of [0, .8, 1.6]) setTimeout(() => sounds.heart(), at * 1000); return 1.8; },
  spooky: () => { S().tone(560, { len: 1.6, wave: 'sine', vol: .045, slide: -260, wobble: [5.5, 70], attack: .35, hold: .7 }); return 1.2; },
  thunder: () => { S().sounds.thunder(); return .9; },
  splat: () => { S().sounds.squish(.8); S().sounds.plop?.(); return .25; },
  gulp: () => { S().sounds.gulp(); return .3; },
  level_up: () => { S().sounds.levelup(); return .6; },
  cash: () => { S().sounds.cash(); return .5; },
  zap: () => { S().sounds.zap(); return .3; },
};

/** The last few cues played, newest last (for the tests). */
export const played = [];
/** Plays a cue (a name from cues.js) and returns the seconds to wait before going on (0 for one it doesn't know). */
export function playCue(name) {
  const f = PLAY[name]; if (!f) return 0;
  played.push(name); if (played.length > 8) played.shift();
  try { return f(); } catch (e) { console.warn('[reverie] sound', name, e); return 0; }
}
export const cueNames = () => Object.keys(PLAY);
