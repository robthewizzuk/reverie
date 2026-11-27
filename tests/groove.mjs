// The beat tracker (src/groove.js) on made-up music: a kick and hi-hat pattern at known tempos, with noise, a swing,
// a tempo change and silence. Runs in Node, no browser: node tests/groove.mjs
import { BeatTracker } from '../src/groove.js';

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** Bands' log energy every 10 ms for a drum pattern: kick on each beat, hi-hats on the off-beats, noise under it. */
function song(tr, { bpm, from = 0, secs, offset = 0, noise = .3, hats = true, kickEvery = 1 }) {
  const hop = .01, spb = 60 / bpm;
  for (let t = from; t < from + secs; t += hop) {
    const b = (t - offset) / spb, ph = b - Math.floor(b), beat = Math.floor(b);
    const kick = beat % kickEvery === 0 ? Math.exp(-ph * spb / .05) : 0;
    const hph = (b + .5) - Math.floor(b + .5), hat = hats ? Math.exp(-hph * spb / .03) * .6 : 0;
    const lo = Math.log(1e-3 + kick * 2 + rnd() * noise * .2), hi = Math.log(1e-3 + hat + kick * .3 + rnd() * noise * .2);
    tr.push([lo, hi], t);
  }
  return from + secs;
}
const phaseErr = (tr, t, offset, bpm) => { const w = tr.where(t), spb = 60 / tr.bpm; let d = ((t - offset) / spb) % 1 - w.phase; d -= Math.round(d); return Math.abs(d); };

for (const bpm of [84, 100, 120, 128, 150, 172]) {
  const tr = new BeatTracker(); const offset = rnd() * .5;
  const end = song(tr, { bpm, secs: 10, offset });
  // (twice the tempo is fine for dancing: a slow song with hi-hats between its beats is danced in double time)
  const near = Math.abs(tr.bpm - bpm) < 1.5 || Math.abs(tr.bpm - 2 * bpm) < 3;
  check(near && tr.confidence > .3, `${bpm} bpm heard as ${tr.bpm.toFixed(1)} (sure ${tr.confidence.toFixed(2)})`);
  const pe = phaseErr(tr, end, offset, bpm);
  check(pe < .1, `${bpm} bpm: on the beat, ${(pe * 100).toFixed(0)}% of a beat out`);
}
{
  const tr = new BeatTracker();
  let t = song(tr, { bpm: 96, secs: 8 });
  t = song(tr, { bpm: 132, from: t, secs: 8, offset: t + .13 });
  check(Math.abs(tr.bpm - 132) < 1.5, `a new song at 132 after 96: heard ${tr.bpm.toFixed(1)}`);
}
{
  const tr = new BeatTracker();
  for (let t = 0; t < 8; t += .01) tr.push([Math.log(1e-3 + rnd() * .3), Math.log(1e-3 + rnd() * .3)], t);
  check(tr.confidence < .15, `noise alone isn't a beat (sure ${tr.confidence.toFixed(2)})`);
}
{
  const tr = new BeatTracker();
  for (let t = 0; t < 8; t += .01) tr.push([-9, -9], t);
  check(!tr.bpm, 'silence has no tempo');
}
{
  const tr = new BeatTracker();
  song(tr, { bpm: 124, secs: 10, noise: 1.2 });
  check(Math.abs(tr.bpm - 124) < 2, `noisy room, 124 bpm: heard ${tr.bpm.toFixed(1)}`);
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
