// Listening: the browser's own speech recogniser, asked for the microphone first so the browser shows its prompt.
// The engine's gs.hear Voice only listens on the device itself (a Game Scroll rule), which most browsers can't do, so
// on the live page it never started and never asked. Reverie is not a Game Scroll game: it uses the device's own
// recogniser where the browser has one and the language is there, and the browser's usual one otherwise.
// Same shape as gs.hear's Voice: start(), stop(), listening, available, text (what is being said now), next().
//
// Browsers differ in what their recogniser really does, and some fail without saying so (Edge took our microphone
// track and the device-recogniser flag, then never heard a word). So it listens in the best way first and steps down
// a way each time one shows it isn't working: an error, no audio soon after starting, or sessions that end at once.
//   1. our echo-cancelled microphone track, on the device where it can      (Chrome)
//   2. the recogniser's own microphone, on the device where it can
//   3. the recogniser's own microphone, the browser's usual service          (Edge, Safari)
//   4. the same, one phrase per session (not continuous), started again after each
// Every event is logged to the console as "[reverie] mic: ...", and kept in .log, to see what a browser does.
//
// When they have finished: a recogniser decides a phrase is over well after the words stop (often a second or more),
// and only then gives it as final. settle(ms) lets the page answer sooner: words that have stood still for ms are taken
// as said, there and then. If the recogniser's final turns out the same, it is dropped; if they went on, or it heard
// the words differently, the whole phrase comes again as { more: true }, to be asked instead of the first part.

const R = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
/** The same words, near enough: a recogniser's final often differs from what it showed by a word ("to" for "two"),
 * which is not worth asking again for. */
export function sameWords(a, b) {
  const x = String(a).split(' ').filter(Boolean), y = String(b).split(' ').filter(Boolean);
  if (x.length !== y.length) return false;
  let d = 0; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++;
  return d <= Math.max(1, Math.floor(x.length / 5));
}
const norm = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
/** Edge (desktop and phone): its recogniser ignores a track and the device flag, so it starts at the plain way. */
const EDGE = /\bEdg(e|A|iOS)?\//.test(ua) || !!navigator.userAgentData?.brands?.some(b => /Edge/.test(b.brand));
const WAYS = ['track', 'own mic', 'plain', 'one at a time'];
const AUDIO_WAIT = 4000;     // ms from start to the recogniser's audiostart before that way counts as not working
const QUICK_END = 1500;      // a session that ends this soon with nothing heard counts as a failure
const BAD = new Set(['network', 'audio-capture', 'language-not-supported', 'bad-grammar', 'phrases-not-supported']);

export class Listener {
  constructor({ language = navigator.language || 'en-GB', onProblem = null, onNote = null } = {}) {
    this.language = language; this.text = ''; this.said = [];
    this.textAt = 0;              // when .text last changed
    this.early = '';              // words taken as said by settle() that the recogniser hasn't given as final yet
    this.listening = false; this.want = false; this.rec = null; this.local = false;
    this.onProblem = onProblem; this.onNote = onNote;
    this.firstWay = this.way = EDGE ? 2 : 0;      // index into WAYS (Edge: straight to the plain way)
    this.fails = 0;               // failures in a row at this way
    this.log = [];
    // (a browser driven by tests has the class but no speech service: starting it there takes the page down)
    this.available = !!R && !navigator.webdriver;
    /** Why it stopped for good, if it did: 'denied' (no microphone allowed), 'unavailable', 'broken' or null. */
    this.problem = this.available ? null : 'unavailable';
    this.note(`recogniser ${R ? (window.SpeechRecognition ? 'SpeechRecognition' : 'webkitSpeechRecognition') : 'none'}, ${EDGE ? 'Edge' : 'not Edge'}, language ${language}`);
  }

  note(what) {
    const line = `${(performance.now() / 1000).toFixed(1)}s ${what}`;
    this.log.push(line); if (this.log.length > 60) this.log.shift();
    console.info(`[reverie] mic: ${what}`); this.onNote?.(what);
  }

  /** Asks for the microphone (the browser's prompt) and starts listening. Call from a tap. Resolves to true if it is. */
  async start() {
    if (this.listening) return true;
    if (!this.available) { this.note(`not starting: ${this.problem}`); return false; }
    // the prompt: asking for the microphone ourselves makes the browser show it now, and tells us plainly if it is refused
    try {
      this.release();
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const t = this.stream.getAudioTracks()[0];
      this.micAllowed = true;
      this.note(`microphone allowed: "${t?.label || 'unnamed'}", ${t?.readyState}${t?.muted ? ', muted' : ''}`);
      this._startVad(this.stream);
      // (only the first way listens to this stream: the others needed it just for the prompt)
      if (WAYS[this.way] !== 'track') this.release();
    } catch (e) {
      this.note(`microphone refused: ${e?.name} ${e?.message || ''}`);
      if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') { this.problem = 'denied'; this.available = false; return false; }
      // (no getUserMedia here, or no device: the recogniser asks by itself)
    }
    // on the device where it can (Chrome with the language downloaded), else the browser's usual recogniser
    this.canLocal = false;
    if ('processLocally' in R.prototype && typeof R.available === 'function') {
      try { const a = await R.available({ langs: [this.language], processLocally: true }); this.canLocal = a === 'available'; this.note(`on-device recogniser: ${a}`); }
      catch (e) { this.note(`on-device check failed: ${e?.message || e}`); }
    }
    this.want = true; this.problem = null; this.fails = 0;
    return this.listen();
  }

  /** Lightweight RMS energy meter on the echo-cancelled mic track (for instant acoustic ducking). */
  _startVad(stream) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || !stream) return;
      this._vadCtx = new AC();
      const src = this._vadCtx.createMediaStreamSource(stream);
      const an = this._vadCtx.createAnalyser(); an.fftSize = 256;
      src.connect(an);
      this._vad = { an, buf: new Uint8Array(an.fftSize) };
    } catch { this._vad = null; }
  }

  /** Current mic RMS level (0..1) for instant barge-in ducking, or 0 if unavailable. */
  get voiceLevel() {
    if (!this._vad) return 0;
    const { an, buf } = this._vad;
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / buf.length);
  }

  /** True when the user's voice energy is clearly above background noise. */
  get speakingNow() { return this.voiceLevel > .045; }

  /** The microphone stream we hold is only for way 1; elsewhere it is let go so the recogniser has the mic to itself. */
  release() {
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    if (this._vadCtx) { this._vadCtx.close?.().catch?.(() => {}); this._vadCtx = null; }
    this._vad = null;
  }

  /** This way isn't working: try the next one, or give up and say so. */
  stepDown(why) {
    clearTimeout(this.watch);
    if (this.way < WAYS.length - 1) {
      this.way++; this.fails = 0;
      this.note(`not working (${why}): trying "${WAYS[this.way]}" next`);
      if (WAYS[this.way] !== 'track') this.release();
      if (this.rec) { const r = this.rec; this.rec = null; r.onend = null; try { r.abort(); } catch { /* gone */ } }
      this.listening = false;
      if (this.want) setTimeout(() => this.want && this.listen(), 250);
      return;
    }
    this.note(`not working (${why}), and there is nothing left to try: listening is off`);
    this.fail('broken');
  }

  fail(problem) {
    this.problem = problem; this.want = false; this.listening = false; this.text = '';
    if (problem !== 'denied') this.available = false;
    clearTimeout(this.watch); this.release();
    if (this.rec) { const r = this.rec; this.rec = null; r.onend = null; try { r.abort(); } catch { /* gone */ } }
    this.onProblem?.(problem);
  }

  listen() {
    const way = WAYS[this.way], rec = new R(), t0 = performance.now();
    let audio = false, heard = false, empty = 0;
    rec.lang = this.language; rec.continuous = way !== 'one at a time'; rec.interimResults = true; rec.maxAlternatives = 1;
    const local = this.canLocal && this.way < 2;
    if (local) rec.processLocally = true;
    const ms = () => Math.round(performance.now() - t0);
    rec.onstart = () => this.note(`start (${way}${local ? ', on device' : ''})`);
    rec.onaudiostart = () => { audio = true; clearTimeout(this.watch); this.note(`audio start, ${ms()} ms`); };
    rec.onsoundstart = () => this.note('sound start');
    rec.onspeechstart = () => this.note('speech start');
    rec.onspeechend = () => this.note('speech end');
    rec.onnomatch = () => this.note('no match');
    rec.onresult = e => {
      if (this.rec !== rec) return;
      // (results that are all empty: the recogniser is getting silence, not us. Edge does this with our track)
      const words = [...e.results].some(r => r[0]?.transcript?.trim());
      if (!words) { if (++empty >= 3) this.stepDown('only empty results'); return; }
      heard = true; empty = 0; this.fails = 0;
      let now = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i], t = norm(r[0].transcript);
        if (r.isFinal) { if (t) this.finished(t); }
        else now += (now ? ' ' : '') + t;
      }
      if (now !== this.text) { this.text = now; this.textAt = performance.now(); }
    };
    rec.onerror = e => {
      this.note(`error "${e.error}"${e.message ? ': ' + e.message : ''}, ${ms()} ms`);
      if (this.rec !== rec) return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        // (with our own microphone already allowed, a refusal here is the recogniser's service, not the person)
        if (this.way < WAYS.length - 1) return this.stepDown(e.error);
        return this.fail(this.micAllowed ? 'broken' : 'denied');
      }
      if (BAD.has(e.error)) return this.stepDown(e.error);
      // ('no-speech' and 'aborted' are ordinary: it starts again when it ends)
    };
    rec.onend = () => {
      clearTimeout(this.watch);
      this.note(`end, ${ms()} ms${heard ? '' : ', nothing heard'}`);
      if (this.rec !== rec) return;
      // (words it was still hearing when the session ended are never given as final: they are said, not lost)
      if (this.text && this.text !== this.early) this.finished(this.text);
      this.early = '';
      this.listening = false; this.rec = null; this.text = '';
      if (!this.want) return;
      // ending at once, again and again, with nothing heard: this way isn't working
      if (!heard && ms() < QUICK_END && ++this.fails >= 2) return this.stepDown('ends at once');
      setTimeout(() => this.want && !this.rec && this.listen(), 200);
    };
    const track = way === 'track' ? this.stream?.getAudioTracks().find(t => t.readyState === 'live') : null;
    try {
      // (start(track): Chrome's recogniser can listen to a track of ours; elsewhere the argument is refused or ignored,
      // and "ignored" is the trap: it then hears nothing, which the watch below catches)
      if (track) { try { rec.start(track); } catch (e) { this.note(`start(track) refused: ${e?.message || e}`); this.rec = null; return this.stepDown('track refused'); } }
      else rec.start();
      this.rec = rec; this.listening = true;
    } catch (e) {
      this.note(`start failed: ${e?.name} ${e?.message || ''}`);
      this.listening = false;
      if (this.want) { this.stepDown('start failed'); return this.want; }
    }
    clearTimeout(this.watch);
    this.watch = setTimeout(() => { if (this.rec === rec && !audio && !heard) this.stepDown(`no audio after ${AUDIO_WAIT / 1000} s`); }, AUDIO_WAIT);
    return this.listening;
  }

  /** A phrase the recogniser gave as final: said, unless it is what settle() already took. */
  finished(t) {
    const early = this.early; this.early = '';
    if (early && sameWords(t, early)) { this.note(`heard "${t}" (already taken)`); return; }
    this.put({ text: t, more: !!early, at: this.text ? this.textAt : performance.now() });   // (when its words last changed)
    this.note(`heard "${t}"${early ? ` (the rest of "${early}")` : ''}`);
  }

  put(x) { this.said.push(x); if (this.said.length > 8) this.said.shift(); }

  /**
   * Words heard that have not changed for ms are taken as said now, before the recogniser is sure the phrase is over.
   * True when it took them. Again after they go on: the whole phrase, as { more: true }.
   */
  settle(ms) {
    const t = this.text;
    if (!t || t === this.early || performance.now() - this.textAt < ms) return false;
    this.put({ text: t, more: !!this.early, at: this.textAt });
    this.note(`taken at a pause: "${t}"${this.early ? ' (the rest)' : ''}`);
    this.early = t;
    return true;
  }

  /** The next thing said, once it is finished (oldest first): { text, more, at }, or null. more: all of the phrase whose
   * first part came before (settle()), to be asked instead of it. at: about when its last word was heard (performance.now()). */
  next() { return this.said.length ? this.said.shift() : null; }

  stop() {
    this.want = false; this.listening = false; this.text = ''; this.early = '';
    clearTimeout(this.watch); this.release();
    if (this.rec) { try { this.rec.abort(); } catch { /* gone */ } this.rec = null; }
    this.note('stopped');
  }
}
