// Kaldi-compatible streaming 80-bin log-mel filterbank + Reverie transcript & hotword helpers.
// Matches sherpa-onnx / kaldi-native-fbank defaults for Zipformer 20M:
//   sampleRate = 16000 Hz, frameLength = 400 (25 ms), frameShift = 160 (10 ms),
//   nFFT = 512, numMelBins = 80, lowFreq = 20 Hz, highFreq = 7600 Hz,
//   preemph = 0.97, Povey window, removeDcOffset = true, natural log energy floor 1e-10.

const SR = 16000;
const FRAME_LEN = 400;
const FRAME_SHIFT = 160;
const N_FFT = 512;
const HALF_FFT = N_FFT >> 1; // 256
const NUM_BINS = 80;
const PREEMPH = 0.97;
const ENERGY_FLOOR = 1e-10;

// Precomputed bit-reversal & twiddle tables for 512-point radix-2 FFT
const BIT_REV = new Uint16Array(N_FFT);
for (let i = 0; i < N_FFT; i++) {
  let x = i, r = 0;
  for (let b = 0; b < 9; b++) { r = (r << 1) | (x & 1); x >>= 1; }
  BIT_REV[i] = r;
}
const COS_TAB = new Float32Array(HALF_FFT);
const SIN_TAB = new Float32Array(HALF_FFT);
for (let i = 0; i < HALF_FFT; i++) {
  const a = -2 * Math.PI * i / N_FFT;
  COS_TAB[i] = Math.cos(a);
  SIN_TAB[i] = Math.sin(a);
}

// Povey window: (0.5 - 0.5 * cos(2*pi*n/(N-1)))^0.85
const POVEY = new Float32Array(FRAME_LEN);
for (let i = 0; i < FRAME_LEN; i++) {
  const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_LEN - 1));
  POVEY[i] = Math.pow(Math.max(0, h), 0.85);
}

// Kaldi mel scale: 1127 * ln(1 + f / 700)
const hzToMel = f => 1127 * Math.log(1 + f / 700);

// Sparse triangular Mel filterbank (80 bins over 257 FFT power bins)
const MEL_FILTERS = (() => {
  const lowMel = hzToMel(20);
  const highMel = hzToMel(7600);
  const melStep = (highMel - lowMel) / (NUM_BINS + 1);
  const fftBinWidth = SR / N_FFT;
  const filters = [];
  for (let b = 0; b < NUM_BINS; b++) {
    const left = lowMel + b * melStep;
    const center = left + melStep;
    const right = center + melStep;
    let first = -1, last = -1;
    const weights = [];
    for (let k = 0; k <= HALF_FFT; k++) {
      const m = hzToMel(k * fftBinWidth);
      let w = 0;
      if (m > left && m < right) {
        w = m <= center ? (m - left) / (center - left) : (right - m) / (right - center);
      }
      if (w > 0) {
        if (first < 0) first = k;
        last = k;
        weights.push(w);
      } else if (first >= 0) {
        break;
      }
    }
    filters.push({ first: Math.max(0, first), weights: new Float32Array(weights) });
  }
  return filters;
})();

/** In-place 512-point radix-2 FFT on (re, im) Float32Arrays. */
export function fft512(re, im) {
  for (let i = 0; i < N_FFT; i++) {
    const j = BIT_REV[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= N_FFT; size <<= 1) {
    const half = size >> 1;
    const step = N_FFT / size;
    for (let i = 0; i < N_FFT; i += size) {
      for (let j = 0, tw = 0; j < half; j++, tw += step) {
        const wr = COS_TAB[tw], wi = SIN_TAB[tw];
        const k = i + j, l = k + half;
        const tr = wr * re[l] - wi * im[l];
        const ti = wr * im[l] + wi * re[l];
        re[l] = re[k] - tr;
        im[l] = im[k] - ti;
        re[k] += tr;
        im[k] += ti;
      }
    }
  }
}

/**
 * Streaming Kaldi 80-bin log-mel filterbank extractor.
 * Feed arbitrary-length 16 kHz Float32 PCM chunks; read out complete 80-dim feature frames.
 */
export class OnlineFbank {
  constructor() {
    this.buf = new Float32Array(0);
    this.frames = [];
    this._re = new Float32Array(N_FFT);
    this._im = new Float32Array(N_FFT);
    this._pow = new Float32Array(HALF_FFT + 1);
  }

  /** Append 16 kHz mono Float32 samples and extract all complete 25ms/10ms frames. */
  acceptWaveform(samples) {
    if (!samples?.length) return 0;
    const prev = this.buf;
    const merged = new Float32Array(prev.length + samples.length);
    merged.set(prev, 0);
    merged.set(samples, prev.length);

    let offset = 0, added = 0;
    while (offset + FRAME_LEN <= merged.length) {
      this.frames.push(this._computeFrame(merged, offset));
      offset += FRAME_SHIFT;
      added++;
    }
    this.buf = offset > 0 ? merged.subarray(offset) : merged;
    return added;
  }

  /** Append zero-padded silence frames (e.g. tail padding at end of utterance). */
  acceptSilence(numSamples) {
    return this.acceptWaveform(new Float32Array(numSamples));
  }

  /** Number of buffered 80-dim feature frames ready for the encoder. */
  get numFrames() { return this.frames.length; }

  /**
   * Read `count` frames starting at index 0 into a flat Float32Array(count * 80)
   * and advance the queue by `advance` frames (keeping lookahead overlap).
   */
  popChunk(count, advance) {
    if (this.frames.length < count) return null;
    const out = new Float32Array(count * NUM_BINS);
    for (let i = 0; i < count; i++) out.set(this.frames[i], i * NUM_BINS);
    this.frames.splice(0, advance);
    return out;
  }

  reset() {
    this.buf = new Float32Array(0);
    this.frames.length = 0;
  }

  _computeFrame(src, offset) {
    const re = this._re, im = this._im, pow = this._pow;
    // 1. Mean (DC offset removal)
    let mean = 0;
    for (let i = 0; i < FRAME_LEN; i++) mean += src[offset + i];
    mean /= FRAME_LEN;

    // 2. Pre-emphasis + Povey window + zero-pad to 512
    let prev = src[offset] - mean;
    re[0] = (prev - PREEMPH * prev) * POVEY[0];
    im[0] = 0;
    for (let i = 1; i < FRAME_LEN; i++) {
      const cur = src[offset + i] - mean;
      re[i] = (cur - PREEMPH * prev) * POVEY[i];
      im[i] = 0;
      prev = cur;
    }
    for (let i = FRAME_LEN; i < N_FFT; i++) { re[i] = 0; im[i] = 0; }

    // 3. 512-point FFT -> power spectrum (257 bins)
    fft512(re, im);
    for (let k = 0; k <= HALF_FFT; k++) pow[k] = re[k] * re[k] + im[k] * im[k];

    // 4. 80 Mel filterbank energies -> natural log
    const feat = new Float32Array(NUM_BINS);
    for (let b = 0; b < NUM_BINS; b++) {
      const { first, weights } = MEL_FILTERS[b];
      let e = 0;
      for (let j = 0; j < weights.length; j++) e += pow[first + j] * weights[j];
      feat[b] = Math.log(e > ENERGY_FLOOR ? e : ENERGY_FLOOR);
    }
    return feat;
  }
}

/**
 * Parses sherpa-onnx `tokens.txt` ("<blk> 0\n..." or "▁THE 12\n...") into a token array.
 */
export function parseTokens(text) {
  const tokens = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^(\S+)\s+(\d+)\s*$/.exec(line.trim());
    if (m) tokens[Number(m[2])] = m[1];
  }
  return tokens;
}

/**
 * Decodes SentencePiece BPE token IDs into clean readable text.
 */
export function decodeBpe(tokenIds, tokens) {
  let raw = '';
  for (const id of tokenIds) {
    const piece = tokens[id];
    if (!piece || id === 0 || piece === '<blk>' || piece === '<sos/eos>' || piece === '<unk>') continue;
    raw += piece;
  }
  return raw.replace(/\u2581/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Builds a lightweight BPE token boost map for Reverie's domain hotwords
 * (e.g. "reverie", "lego", "aquarium", pet name, room items) for greedy transducer decoding.
 */
export function buildHotwordBoosts(words, tokens, boost = 1.15) {
  const map = new Map();
  if (!Array.isArray(words) || !words.length || !tokens?.length) return map;
  const upper = words
    .map(w => String(w || '').trim().toUpperCase().replace(/[^A-Z']/g, ''))
    .filter(w => w.length >= 3);
  if (!upper.length) return map;

  for (let id = 1; id < tokens.length; id++) {
    const raw = tokens[id];
    if (!raw) continue;
    const clean = raw.replace(/^\u2581/, '').toUpperCase();
    if (clean.length < 3) continue;
    for (const w of upper) {
      if (w === clean || (raw.startsWith('\u2581') && w.startsWith(clean) && clean.length >= 3)) {
        map.set(id, boost);
        break;
      }
    }
  }
  return map;
}

// Common 20M acoustic confusions tuned for Reverie's workshop vocabulary
const CLEANUPS = [
  [/\b(hey|hi|hello|yo|ok|okay)\s+(referee|revery|reverend|every|brewery)\b/gi, '$1 reverie'],
  [/^(referee|revery)\b/i, 'reverie'],
  [/\bleg\s+go\b/gi, 'lego'],
  [/\ba\s+quarium\b/gi, 'aquarium'],
  [/\bwork\s+bench\b/gi, 'workbench'],
  [/\bwindow\s+sill\b/gi, 'windowsill'],
  [/\bnaughts?\s+and\s+crosses\b/gi, 'noughts and crosses'],
];

/** Cleans up Zipformer 20M output for Reverie's conversational pipeline. */
export function cleanTranscript(text) {
  let s = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return '';
  for (const [re, rep] of CLEANUPS) s = s.replace(re, rep);
  return s.replace(/\s+/g, ' ').trim();
}

export const FBANK_CONFIG = { SR, FRAME_LEN, FRAME_SHIFT, N_FFT, NUM_BINS };
