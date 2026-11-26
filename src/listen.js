// Listening: the browser's own speech recogniser, asked for the microphone first so the browser shows its prompt.
// The engine's gs.hear Voice only listens on the device itself (a Game Scroll rule), which most browsers can't do, so
// on the live page it never started and never asked. Reverie is not a Game Scroll game: it uses the device's own
// recogniser where the browser has one and the language is there, and the browser's usual one otherwise.
// Same shape as gs.hear's Voice: start(), stop(), listening, available, text (what is being said now), next().

const R = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
const norm = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();

export class Listener {
  constructor({ language = navigator.language || 'en-GB' } = {}) {
    this.language = language; this.text = ''; this.said = [];
    this.listening = false; this.want = false; this.rec = null; this.local = false;
    // (a browser driven by tests has the class but no speech service: starting it there takes the page down)
    this.available = !!R && !navigator.webdriver;
    /** Why it stopped for good, if it did: 'denied' (no microphone allowed), 'unavailable' or null. */
    this.problem = this.available ? null : 'unavailable';
  }

  /** Asks for the microphone (the browser's prompt) and starts listening. Call from a tap. Resolves to true if it is. */
  async start() {
    if (this.listening) return true;
    if (!this.available) return false;
    // the prompt: asking for the microphone ourselves makes the browser show it now, and tells us plainly if it is refused
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      for (const t of s.getTracks()) t.stop();
    } catch (e) {
      if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') { this.problem = 'denied'; this.available = false; return false; }
      // (no getUserMedia here, or no device: the recogniser asks by itself)
    }
    // on the device where it can (Chrome with the language downloaded), else the browser's usual recogniser
    this.local = false;
    if ('processLocally' in R.prototype && typeof R.available === 'function') {
      try { this.local = (await R.available({ langs: [this.language], processLocally: true })) === 'available'; } catch { this.local = false; }
    }
    this.want = true;
    return this.listen();
  }

  listen() {
    const rec = new R();
    rec.lang = this.language; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    if (this.local) rec.processLocally = true;
    rec.onresult = e => {
      let now = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i], t = norm(r[0].transcript);
        if (r.isFinal) { if (t) { this.said.push(t); if (this.said.length > 8) this.said.shift(); } }
        else now += (now ? ' ' : '') + t;
      }
      this.text = now;
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.problem = 'denied'; this.want = false; this.available = false; }
      // (the device recogniser can say its language isn't there after all: fall back to the usual one)
      else if (e.error === 'language-not-supported' && this.local) this.local = false;
    };
    rec.onend = () => { this.listening = false; this.rec = null; this.text = ''; if (this.want) setTimeout(() => this.want && this.listen(), 200); };
    try { rec.start(); this.rec = rec; this.listening = true; } catch { this.listening = false; }
    return this.listening;
  }

  /** The next thing said, whole, once it is finished (oldest first), or null. */
  next() { return this.said.length ? this.said.shift() : null; }

  stop() {
    this.want = false; this.listening = false; this.text = '';
    if (this.rec) { try { this.rec.abort(); } catch { /* gone */ } this.rec = null; }
  }
}
