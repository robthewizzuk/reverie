// Dedicated Web Worker for on-device Silero VAD v5 + Streaming Zipformer 20M (int8 encoder).
// Runs purely on CPU WASM (SIMD, single-threaded so no COOP/COEP SharedArrayBuffer headers are needed)
// to avoid competing with Reverie's WebGPU 3D room renderer. Models are cached once in Cache Storage.
import * as ort from '../engine/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs';
import { OnlineFbank, parseTokens, decodeBpe, buildHotwordBoosts, cleanTranscript } from './fbank.js';

const CACHE_NAME = 'reverie-stt-v1';
const ORT_WASM_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
const VAD_URL = 'https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx';
const ZIP_BASE = 'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17/resolve/main/';
const MODEL_URLS = {
  vad: VAD_URL,
  encoder: ZIP_BASE + 'encoder-epoch-99-avg-1.int8.onnx',
  decoder: ZIP_BASE + 'decoder-epoch-99-avg-1.onnx',
  joiner: ZIP_BASE + 'joiner-epoch-99-avg-1.onnx',
  tokens: ZIP_BASE + 'tokens.txt',
};

// Tuned for Reverie's live voice-companion turn-taking (16 kHz, 512 samples = 32 ms per VAD frame)
const VAD_FRAME = 512;
const VAD_CTX = 64;
const START_PROB = 0.48;      // speech onset threshold
const CONT_PROB = 0.30;       // speech continuation hysteresis (keeps soft trailing syllables)
const ONSET_FRAMES = 2;       // 64 ms consecutive speech to reject clicks/pops
const PREROLL_FRAMES = 8;     // 256 ms ring buffer so first syllable is never clipped
const HANGOVER_FRAMES = 15;   // 480 ms trailing silence before finalizing utterance
const MAX_UTT_FRAMES = 500;   // ~16 s safety cap per utterance

const DEFAULT_HOTWORDS = [
  'reverie', 'lego', 'aquarium', 'workbench', 'windowsill', 'chess', 'noughts',
  'karaoke', 'spotify', 'doodle', 'battleships', 'capsule', 'diary', 'garden',
];

let vadSess = null, encSess = null, decSess = null, joinSess = null;
let tokens = [], hotBoosts = new Map();
let vadIsV5 = true, vadExpectsCtx = false;
let vadState = null, vadH = null, vadC = null;
const vadCtxBuf = new Float32Array(VAD_CTX);
const srTensor = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);

let encT = 39, encShift = 32, decContext = 2;
let encCacheMeta = [], encCaches = {};
let decY = [0, 0], decOut = null, hyp = [], lastPartial = '';

const fbank = new OnlineFbank();
const preroll = [];
let inSpeech = false, onsetCount = 0, silenceCount = 0, uttFrames = 0;
let ready = false, busy = false;
const pendingAudio = [];

async function fetchCached(url, asText = false) {
  let store = null;
  try { store = await caches.open(CACHE_NAME); } catch { /* private mode */ }
  const hit = store && await store.match(url).catch(() => null);
  if (hit) return asText ? hit.text() : hit.arrayBuffer();
  const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const buf = await r.arrayBuffer();
  if (store) {
    await store.put(url, new Response(buf.slice(0), {
      headers: { 'Content-Type': asText ? 'text/plain; charset=utf-8' : 'application/octet-stream' },
    })).catch(() => {});
  }
  return asText ? new TextDecoder().decode(buf) : buf;
}

function makeZeroTensor(meta) {
  const shape = (meta.shape || []).map(d => (typeof d === 'number' && d > 0) ? d : 1);
  const len = shape.reduce((a, b) => a * b, 1);
  if (meta.type === 'int64') return new ort.Tensor('int64', new BigInt64Array(len), shape);
  return new ort.Tensor('float32', new Float32Array(len), shape);
}

function resetVadState() {
  vadCtxBuf.fill(0);
  if (vadIsV5) {
    vadState = new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
  } else {
    vadH = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
    vadC = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
  }
}

async function resetZipformer() {
  fbank.reset();
  encCaches = {};
  for (const m of encCacheMeta) encCaches[m.name] = makeZeroTensor(m);
  decY = new Array(decContext).fill(0);
  hyp = [];
  lastPartial = '';
  if (decSess) {
    const yT = new ort.Tensor('int64', BigInt64Array.from(decY.map(BigInt)), [1, decContext]);
    const out = await decSess.run({ [decSess.inputNames[0]]: yT });
    decOut = out[decSess.outputNames[0]];
  }
}

async function init(hotwords = DEFAULT_HOTWORDS) {
  ort.env.wasm.wasmPaths = ORT_WASM_CDN;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;

  postMessage({ type: 'status', msg: 'loading Silero VAD + Zipformer 20M…' });
  const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };

  const [vadBuf, encBuf, decBuf, joinBuf, tokTxt] = await Promise.all([
    fetchCached(MODEL_URLS.vad),
    fetchCached(MODEL_URLS.encoder),
    fetchCached(MODEL_URLS.decoder),
    fetchCached(MODEL_URLS.joiner),
    fetchCached(MODEL_URLS.tokens, true),
  ]);

  tokens = parseTokens(tokTxt);
  hotBoosts = buildHotwordBoosts([...DEFAULT_HOTWORDS, ...hotwords], tokens, 1.15);

  [vadSess, encSess, decSess, joinSess] = await Promise.all([
    ort.InferenceSession.create(vadBuf, opts),
    ort.InferenceSession.create(encBuf, opts),
    ort.InferenceSession.create(decBuf, opts),
    ort.InferenceSession.create(joinBuf, opts),
  ]);

  // Auto-detect Silero VAD v5 vs v4 tensor layout
  vadIsV5 = vadSess.inputNames.includes('state');
  const inMeta = vadSess.inputMetadata?.find(m => m.name === 'input');
  vadExpectsCtx = vadIsV5 && inMeta?.shape?.[1] === VAD_FRAME + VAD_CTX;
  resetVadState();

  // Auto-detect Zipformer-1 encoder input chunk size & cache tensors from ONNX metadata
  const xMeta = encSess.inputMetadata?.find(m => m.name === 'x');
  if (typeof xMeta?.shape?.[1] === 'number' && xMeta.shape[1] > 10) {
    encT = xMeta.shape[1];
    encShift = Math.max(8, encT - 7);
  }
  encCacheMeta = (encSess.inputMetadata || []).filter(m => m.name !== 'x');
  const yMeta = decSess.inputMetadata?.[0];
  if (typeof yMeta?.shape?.[1] === 'number' && yMeta.shape[1] > 0) decContext = yMeta.shape[1];

  await resetZipformer();
  ready = true;
  postMessage({ type: 'ready', encT, encShift, vocab: tokens.length, vadV5: vadIsV5 });
}

async function runVad(frame512) {
  let feeds;
  if (vadIsV5) {
    let inputData;
    if (vadExpectsCtx) {
      inputData = new Float32Array(VAD_CTX + VAD_FRAME);
      inputData.set(vadCtxBuf, 0);
      inputData.set(frame512, VAD_CTX);
      vadCtxBuf.set(frame512.subarray(VAD_FRAME - VAD_CTX));
    } else {
      inputData = frame512;
    }
    feeds = {
      input: new ort.Tensor('float32', inputData, [1, inputData.length]),
      state: vadState,
      sr: srTensor,
    };
    const out = await vadSess.run(feeds);
    vadState = out.stateN || out[vadSess.outputNames[1]];
    return out.output?.data?.[0] ?? out[vadSess.outputNames[0]].data[0];
  } else {
    feeds = {
      input: new ort.Tensor('float32', frame512, [1, VAD_FRAME]),
      h: vadH,
      c: vadC,
      sr: srTensor,
    };
    const out = await vadSess.run(feeds);
    vadH = out.hn; vadC = out.cn;
    return out.output.data[0];
  }
}

async function runEncoderChunk() {
  const feat = fbank.popChunk(encT, encShift);
  if (!feat) return false;
  const feeds = { x: new ort.Tensor('float32', feat, [1, encT, 80]), ...encCaches };
  const out = await encSess.run(feeds);

  const encOut = out.encoder_out || out[encSess.outputNames[0]];
  // Update streaming encoder caches for next chunk
  for (const m of encCacheMeta) {
    const newName = 'new_' + m.name;
    if (out[newName]) encCaches[m.name] = out[newName];
  }

  // Greedy transducer decode with lightweight Reverie hotword logit boost
  const [, framesOut, dim] = encOut.dims;
  const encData = encOut.data;
  const encInName = joinSess.inputNames[0], decInName = joinSess.inputNames[1];
  const decIn0 = decSess.inputNames[0];
  let changed = false;

  for (let t = 0; t < framesOut; t++) {
    const slice = encData.subarray(t * dim, (t + 1) * dim);
    const jOut = await joinSess.run({
      [encInName]: new ort.Tensor('float32', slice, [1, dim]),
      [decInName]: decOut,
    });
    const logits = jOut[joinSess.outputNames[0]].data;
    let bestId = 0, bestVal = logits[0];
    for (let i = 1; i < logits.length; i++) {
      let v = logits[i];
      if (hotBoosts.size) { const b = hotBoosts.get(i); if (b) v += b; }
      if (v > bestVal) { bestVal = v; bestId = i; }
    }
    if (bestId !== 0) {
      hyp.push(bestId);
      for (let k = 0; k < decContext - 1; k++) decY[k] = decY[k + 1];
      decY[decContext - 1] = bestId;
      const dOut = await decSess.run({
        [decIn0]: new ort.Tensor('int64', BigInt64Array.from(decY.map(BigInt)), [1, decContext]),
      });
      decOut = dOut[decSess.outputNames[0]];
      changed = true;
    }
  }

  if (changed) {
    const text = cleanTranscript(decodeBpe(hyp, tokens));
    if (text && text !== lastPartial) {
      lastPartial = text;
      postMessage({ type: 'partial', text });
    }
  }
  return true;
}

async function flushUtterance() {
  // Feed tail silence so the last syllable clears Zipformer's right-context window
  fbank.acceptSilence(160 * (encT + 4));
  while (fbank.numFrames >= encT) await runEncoderChunk();
  const text = cleanTranscript(decodeBpe(hyp, tokens));
  if (text) postMessage({ type: 'final', text });
  await resetZipformer();
  inSpeech = false;
  onsetCount = 0;
  silenceCount = 0;
  uttFrames = 0;
}

async function processFrame(frame512) {
  let sum = 0;
  for (let i = 0; i < frame512.length; i++) sum += frame512[i] * frame512[i];
  const rms = Math.sqrt(sum / frame512.length);

  const prob = await runVad(frame512);
  const voiceNow = inSpeech ? prob >= CONT_PROB : prob >= START_PROB;
  postMessage({ type: 'vad', prob, speaking: voiceNow, rms });

  if (!inSpeech) {
    preroll.push(frame512);
    if (preroll.length > PREROLL_FRAMES) preroll.shift();
    if (prob >= START_PROB) {
      if (++onsetCount >= ONSET_FRAMES) {
        inSpeech = true;
        silenceCount = 0;
        uttFrames = preroll.length;
        for (const pre of preroll) fbank.acceptWaveform(pre);
        preroll.length = 0;
        while (fbank.numFrames >= encT) await runEncoderChunk();
      }
    } else {
      onsetCount = 0;
    }
    return;
  }

  // Active speech: stream into fbank & Zipformer
  uttFrames++;
  fbank.acceptWaveform(frame512);
  while (fbank.numFrames >= encT) await runEncoderChunk();

  if (prob >= CONT_PROB) {
    silenceCount = 0;
  } else {
    silenceCount++;
  }

  if (silenceCount >= HANGOVER_FRAMES || uttFrames >= MAX_UTT_FRAMES) {
    await flushUtterance();
  }
}

async function drain() {
  if (busy || !ready) return;
  busy = true;
  try {
    while (pendingAudio.length) {
      const chunk = pendingAudio.shift();
      await processFrame(chunk);
    }
  } catch (e) {
    postMessage({ type: 'error', msg: String(e?.message || e) });
  } finally {
    busy = false;
  }
}

self.onmessage = async e => {
  const m = e.data;
  if (!m) return;
  if (m.type === 'init') {
    try { await init(m.hotwords || []); }
    catch (err) { postMessage({ type: 'failed', msg: String(err?.message || err) }); }
  } else if (m.type === 'audio') {
    if (!ready) return;
    // Cap backlog to ~2s if CPU ever stalls so latency never drifts
    if (pendingAudio.length > 64) pendingAudio.splice(0, pendingAudio.length - 16);
    pendingAudio.push(m.pcm);
    drain();
  } else if (m.type === 'hotwords') {
    hotBoosts = buildHotwordBoosts([...DEFAULT_HOTWORDS, ...(m.words || [])], tokens, 1.15);
  } else if (m.type === 'reset') {
    pendingAudio.length = 0;
    preroll.length = 0;
    inSpeech = false; onsetCount = 0; silenceCount = 0; uttFrames = 0;
    if (ready) { resetVadState(); await resetZipformer(); }
  }
};
