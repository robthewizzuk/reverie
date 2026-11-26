// The turn loop: what you say goes to Claude (through the backend, server/turn.js), its reply streams back, each
// sentence is spoken as soon as it is complete while the rest is still being written, and each tool call runs the
// moment its words are in (a prop starts being made mid-sentence). Tool results go back to Claude, which may say a
// little more. Talking over it stops it at once.
import gs from '../engine/src/gamescroll.js';
import { weather, contextLine } from './place.js';
import { sayOptions, setVoice } from './looks.js';

const API = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '') + '/api/turn';
const KEEP = 40;                 // messages kept in the conversation (older ones drop off, whole turns at a time)
const MAX_STEPS = 5;             // model calls in one turn (tool rounds)
const GESTURES = ['none', 'wave', 'point', 'tada', 'shrug', 'think', 'nod', 'shake', 'bounce'];
const MOODS = ['calm', 'happy', 'excited', 'curious', 'sad', 'surprised'];

// Text for the voice: no markdown, no stage directions.
const spoken = s => s.replace(/[*_#`~>|]/g, '').replace(/\[(?!hmm|laugh|sigh|gasp)[^\]]*\]/gi, '').replace(/\s+/g, ' ').trim();

// The mic hears the creature too, and the recogniser's last words about a line can come seconds after it was said
// (while it makes a prop, say). So what is heard is always checked against everything it said in the last ECHO_KEEP
// ms and everything it is about to say, loosely (a recogniser mishears its voice: "magic" as "magical"). Words of two
// letters or fewer don't count either way.
const ECHO_KEEP = 9000;
const wordsOf = s => String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2);
function near(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4)) return true;   // (magic / magical, colour / colours)
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
  let i = 0, j = 0, d = 0;   // one letter different, missing or extra
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++d > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return d + (a.length - i) + (b.length - j) <= 1;
}

/** Says sentences in order, one after another, with the mouth moving; the next is written while one is said. */
function makeSpeaker(creature, onCaption) {
  let queue = [], busy = false, epoch = 0, buf = '', idle = Promise.resolve(), endIdle = () => {};
  // what it said lately, as words, so the mic can tell its own voice from yours (said: { words, until })
  let said = [];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function run(my) {
    busy = true; creature.state.speaking = true;
    while (queue.length && my === epoch) {
      const line = queue.shift();
      // the bubble shows when the voice starts, not while the line is still being made ready
      let shown = false; const show = () => { if (!shown && my === epoch) { shown = true; onCaption(line); } };
      said.push({ words: new Set(wordsOf(line)), until: Infinity }); if (said.length > 6) said.shift();
      const t0 = performance.now();
      if (queue[0]) gs.sound.prepare(queue[0], sayOptions()).catch(() => {});
      const ok = await creature.say(line, sayOptions(), show).catch(() => false);
      show();   // (no voice here: the bubble alone, for as long as it takes to read)
      // no voice here (a browser that can't speak): give the line the time it takes to read
      if (!ok && my === epoch) await wait(Math.max(0, line.split(' ').length * 330 - (performance.now() - t0)));
      said.at(-1).until = performance.now();
    }
    if (my === epoch) { busy = false; creature.state.speaking = false; endIdle(); }
  }
  function push(line) {
    line = spoken(line); if (!line) return;
    queue.push(line);
    if (!busy) { idle = new Promise(r => { endIdle = r; }); run(epoch); }
    else if (queue.length === 1) gs.sound.prepare(line, sayOptions()).catch(() => {});
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
      const now = performance.now(), mine = new Set();
      for (const x of said) if (now - x.until < ECHO_KEEP) for (const w of x.words) mine.add(w);
      for (const w of wordsOf([...queue, buf].join(' '))) mine.add(w);   // (about to be said: the reply streams ahead of the voice)
      const words = wordsOf(text);
      return { words, yours: mine.size ? words.filter(w => !mine.has(w) && ![...mine].some(m => near(w, m))) : words };
    },
    /** Resolves when it has said everything queued. */
    done: () => busy ? idle : Promise.resolve(),
    stop() { for (const x of said) if (x.until === Infinity) x.until = performance.now(); epoch++; queue = []; buf = ''; busy = false; creature.state.speaking = false; gs.sound.stopTalking(); creature.face.hush(); endIdle(); },
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
  if (name === 'weather' && input.place != null && typeof input.place !== 'string') return 'place must be text';
  if (name === 'voice' && input.name != null && typeof input.name !== 'string') return 'name must be text';
  if (name === 'voice' && ['size', 'lively'].some(k => input[k] != null && typeof input[k] !== 'number')) return 'size and lively must be numbers';
  if (name === 'colours' && ['body', 'glow'].some(k => input[k] != null && typeof input[k] !== 'string')) return 'colours must be text';
  if (name === 'act' && (!GESTURES.includes(input.gesture) || !MOODS.includes(input.mood))) return 'unknown gesture or mood';
  if (name === 'play' && typeof input.game !== 'string') return 'game must be a name';
  if (name === 'roll' && input.dice != null && typeof input.dice !== 'string') return 'dice must be text, like 2d6';
  if (name === 'place' && (typeof input.spot !== 'string' || !input.spot.trim())) return 'spot must be a place';
  if (name === 'place' && ['item', 'near', 'size'].some(k => input[k] != null && typeof input[k] !== 'string')) return 'item, near and size must be text';
  if (name === 'room_colours' && ['walls', 'floor', 'rug', 'wood'].some(k => input[k] != null && typeof input[k] !== 'string')) return 'colours must be text';
  if (name === 'game_move' && (typeof input.move !== 'string' || !input.move.trim())) return 'move must be text';
  return null;
}

/** Did they ask to play a game? { game, level } or null. Asking to stop, or talking about a game, is not asking. */
export function gameAsked(text) {
  const t = text.toLowerCase().replace(/^\[from the device[^\]]*\]\s*/, '');
  const game = /\bchess\b/.test(t) ? 'chess' : /\b(quiz|trivia|quiz me)\b/.test(t) ? 'quiz' : null;
  if (!game || /\b(stop|quit|end|enough|no more|don'?t|not now|later|rules|history|who invented)\b/.test(t)) return null;
  if (!/\b(play|game|match|fancy|let'?s|up for|challenge|set up|get out|board|again|rematch|wanna|want to|quiz me|another|round|start|do a|have a|host)\b/.test(t) && !/^\W*(chess|quiz|trivia)\W*$/.test(t)) return null;
  const level = /\b(easy|gentle|beginner|go easy)\b/.test(t) ? 1 : /\b(hardest|master|best you can|full strength)\b/.test(t) ? 5 : /\b(hard|tough|serious)\b/.test(t) ? 4 : undefined;
  return { game, level };
}

export function makeBrain({ world, onCaption = () => {}, onStatus = () => {}, onTiming = () => {}, tools: extra = {} }) {
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
    if (turnCtx) for (let i = out.length - 1; i >= 0; i--) if (out[i].role === 'user' && typeof out[i].content === 'string') { out[i] = { role: 'user', content: out[i].content.replace(/^(\[From the device[^\n]*\n)?/, (_, d = '') => d + turnCtx + '\n') }; break; }
    return out;
  }

  function runTool(name, input) {
    const bad = checkInput(name, input); if (bad) return Promise.resolve({ text: `Not done: ${bad}.`, error: true });
    if (name === 'think_harder') return Promise.resolve(deepNow
      ? { text: 'You are already thinking harder. Answer the question now.', error: true }
      : { text: 'Handed over to deeper thinking. You are now thinking harder about this question: answer it now, and do not call think_harder again.', deep: true });
    const fn = { make: () => world.make(input.words), change: () => world.change(input.words), toss: () => world.toss(), weather: () => weather(input.place), clear: () => world.clear({ room: !!input.room }), place: () => world.place(input), room_colours: () => world.recolourRoom(input), act: () => world.act(input.gesture, input.mood), voice: async () => setVoice(input), colours: () => world.recolour(input),
      play: () => world.play(input.game, { level: input.level }), game_move: () => world.game ? world.game.command(input.move) : Promise.resolve('No game is being played.'), stop_game: () => world.stopGame(),
      roll: () => world.roll(input.dice || '1d6'), ...Object.fromEntries(Object.entries(extra).map(([k, f]) => [k, () => f(input)])) }[name];
    if (!fn) return Promise.resolve({ text: `There is no tool called ${name}.`, error: true });
    // (a tool answers with a sentence, or with { text, error } when it was not done)
    return fn().then(r => typeof r === 'string' ? { text: r } : r, e => ({ text: `It went wrong: ${String(e?.message || e).slice(0, 120)}`, error: true }));
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
    // "let's play chess": the board goes up at once, before Claude has said a word (so it can't make a prop board instead)
    const wantsGame = !o.news && gameAsked(text);
    if (wantsGame && (world.game?.id !== wantsGame.game || world.game.state === 'done')) {
      const r = await world.play(wantsGame.game, { level: wantsGame.level });
      text += `\n(The ${wantsGame.game} ${wantsGame.game === 'chess' ? 'board' : 'table'} was set up straight away when they asked: ${r} Don't call play or make for it; just react.)`;
    }
    turnCtx = world.game?.context() || '';
    const my = ++turn;
    // talking over it: it stops, and is told what it didn't get to say
    if (ctl) { ctl.abort(); ctl = null; }
    if (speaker.talking) { console.info('[reverie] stopped talking for a new turn: ' + text.slice(0, 80)); cut = speaker.pending || cut; speaker.stop(); }
    const note = cut ? ` (You were interrupted before saying: "${cut.slice(0, 200)}")` : ''; cut = '';
    // (where and when they are rides at the top of what they said: added, never changed later)
    history.push({ role: 'user', content: contextLine(world.scene?.()) + '\n' + text + note });
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
    interrupt(why = '') { if (speaker.talking || ctl) console.info('[reverie] stopped: ' + (why || 'interrupted')); turn++; if (ctl) { ctl.abort(); ctl = null; } if (speaker.talking) cut = speaker.pending || cut; speaker.stop(); creature.state.thinking = false; creature.state.listening = true; },
    get history() { return history; },
    get speaking() { return speaker.talking; },
    /** What the mic heard, split into all its words and the ones that are yours (not its own voice coming back). */
    yours: text => speaker.yours(text),
    /** Says a line of its own (not from Claude), such as its hello. */
    speak(line) { speaker.feed(line + ' '); speaker.flush(); },
    get busy() { return !!ctl || creature.state.thinking; },
  };
}
