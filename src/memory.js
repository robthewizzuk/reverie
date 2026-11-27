// Reverie's diary: what it remembers about you, kept in this browser only (localStorage), never on a server. Your
// name, things you told it to remember, your birthday, how your games went, what it made for you, a line or two of
// what you talked about, and which days you came. Claude reads a short summary of it at the top of each chat (brain.js
// `memo`), and the diary sheet (diary.js) shows all of it, with a way to forget any part or everything.
// No three.js and no engine here, so the tests can read it.

const KEY = 'reverie.memory.v1';
const MAX_FACTS = 40, MAX_MADE = 24, MAX_CHAT = 30, MAX_DAYS = 45, MAX_DAY_LINES = 8;

/** A date as YYYY-MM-DD in the person's own time zone. */
export const dayOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Whole days from one YYYY-MM-DD to another. */
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00') - Date.parse(a + 'T12:00')) / 864e5);
const clean = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const words = s => clean(s, 400).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
const STOP = new Set(['the', 'and', 'that', 'this', 'about', 'with', 'they', 'them', 'their', 'are', 'was', 'for', 'have', 'has', 'you', 'your', 'like', 'likes']);

const blank = () => ({
  v: 1, name: null, birthday: null, facts: [],
  visits: { first: null, last: null, days: 0, streak: 0, best: 0, count: 0 },
  records: { chess: { won: 0, lost: 0, drawn: 0 }, quiz: { rounds: 0, best: 0, right: 0, asked: 0 }, made: 0, rolls: 0, doodles: 0 },
  made: [], days: {}, chat: [], seen: {},
});

/** Makes the diary, read from `store` (localStorage by default; tests pass their own { getItem, setItem, removeItem }). */
export function makeMemory({ store = globalThis.localStorage, clock = () => new Date() } = {}) {
  let m = load();
  const listeners = new Set();
  let ids = 0;

  function load() {
    try {
      const o = JSON.parse(store?.getItem(KEY) || 'null');
      if (!o || typeof o !== 'object' || o.v !== 1) return blank();
      const b = blank();
      return { ...b, ...o, visits: { ...b.visits, ...o.visits }, records: { ...b.records, ...o.records, chess: { ...b.records.chess, ...o.records?.chess }, quiz: { ...b.records.quiz, ...o.records?.quiz } },
        facts: Array.isArray(o.facts) ? o.facts.filter(f => f && typeof f.text === 'string') : [], made: Array.isArray(o.made) ? o.made : [],
        chat: Array.isArray(o.chat) ? o.chat : [], days: o.days && typeof o.days === 'object' ? o.days : {}, seen: o.seen && typeof o.seen === 'object' ? o.seen : {} };
    } catch { return blank(); }
  }
  function save() {
    // (old days drop off: the last MAX_DAYS kept)
    const keys = Object.keys(m.days).sort(); for (const k of keys.slice(0, Math.max(0, keys.length - MAX_DAYS))) delete m.days[k];
    try { store?.setItem(KEY, JSON.stringify(m)); } catch { /* a private window, or full: kept until the tab closes */ }
    for (const f of listeners) try { f(); } catch { /* a listener's problem */ }
  }
  const today = () => dayOf(clock());
  /** A line in today's diary page (the same line twice in a day is kept once). */
  function log(line) {
    const d = today(), list = m.days[d] ||= [];
    line = clean(line, 120); if (!line || list.includes(line)) return;
    list.push(line); if (list.length > MAX_DAY_LINES) list.shift();
  }

  return {
    /** What this visit is, without counting it: { first, newDay, away (days since the last visit), streak }. */
    peek() {
      const d = today(), last = m.visits.last;
      const away = last ? daysBetween(last, d) : null;
      return { first: !last, newDay: last !== d, away, streak: away === 1 ? m.visits.streak + 1 : away === 0 ? m.visits.streak : 1, name: m.name };
    },
    /** Counts this visit (once a day as a day, every time as a visit). Returns what peek() said before. */
    visit() {
      const p = this.peek(), d = today(), v = m.visits;
      v.count++;
      if (p.newDay) { v.days++; v.streak = p.streak; v.best = Math.max(v.best, v.streak); v.first ||= d; }
      v.last = d; save();
      return p;
    },

    get name() { return m.name; },
    get birthday() { return m.birthday; },
    get visits() { return { ...m.visits }; },
    get records() { return JSON.parse(JSON.stringify(m.records)); },
    /** Is it their birthday today? */
    birthdayToday() { return !!m.birthday && today().slice(5) === m.birthday; },

    /** The remember tool: { fact, name, birthday } (any of them). Resolves a sentence for Claude. */
    remember(input = {}) {
      const said = [];
      const name = clean(input.name, 40).replace(/[^\p{L}\p{M}' -]/gu, '').trim();
      if (name) { m.name = name; said.push(`their name is ${name}`); }
      const bd = parseBirthday(input.birthday);
      if (input.birthday && !bd) return { text: `Not kept: "${input.birthday}" is not a date I can read. Use MM-DD, like 03-21.`, error: true };
      if (bd) { m.birthday = bd; said.push(`their birthday is ${prettyDay(bd)}`); }
      const fact = clean(input.fact, 160);
      if (fact) {
        // the same fact told again replaces the old one (most of its words the same)
        const w = new Set(words(fact));
        const same = m.facts.findIndex(f => { const fw = words(f.text); return fw.length && fw.filter(x => w.has(x)).length / Math.max(fw.length, w.size) >= .7; });
        if (same >= 0) m.facts.splice(same, 1);
        m.facts.push({ id: `f${Date.now().toString(36)}${(ids++).toString(36)}`, text: fact, day: today() });
        if (m.facts.length > MAX_FACTS) m.facts.shift();
        said.push(`"${fact}"`);
      }
      if (!said.length) return { text: 'Nothing kept: give a fact, a name or a birthday.', error: true };
      log(`learned: ${said.join(', ')}`.replace(/"/g, ''));
      save();
      return `Written in your diary: ${said.join(', ')}. It stays in this browser, and you will remember it next time.`;
    },

    /** The forget tool: { what } names a fact, "my name", "my birthday", "the chats", or "everything". */
    forget(input = {}) {
      const what = clean(input.what, 160).toLowerCase();
      if (!what) return { text: 'Nothing forgotten: say what to forget.', error: true };
      if (/^(everything|all|it all|all of it|everything about me|the whole diary|your whole diary)$/.test(what)) { this.wipe(); return 'Forgot everything in the diary: their name, the facts, the records, the chats and the days. It starts fresh.'; }
      const gone = [];
      if (/\bname\b/.test(what) && m.name) { gone.push(`their name (${m.name})`); m.name = null; }
      if (/\bbirthday\b/.test(what) && m.birthday) { gone.push('their birthday'); m.birthday = null; }
      if (/\b(chats?|conversations?|what we (said|talked about))\b/.test(what) && m.chat.length) { gone.push('what you talked about'); m.chat = []; }
      if (/\b(records?|scores?)\b/.test(what)) { gone.push('the game records'); m.records = blank().records; }
      if (!gone.length) {
        const w = words(what);
        const hit = m.facts.map((f, i) => [i, words(f.text).filter(x => w.some(y => y === x || (y.length > 4 && x.startsWith(y.slice(0, 5))))).length]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
        if (!hit.length) return { text: `Nothing in the diary matches "${input.what}". It holds: ${m.facts.map(f => f.text).join('; ') || 'no facts'}.`, error: true };
        const best = hit[0][1], all = hit.filter(([, n]) => n === best).map(([i]) => i).sort((a, b) => b - a);
        for (const i of all) { gone.push(`"${m.facts[i].text}"`); m.facts.splice(i, 1); }
      }
      save();
      return `Forgot ${gone.join(', ')}. It is gone from the diary.`;
    },
    /** One fact taken out by its id (the diary sheet's ✕). */
    drop(id) { const n = m.facts.length; m.facts = m.facts.filter(f => f.id !== id); if (m.facts.length !== n) save(); },
    /** Everything gone. */
    wipe() { m = blank(); try { store?.removeItem(KEY); } catch { /* fine */ } save(); },

    /** Something that happened, for the records and today's page. */
    note(kind, o = {}) {
      const r = m.records;
      if (kind === 'made' && o.what) {
        const what = clean(o.what, 60); r.made++;
        m.made.push({ what, day: today() }); if (m.made.length > MAX_MADE) m.made.shift();
        log(`made ${what}`);
      } else if (kind === 'chess') {
        if (o.result === 'won') { r.chess.won++; log('they beat Reverie at chess'); }
        else if (o.result === 'lost') { r.chess.lost++; log('Reverie won at chess'); }
        else { r.chess.drawn++; log('a draw at chess'); }
      } else if (kind === 'quiz') {
        r.quiz.rounds++; r.quiz.right += o.score | 0; r.quiz.asked += o.of | 0; r.quiz.best = Math.max(r.quiz.best, o.score | 0);
        log(`scored ${o.score} out of ${o.of} in the quiz`);
      } else if (kind === 'roll') r.rolls++;
      else if (kind === 'doodle' && o.what) { r.doodles++; log(`drew ${clean(o.what, 40)}`); }
      else if (kind === 'day' && o.line) log(o.line);
      save();
    },
    /** A line of the chat ('you' or 'me'), so it can recall what you talked about last time. */
    said(who, text) {
      text = clean(text, 140); if (!text) return;
      m.chat.push({ who, text, day: today() }); if (m.chat.length > MAX_CHAT) m.chat.shift();
      save();
    },
    /** A thing shown once a day (the surprise), so it isn't given twice: true the first time today. */
    once(key) { const d = today(); if (m.seen[key] === d) return false; m.seen[key] = d; save(); return true; },

    /** Everything, for the diary sheet. */
    all() { return JSON.parse(JSON.stringify(m)); },
    /** Calls fn whenever the diary changes. */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** The diary in a few lines for Claude: who they are, what you remember, how games went, last time. '' when empty. */
    summary() {
      const d = today(), v = m.visits, r = m.records, bits = [];
      if (!v.last && !m.name && !m.facts.length) return '';
      if (m.name) bits.push(`Their name is ${m.name}.`);
      if (m.birthday) bits.push(`Their birthday is ${prettyDay(m.birthday)}${this.birthdayToday() ? ' (that is TODAY!)' : ''}.`);
      if (v.first) bits.push(`You first met on ${prettyDate(v.first)}; this is visit day ${v.days}${v.streak > 1 ? `, ${v.streak} days in a row` : ''}.`);
      if (m.facts.length) bits.push(`Things you remember about them: ${m.facts.map(f => f.text).join('; ')}.`);
      const games = [];
      const c = r.chess, cg = c.won + c.lost + c.drawn;
      if (cg) games.push(`chess: they won ${c.won}, you won ${c.lost}${c.drawn ? `, ${c.drawn} drawn` : ''}`);
      if (r.quiz.rounds) games.push(`quiz: ${r.quiz.rounds} round${r.quiz.rounds > 1 ? 's' : ''}, best ${r.quiz.best} out of 10`);
      if (games.length) bits.push(`Games so far: ${games.join('; ')}.`);
      if (m.made.length) bits.push(`Things you have made for them lately: ${[...new Set(m.made.slice(-8).map(x => x.what))].join(', ')}.`);
      // days before today, newest first
      const past = Object.keys(m.days).filter(k => k < d).sort().reverse();
      if (past[0]) bits.push(`Last time (${whenWas(past[0], d)}): ${m.days[past[0]].join(', ')}.`);
      for (const [n, label] of [[7, 'a week ago today'], [30, 'a month ago'], [365, 'a year ago today']]) {
        const k = dayOf(new Date(Date.parse(d + 'T12:00') - n * 864e5));
        if (m.days[k] && k !== past[0]) bits.push(`${label[0].toUpperCase() + label.slice(1)}: ${m.days[k].join(', ')}.`);
      }
      const chat = m.chat.filter(x => x.day < d).slice(-6);
      if (chat.length) bits.push(`The end of your last chat: ${chat.map(x => `${x.who === 'you' ? 'they said' : 'you said'} "${x.text}"`).join(' / ')}.`);
      const todayLines = m.days[d];
      if (todayLines?.length) bits.push(`Earlier today: ${todayLines.join(', ')}.`);
      return `[Your diary, kept on their device, not said aloud: ${bits.join(' ')}]`;
    },
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "03-21" → "21 March". */
export const prettyDay = md => { const [mo, d] = md.split('-').map(Number); return `${d} ${MONTHS[mo - 1]}`; };
const prettyDate = ymd => new Date(ymd + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const whenWas = (k, d) => { const n = daysBetween(k, d); return n === 1 ? 'yesterday' : n < 7 ? `${n} days ago` : prettyDate(k); };

/** A birthday as MM-DD from "03-21", "3/21", "21 March", "March 21st". null when it can't be read. */
export function parseBirthday(s) {
  s = clean(s, 40).toLowerCase(); if (!s) return null;
  let mo = null, d = null, x;
  const mi = MONTHS.findIndex(n => s.includes(n.slice(0, 3).toLowerCase()));
  if (mi >= 0 && (x = /(\d{1,2})/.exec(s))) { mo = mi + 1; d = +x[1]; }
  else if ((x = /^(?:\d{4}-)?(\d{1,2})[-/.](\d{1,2})$/.exec(s))) { mo = +x[1]; d = +x[2]; }
  if (mo > 12 && d <= 12) [mo, d] = [d, mo];   // (21/3, the British way round)
  if (!mo || !d || mo > 12 || d > 31) return null;
  return `${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
