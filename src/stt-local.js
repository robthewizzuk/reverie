// Main-thread bridge for on-device Silero VAD v5 + Streaming Zipformer 20M (src/stt-worker.js).
// Uses an inline AudioWorklet to downsample the echo-cancelled mic stream to 16 kHz mono 512-sample (32 ms)
// Float32 frames with zero main-thread audio jank, transferring each frame directly to the STT Web Worker.

const WORKLET_CODE = `
class Pcm16kProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0;
    this.out = new Float32Array(512);
    this.n = 0;
    this.prev = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || !ch.length) return true;
    const r = this.ratio, len = ch.length;
    while (this.pos < len) {
      const idx = Math.floor(this.pos);
      const frac = this.pos - idx;
      const s0 = idx === 0 ? this.prev : ch[idx - 1];
      const s1 = ch[idx];
      this.out[this.n++] = s0 + (s1 - s0) * frac;
      if (this.n === 512) {
        const chunk = this.out;
        this.port.postMessage(chunk, [chunk.buffer]);
        this.out = new Float32Array(512);
        this.n = 0;
      }
      this.pos += r;
    }
    this.pos -= len;
    this.prev = ch[len - 1];
    return true;
  }
}
registerProcessor('reverie-pcm16k', Pcm16kProcessor);
`;

export class LocalStt {
  constructor({ onReady = null, onPartial = null, onFinal = null, onVad = null, onFailed = null, onNote = null } = {}) {
    this.onReady = onReady;
    this.onPartial = onPartial;
    this.onFinal = onFinal;
    this.onVad = onVad;
    this.onFailed = onFailed;
    this.onNote = onNote;
    this.ready = false;
    this.failed = false;
    this.active = false;
    this.vadProb = 0;
    this.speaking = false;
    this.rms = 0;
    this._worker = null;
    this._ctx = null;
    this._node = null;
    this._src = null;
    this._sink = null;
    this._hotwords = [];
  }

  /** Preload Silero VAD + Zipformer 20M in the background worker without starting audio capture yet. */
  warmup(hotwords = []) {
    if (this._worker || this.failed || typeof Worker === 'undefined') return;
    if (hotwords.length) this._hotwords = hotwords.slice();
    try {
      const w = new Worker(new URL('./stt-worker.js', import.meta.url), { type: 'module' });
      this._worker = w;
      w.onmessage = e => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'ready') {
          this.ready = true;
          this.onNote?.(`local Silero VAD + Zipformer 20M ready (T=${m.encT}, vocab=${m.vocab})`);
          this.onReady?.(m);
        } else if (m.type === 'vad') {
          this.vadProb = m.prob;
          this.speaking = m.speaking;
          this.rms = m.rms;
          this.onVad?.(m);
        } else if (m.type === 'partial') {
          this.onPartial?.(m.text);
        } else if (m.type === 'final') {
          this.onFinal?.(m.text);
        } else if (m.type === 'status') {
          this.onNote?.(m.msg);
        } else if (m.type === 'failed') {
          this.failed = true;
          this.ready = false;
          this.onNote?.(`local STT unavailable: ${m.msg}`);
          this.stop();
          this.onFailed?.(m.msg);
        } else if (m.type === 'error') {
          this.onNote?.(`local STT frame error: ${m.msg}`);
        }
      };
      w.onerror = err => {
        this.failed = true;
        this.ready = false;
        const msg = err?.message || 'worker load error';
        this.onNote?.(`local STT worker failed: ${msg}`);
        this.stop();
        this.onFailed?.(msg);
      };
      w.postMessage({ type: 'init', hotwords: this._hotwords });
    } catch (e) {
      this.failed = true;
      this.onNote?.(`local STT init error: ${e?.message || e}`);
      this.onFailed?.(String(e?.message || e));
    }
  }

  /** Attach an echo-cancelled MediaStream and start streaming 16 kHz frames into the worker. */
  async start(stream) {
    if (this.failed || !stream) return false;
    if (!this._worker) this.warmup();
    this.stopAudio();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      const ctx = new AC();
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      const src = ctx.createMediaStreamSource(stream);
      // Zero-gain sink keeps WebAudio graph pulled without echoing mic to speakers
      const sink = ctx.createGain();
      sink.gain.value = 0;
      sink.connect(ctx.destination);

      let node = null;
      if (ctx.audioWorklet && typeof Blob !== 'undefined') {
        const blobUrl = URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'application/javascript' }));
        try {
          await ctx.audioWorklet.addModule(blobUrl);
          node = new AudioWorkletNode(ctx, 'reverie-pcm16k');
          node.port.onmessage = e => {
            const chunk = e.data;
            if (this._worker && this.active && chunk instanceof Float32Array) {
              this._worker.postMessage({ type: 'audio', pcm: chunk }, [chunk.buffer]);
            }
          };
          src.connect(node);
          node.connect(sink);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      } else if (typeof ctx.createScriptProcessor === 'function') {
        // Fallback for older WebViews without AudioWorklet
        const ratio = ctx.sampleRate / 16000;
        let pos = 0, out = new Float32Array(512), n = 0, prev = 0;
        node = ctx.createScriptProcessor(2048, 1, 1);
        node.onaudioprocess = ev => {
          if (!this._worker || !this.active) return;
          const ch = ev.inputBuffer.getChannelData(0);
          while (pos < ch.length) {
            const idx = Math.floor(pos), frac = pos - idx;
            const s0 = idx === 0 ? prev : ch[idx - 1], s1 = ch[idx];
            out[n++] = s0 + (s1 - s0) * frac;
            if (n === 512) {
              const chunk = out;
              this._worker.postMessage({ type: 'audio', pcm: chunk }, [chunk.buffer]);
              out = new Float32Array(512); n = 0;
            }
            pos += ratio;
          }
          pos -= ch.length;
          prev = ch[ch.length - 1];
        };
        src.connect(node);
        node.connect(sink);
      } else {
        ctx.close?.().catch?.(() => {});
        return false;
      }

      this._ctx = ctx; this._src = src; this._node = node; this._sink = sink;
      this.active = true;
      return true;
    } catch (e) {
      this.onNote?.(`local STT audio capture failed: ${e?.message || e}`);
      this.stopAudio();
      return false;
    }
  }

  /** Update domain hotwords (e.g. room items, pet name) boosted during Zipformer decoding. */
  setHotwords(words) {
    this._hotwords = Array.isArray(words) ? words.slice() : [];
    if (this._worker && this.ready) this._worker.postMessage({ type: 'hotwords', words: this._hotwords });
  }

  /** Tell the worker whether Reverie is currently speaking so VAD raises its echo-bleed guard. */
  setBotSpeaking(on) {
    const b = !!on;
    if (b === this._botSpeaking) return;
    this._botSpeaking = b;
    if (this._worker) this._worker.postMessage({ type: 'speaking', on: b });
  }

  /** Reset VAD + Zipformer streaming buffers (e.g. after barge-in or stop). */
  reset() {
    this.vadProb = 0; this.speaking = false;
    if (this._worker && this.ready) this._worker.postMessage({ type: 'reset' });
  }

  stopAudio() {
    this.active = false;
    this.vadProb = 0; this.speaking = false; this.rms = 0;
    try { this._src?.disconnect(); } catch {}
    try { this._node?.disconnect(); } catch {}
    try { this._sink?.disconnect(); } catch {}
    if (this._ctx) { this._ctx.close?.().catch?.(() => {}); this._ctx = null; }
    this._src = this._node = this._sink = null;
  }

  stop() {
    this.stopAudio();
    this.reset();
  }

  dispose() {
    this.stopAudio();
    if (this._worker) { this._worker.terminate(); this._worker = null; }
    this.ready = false;
  }
}
