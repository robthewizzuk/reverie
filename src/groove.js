// Hearing the beat: Reverie dances in time to music it hears through the microphone, any music in the room (Spotify
// on this page, a phone, a radio). Spotify no longer tells new apps a song's tempo or where its beats fall, and the
// music it plays in the page can't be read by the page (it is protected), so the beat is found here, on the device,
// from the sound itself. Nothing heard leaves the device.
//
// How: a little audio worklet splits what the mic hears into a low band (kick drums, bass) and the rest, and every
// 10 ms gives how loud each band is. A sudden rise in loudness is an onset (a drum hit, a strum). The onsets of the
// last eight seconds are compared with themselves shifted by every beat length from 70 to 180 a minute, and the
// length that lines up best is the tempo (with a gentle preference for 90 to 140, where most songs dance). Then the
// beat's position is the shift of a comb of that spacing that catches the most onsets. A clock keeps the beat between
// estimates and is nudged towards each new one, so Reverie never jumps about, and keeps dancing through a quiet bar.
//
// BeatTracker is the sums alone (no audio), so it can be tested anywhere; makeGroove wires it to the microphone.

const HOP = .01;                 // seconds between onset values
const KEEP = 8;                  // seconds of onsets looked at
const MIN_BPM = 70, MAX_BPM = 180;
const EVERY = .5;                // seconds between estimates

export class BeatTracker {
  constructor({ hop = HOP, keep = KEEP } = {}) {
    this.hop = hop; this.n = Math.round(keep / hop);
    this.onsets = new Float32Array(this.n); this.at = 0; this.count = 0; this.t = 0;
    this.prev = null; this.lastEst = -Infinity;
    /** The tempo heard, in beats a minute (0 until it has one). */
    this.bpm = 0;
    /** How sure it is that there is a steady beat, 0..1. */
    this.confidence = 0;
    // the beat clock: when a beat falls (seconds, in the same time as push), and the beat length
    this.beatAt = 0; this.period = 0;
  }

  /** One hop's loudness per band (log energies, any scale), at time t in seconds. Returns this. */
  push(bands, t) {
    let o = 0;
    if (this.prev) for (let i = 0; i < bands.length; i++) o += Math.max(0, bands[i] - this.prev[i]) * (i === 0 ? 1.5 : 1);
    this.prev = Float32Array.from(bands);
    this.onsets[this.at] = o; this.at = (this.at + 1) % this.n; this.count++; this.t = t;
    if (t - this.lastEst >= EVERY && this.count > 3 / this.hop) { this.lastEst = t; this.estimate(); }
    return this;
  }

  /** The onsets in time order, oldest first, with their slow average taken off (only the peaks are left). */
  envelope() {
    const n = Math.min(this.count, this.n), out = new Float32Array(n), w = Math.round(.1 / this.hop);
    for (let i = 0; i < n; i++) out[i] = this.onsets[(this.at - n + i + this.n) % this.n];
    const avg = new Float32Array(n); let sum = 0;
    for (let i = 0; i < n; i++) { sum += out[i]; if (i >= 2 * w + 1) sum -= out[i - 2 * w - 1]; avg[Math.max(0, i - w)] = sum / Math.min(i + 1, 2 * w + 1); }
    for (let i = 0; i < n; i++) out[i] = Math.max(0, out[i] - avg[i]);
    return out;
  }

  estimate() {
    const e = this.envelope(), n = e.length, hop = this.hop;
    let energy = 0; for (const x of e) energy += x * x;
    if (energy < 1e-6) { this.confidence *= .7; return; }
    // how well the onsets line up with themselves a beat later, for every beat length
    const lo = Math.round(60 / MAX_BPM / hop), hi = Math.round(60 / MIN_BPM / hop), score = new Float32Array(hi + 2);
    for (let lag = lo - 1; lag <= hi + 1; lag++) { let s = 0; for (let i = lag; i < n; i++) s += e[i] * e[i - lag]; score[lag] = s / (n - lag); }
    let best = 0, bestLag = 0, mean = 0;
    for (let lag = lo; lag <= hi; lag++) {
      const bpm = 60 / (lag * hop), prior = Math.exp(-.5 * Math.pow(Math.log2(bpm / 118) / .9, 2));
      // a beat that also lines up at twice its length is a real beat, not an off-beat
      const s = (score[lag] + .5 * (score[Math.min(hi + 1, lag * 2)] || 0)) * prior;
      mean += score[lag];
      if (s > best) { best = s; bestLag = lag; }
    }
    mean /= hi - lo + 1;
    if (!bestLag) return;
    // between lags: a parabola through the best and its neighbours
    const a = score[bestLag - 1], b = score[bestLag], c = score[bestLag + 1], d = a - 2 * b + c;
    const lag = bestLag + (d < 0 ? Math.max(-.5, Math.min(.5, .5 * (a - c) / d)) : 0), period = lag * hop;
    const sure = Math.max(0, Math.min(1, (b / Math.max(1e-9, mean) - 1.15) / 1.6));
    // where the beats fall: the shift of a comb with that spacing that catches the most onsets (recent ones count more)
    const steps = Math.max(1, Math.round(lag)); let bestPh = 0, bestS = -1;
    for (let ph = 0; ph < steps; ph++) {
      let s = 0;
      for (let k = 0; ; k++) {
        const i = Math.round(n - 1 - ph - k * lag); if (i < 1) break;
        s += (e[i] + .5 * (e[i - 1] + (e[i + 1] || 0))) * Math.pow(.9, k);
      }
      if (s > bestS) { bestS = s; bestPh = ph; }
    }
    const heardBeat = this.t - bestPh * hop;
    this.confidence += (sure - this.confidence) * .5;
    if (this.confidence < .15) return;
    // the clock: a new tempo is taken at once when far off (a new song), else eased towards; the beat likewise
    if (!this.period || Math.abs(period - this.period) / this.period > .08) { this.period = period; this.beatAt = heardBeat; }
    else {
      this.period += (period - this.period) * .3;
      let off = (heardBeat - this.beatAt) / this.period; off -= Math.round(off);
      this.beatAt += off * this.period * .35;
    }
    this.bpm = 60 / this.period;
  }

  /** Where the beat is at time t: { beat (whole beats), phase (0..1) }, or null with no tempo yet. */
  where(t) {
    if (!this.period) return null;
    const b = (t - this.beatAt) / this.period;
    return { beat: Math.floor(b), phase: b - Math.floor(b) };
  }
}

// The worklet: two bands' log energy every hop. (Made from text, so there is no extra file to serve.)
const WORKLET = `
class Bands extends AudioWorkletProcessor {
  constructor() { super(); this.lp = 0; this.lp2 = 0; this.n = 0; this.lo = 0; this.hi = 0; this.size = Math.round(sampleRate * ${HOP}); this.k = 1 - Math.exp(-2 * Math.PI * 160 / sampleRate); }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]; if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i]; this.lp += (x - this.lp) * this.k; this.lp2 += (this.lp - this.lp2) * this.k;
      const h = x - this.lp; this.lo += this.lp2 * this.lp2; this.hi += h * h;
      if (++this.n >= this.size) {
        this.port.postMessage([Math.log(1e-9 + this.lo / this.n), Math.log(1e-9 + this.hi / this.n), currentTime + i / sampleRate]);
        this.n = 0; this.lo = 0; this.hi = 0;
      }
    }
    return true;
  }
}
registerProcessor('reverie-bands', Bands);`;

/**
 * Listens for a beat through the microphone (asked for raw, with no echo cancelling, which would take out music this
 * page plays). start() from a tap or once the mic is allowed; stop(). now() gives { beat, phase, bpm, sure } or null.
 * ahead: seconds to dance ahead of what was heard (the mic hears a little late).
 */
export function makeGroove({ ahead = .06 } = {}) {
  let ctx = null, stream = null, node = null, src = null, tracker = new BeatTracker(), heard = false, raw = null, lastBeat = null;
  const beatFns = [];
  const g = {
    get on() { return !!ctx; },
    get bpm() { return tracker.bpm; },
    get sure() { return tracker.confidence; },
    /** True once the mic was opened without echo cancelling (false: it may not hear music this page plays). */
    get raw() { return raw; },
    get tracker() { return tracker; },
    async start() {
      if (ctx) return true;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        raw = stream.getAudioTracks()[0]?.getSettings?.().echoCancellation === false;
        ctx = new AudioContext({ latencyHint: 'interactive' });
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
        await ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
        src = ctx.createMediaStreamSource(stream); node = new AudioWorkletNode(ctx, 'reverie-bands');
        node.port.onmessage = e => { const [lo, hi, t] = e.data; tracker.push([lo, hi], t); heard = true; };
        src.connect(node);   // (not on to the speakers: it only listens)
        if (ctx.state !== 'running') await ctx.resume().catch(() => {});
        console.info(`[reverie] groove: listening for a beat${raw ? '' : ' (echo cancelling may be on)'}`);
        return true;
      } catch (e) {
        console.warn('[reverie] groove: no microphone', e);
        g.stop(); return false;
      }
    },
    stop() {
      try { src?.disconnect(); node?.disconnect(); } catch { /* gone */ }
      stream?.getTracks().forEach(t => t.stop());
      ctx?.close().catch(() => {});
      ctx = stream = node = src = null; heard = false; tracker = new BeatTracker();
    },
    /** The beat now (danced a little ahead of what was heard), or null with none heard yet. Calls the onBeat fns on a new beat. */
    now() {
      if (!ctx || !heard || tracker.confidence < .15) return null;
      const b = tracker.where(ctx.currentTime + ahead);
      if (b && b.beat !== lastBeat) { lastBeat = b.beat; for (const f of beatFns) try { f({ beat: b.beat, bpm: tracker.bpm, sure: tracker.confidence }); } catch (e) { console.warn('[reverie] onBeat', e); } }
      return b && { ...b, bpm: tracker.bpm, sure: tracker.confidence };
    },
    /** fn({ beat, bpm, sure }) on each beat heard (checked each frame, while it dances). */
    onBeat(fn) { beatFns.push(fn); },
  };
  return g;
}

/**
 * A beat with no microphone: a steady tempo of its own, for dancing when it can't hear (refused, or no mic).
 * now(t) in seconds gives { beat, phase, bpm }.
 */
export const freeBeat = (bpm = 116) => ({ bpm, now: t => { const b = t * bpm / 60; return { beat: Math.floor(b), phase: b - Math.floor(b), bpm, sure: 0 }; } });
