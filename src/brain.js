// The turn loop: what you say goes to Claude (through the backend, server/turn.js), its reply streams back, each
// sentence is spoken as soon as it is complete while the rest is still being written, and each tool call runs the
// moment its words are in (a prop starts being made mid-sentence). Tool results go back to Claude, which may say a
// little more. Talking over it stops it at once.
import gs from '../engine/src/gamescroll.js';

const API = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '') + '/api/turn';
const KEEP = 40;                 // messages kept in the conversation (older ones drop off, whole turns at a time)
const MAX_STEPS = 5;             // model calls in one turn (tool rounds)
// Its voice: the engine's Phonon voice, a British woman's, a little smaller and livelier than she is.
export const VOICE = { voice: { kind: 'woman', lang: ['en-GB'], take: 2 }, size: .92, lively: .65 };
const GESTURES = ['none', 'wave', 'point', 'tada', 'shrug', 'think', 'nod', 'shake', 'bounce'];
const MOODS = ['calm', 'happy', 'excited', 'curious', 'sad', 'surprised'];

// Text for the voice: no markdown, no stage directions.
const spoken = s => s.replace(/[*_#`~>|]/g, '').replace(/\[(?!hmm|laugh|sigh|gasp)[^\]]*\]/gi, '').replace(/\s+/g, ' ').trim();

// The mic hears the creature too. What it heard is checked against what it just said: words it said in the last
// ECHO_KEEP ms are not counted as yours, and for ECHO_TAIL ms after it goes quiet the check stays on.
const ECHO_KEEP = 6000, ECHO_TAIL = 1500;
const wordsOf = s => String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);

/** Says sentences in order, one after another, with the mouth moving; the next is written while one is said. */
function makeSpeaker(creature, onCaption) {
  let queue = [], busy = false, epoch = 0, buf = '', idle = Promise.resolve(), endIdle = () => {};
  // what it said lately, as words, so the mic can tell its own voice from yours (said: { words, until })
  let said = [], quietAt = 0;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function run(my) {
    busy = true; creature.state.speaking = true;
    while (queue.length && my === epoch) {
      const line = queue.shift();
      // the bubble shows when the voice starts, not while the line is still being made ready
      let shown = false; const show = () => { if (!shown && my === epoch) { shown = true; onCaption(line); } };
      said.push({ words: new Set(wordsOf(line)), until: Infinity }); if (said.length > 6) said.shift();
      const t0 = performance.now();
      if (queue[0]) gs.sound.prepare(queue[0], VOICE).catch(() => {});
      const ok = await creature.say(line, VOICE, show).catch(() => false);
      show();   // (no voice here: the bubble alone, for as long as it takes to read)
      // no voice here (a browser that can't speak): give the line the time it takes to read
      if (!ok && my === epoch) await wait(Math.max(0, line.split(' ').length * 330 - (performance.now() - t0)));
      said.at(-1).until = performance.now();
    }
    if (my === epoch) { busy = false; creature.state.speaking = false; quietAt = performance.now(); endIdle(); }
  }
  function push(line) {
    line = spoken(line); if (!line) return;
    queue.push(line);
    if (!busy) { idle = new Promise(r => { endIdle = r; }); run(epoch); }
    else if (queue.length === 1) gs.sound.prepare(line, VOICE).catch(() => {});
  }
  return {
    /** Text as it streams in: each whole sentence goes to the voice straight away. */
    feed(text) {
      buf += text;
      for (;;) {
        const m = /^([\s\S]*?[.!?…]+["')\]]*)\s+/.exec(buf);
        if (m && m[1].trim().length >= 2) { push(m[1]); buf = buf.slice(m[0].length); continue; }
        // a long run with no full stop yet: say up to its last comma
        if (buf.length > 160) { const i = buf.lastIndexOf(', '); if (i > 40) { push(buf.slice(0, i + 1)); buf = buf.slice(i + 2); continue; } }
        break;
      }
    },
    flush() { if (buf.trim()) push(buf); buf = ''; },
    /** Everything said so far in this reply that is still to come, for "you were interrupted". */
    get pending() { return [...queue, buf].join(' ').trim(); },
    get talking() { return busy; },
    /** The words in `text` that are not its own voice coming back through the mic: everything while it is quiet, and
     * only the words it has not just said while it talks or has just stopped (an echo reaches the mic late). */
    yours(text) {
      const words = wordsOf(text), now = performance.now();
      if (!busy && now - quietAt > ECHO_TAIL) return words;
      const mine = said.filter(x => now - x.until < ECHO_KEEP);
      return words.filter(w => !mine.some(x => x.words.has(w)));
    },
    /** Resolves when it has said everything queued. */
    done: () => busy ? idle : Promise.resolve(),
    stop() { if (busy) quietAt = performance.now(); for (const x of said) if (x.until === Infinity) x.until = performance.now(); epoch++; queue = []; buf = ''; busy = false; creature.state.speaking = false; gs.sound.stopTalking(); creature.face.hush(); endIdle(); },
  };
}

/** Reads a text/event-stream response, calling onEvent for each `data:` object. */
async function readEvents(res, onEvent) {
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
      if (data) onEvent(JSON.parse(data));
    }
  }
}

/** A tool input is checked before it runs: streamed tool inputs are not checked by the API. */
function checkInput(name, input) {
  if (!input || typeof input !== 'object') return 'no input';
  if ((name === 'make' || name === 'change') && (typeof input.words !== 'string' || !input.words.trim())) return 'words must be text';
  if (name === 'act' && (!GESTURES.includes(input.gesture) || !MOODS.includes(input.mood))) return 'unknown gesture or mood';
  if (name === 'play' && typeof input.game !== 'string') return 'game must be a name';
  if (name === 'game_move' && (typeof input.move !== 'string' || !input.move.trim())) return 'move must be text';
  return null;
}

export function makeBrain({ world, onCaption = () => {}, onStatus = () => {}, onTiming = () => {} }) {
  const creature = world.creature, speaker = makeSpeaker(creature, onCaption);
  let history = [], turn = 0, ctl = null, cut = '', deepNow = false;
  // a game's news (games/index.js): quiet news waits for the next thing said; loud news gets a reaction when it's free
  let news = [], loudAt = 0, turnCtx = '';

  function trimmed() {
    // keep the last KEEP messages, starting on a plain user message (never on tool results)
    let start = Math.max(0, history.length - KEEP);
    while (start < history.length && !(history[start].role === 'user' && typeof history[start].content === 'string')) start++;
    const out = history.slice(start);
    // the state of a game being played goes with the latest thing said (not kept in the history: it would go stale)
    if (turnCtx) for (let i = out.length - 1; i >= 0; i--) if (out[i].role === 'user' && typeof out[i].content === 'string') { out[i] = { role: 'user', content: turnCtx + '\n\n' + out[i].content }; break; }
    return out;
  }

  function runTool(name, input) {
    const bad = checkInput(name, input); if (bad) return Promise.resolve({ text: `Not done: ${bad}.`, error: true });
    if (name === 'think_harder') return Promise.resolve(deepNow
      ? { text: 'You are already thinking harder. Answer the question now.', error: true }
      : { text: 'Handed over to deeper thinking. You are now thinking harder about this question: answer it now, and do not call think_harder again.', deep: true });
    const fn = { make: () => world.make(input.words), change: () => world.change(input.words), toss: () => world.toss(), clear: () => world.clear(), act: () => world.act(input.gesture, input.mood),
      play: () => world.play(input.game, { level: input.level }), game_move: () => world.game ? world.game.command(input.move) : Promise.resolve('No game is being played.'), stop_game: () => world.stopGame() }[name];
    if (!fn) return Promise.resolve({ text: `There is no tool called ${name}.`, error: true });
    return fn().then(text => ({ text }), e => ({ text: `It went wrong: ${String(e?.message || e).slice(0, 120)}`, error: true }));
  }

  async function step(tier, my, times) {
    ctl = new AbortController();
    const tools = new Map(), running = [];
    let final = null, failed = null, firstText = true;
    const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier, messages: trimmed() }), signal: ctl.signal });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `the backend said ${res.status}`); }
    await readEvents(res, ev => {
      if (my !== turn) return;
      if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') tools.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, json: '' });
      else if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta') {
          if (firstText) { firstText = false; times.text ??= performance.now(); creature.state.thinking = false; onStatus(''); }
          speaker.feed(ev.delta.text);
        } else if (ev.delta.type === 'input_json_delta' && tools.has(ev.index)) tools.get(ev.index).json += ev.delta.partial_json;
      } else if (ev.type === 'content_block_stop' && tools.has(ev.index)) {
        // the tool's words are complete: start it now, while Claude goes on
        const tl = tools.get(ev.index); let input = null;
        try { input = tl.json ? JSON.parse(tl.json) : {}; } catch { input = null; }
        times.tool ??= performance.now();
        running.push(runTool(tl.name, input).then(r => ({ ...r, id: tl.id, name: tl.name })));
      } else if (ev.type === 'final') final = ev.message;
      else if (ev.type === 'error') failed = ev;
    });
    if (my !== turn) return null;
    speaker.flush();
    if (failed) throw new Error(failed.status === 429 ? 'too many requests just now' : failed.error);
    if (!final) throw new Error('the reply was cut off');
    if (final.stop_reason === 'refusal') {
      speaker.feed("Hmm, I'd rather not do that one. ");
      speaker.flush();
      return { results: [], content: [{ type: 'text', text: "Hmm, I'd rather not do that one." }] };
    }
    // a tool the model named but whose block never closed (cut off): answer it too, so the history stays whole
    for (const b of final.content) if (b.type === 'tool_use' && ![...tools.values()].some(t => t.id === b.id)) running.push(runTool(b.name, b.input).then(r => ({ ...r, id: b.id, name: b.name })));
    const results = await Promise.all(running);
    return { results, content: final.content, stop: final.stop_reason };
  }

  async function hear(text, o = {}) {
    text = String(text || '').trim().slice(0, 1000); if (!text) return;
    // game news not yet passed on goes first, so it knows what happened on the board
    if (news.length) { text = news.join('\n') + '\n\n' + text; news = []; loudAt = 0; }
    turnCtx = world.game?.context() || '';
    const my = ++turn;
    // talking over it: it stops, and is told what it didn't get to say
    if (ctl) { ctl.abort(); ctl = null; }
    if (speaker.talking) { cut = speaker.pending || cut; speaker.stop(); }
    const note = cut ? ` (You were interrupted before saying: "${cut.slice(0, 200)}")` : ''; cut = '';
    history.push({ role: 'user', content: text + note });
    creature.state.thinking = true; creature.state.listening = false;
    creature.gesture('nod'); onStatus('thinking');
    const times = { start: o.at ?? performance.now() };
    let tier = 'quick', errored = false; deepNow = false;
    try {
      for (let n = 0; n < MAX_STEPS; n++) {
        const r = await step(tier, my, times);
        if (!r || my !== turn) return;
        history.push({ role: 'assistant', content: r.content });
        if (!r.results.length) break;
        history.push({ role: 'user', content: r.results.map(x => ({ type: 'tool_result', tool_use_id: x.id, content: x.text, ...(x.error ? { is_error: true } : {}) })) });
        if (r.results.some(x => x.deep)) { tier = 'deep'; deepNow = true; creature.state.thinking = true; creature.gesture('think'); onStatus('thinking harder'); }
      }
    } catch (e) {
      if (e?.name === 'AbortError' || my !== turn) return;
      // the conversation stays whole: the user's words stay, with nothing after them
      speaker.feed(`Oops, my thinking went fuzzy for a second. ${/key/i.test(e.message) ? 'My key is missing.' : ''} `); speaker.flush();
      errored = true; onStatus('error: ' + e.message);
      console.warn('[reverie]', e);
    } finally {
      if (my === turn) { creature.state.thinking = false; ctl = null; if (!errored) onStatus(''); }
      times.end = performance.now();
      onTiming(times);
    }
  }

  return {
    hear,
    /** News from a game: loud news is reacted to out loud as soon as it is free, quiet news waits. */
    notice(text, loud = false) {
      news.push(String(text).slice(0, 600)); if (news.length > 6) news.shift();
      if (loud && !loudAt) loudAt = performance.now();
    },
    /** Every frame: says something about loud news once it isn't busy (news older than 8 s waits for the next turn). */
    update() {
      if (!loudAt) return;
      if (performance.now() - loudAt > 8000) { loudAt = 0; return; }
      if (ctl || creature.state.thinking || speaker.talking || creature.state.listening) return;
      const said = news.join('\n'); news = []; loudAt = 0;
      hear(said, { at: performance.now(), news: true });
    },
    /** You started talking: it stops and listens. */
    interrupt() { turn++; if (ctl) { ctl.abort(); ctl = null; } if (speaker.talking) cut = speaker.pending || cut; speaker.stop(); creature.state.thinking = false; creature.state.listening = true; },
    get history() { return history; },
    get speaking() { return speaker.talking; },
    /** The words of something heard by the mic that are yours, not its own voice coming back. */
    yours: text => speaker.yours(text),
    /** Says a line of its own (not from Claude), such as its hello. */
    speak(line) { speaker.feed(line + ' '); speaker.flush(); },
    get busy() { return !!ctl || creature.state.thinking; },
  };
}
