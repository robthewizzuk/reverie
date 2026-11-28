// Reverie's diary: what it knows about you, kept in this browser only (localStorage), never on a server. Who you are
// (your name, birthday, and facts sorted by kind: your people and pets, what you love, what you're into, your
// routines, what's coming up for you, how you've been), how your games went, what it made for you, short recaps of
// what you talked about, the times you tend to visit, and which days you came.
//
// It learns two ways: Claude writes things down with the remember tool as you talk, and every so often the chat so
// far is boiled down (recap.js asks the backend's /api/recap) into a one-line recap plus fact changes, so the raw chat
// never piles up and what Claude reads at the top of each chat (`summary()`, brain.js `memo`) stays small: the most
// useful things first, within a budget, with the rest a `recall` away. The diary sheet (diary.js) shows all of it,
// and lets you edit, add or forget any part, turn the learning off, or wipe it all.
// No three.js and no engine here, so the tests can read it.

const KEY = 'reverie.memory.v1';    // (the same key since v1: an old diary is read and brought up to date)
const MAX_FACTS = 48, MAX_MADE = 24, MAX_CHAT = 60, MAX_DAYS = 45, MAX_DAY_LINES = 8, MAX_TALKS = 24, KEEP_CHAT = 8;
/** How many characters of diary Claude gets at the top of a chat (about 400 tokens): the rest is a recall away. */
export const BUDGET = 1600;

/** The kinds of fact, in the order they matter for knowing someone, with how the summary and the sheet name them. */
export const KINDS = {
  about: { sheet: 'About you', say: 'About them' },
  people: { sheet: 'Your people and pets', say: 'People and pets' },
  plan: { sheet: 'Coming up', say: 'Coming up' },
  likes: { sheet: 'Things you love', say: 'Likes' },
  interests: { sheet: "What you're into", say: 'Interests' },
  routine: { sheet: 'Your routines', say: 'Routines' },
  feeling: { sheet: "How you've been", say: 'Lately' },
  dislikes: { sheet: 'Not your thing', say: 'Dislikes' },
};
const KIND_NAMES = Object.keys(KINDS);

/** A date as YYYY-MM-DD in the person's own time zone. */
export const dayOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Whole days from one YYYY-MM-DD to another. */
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00') - Date.parse(a + 'T12:00')) / 864e5);
const addDays = (ymd, n) => dayOf(new Date(Date.parse(ymd + 'T12:00') + n * 864e5));
const clean = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const words = s => clean(s, 400).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
const STOP = new Set(['the', 'and', 'that', 'this', 'about', 'with', 'they', 'them', 'their', 'are', 'was', 'for', 'have', 'has', 'you', 'your', 'like', 'likes', 'loves', 'love', 'what', 'did', 'does', 'who', 'when', 'remember', 'tell', 'know', 'any', 'anything', 'something']);
// Tiny synonym groups so recall("dog") finds "puppy", recall("mum") finds "mother", recall("bday") finds "birthday", etc.
const SYN_GROUPS = [
  ['dog', 'puppy', 'pup', 'hound', 'doggo'],
  ['cat', 'kitten', 'kitty'],
  ['mum', 'mom', 'mother', 'mama'],
  ['dad', 'father', 'papa'],
  ['gran', 'nan', 'grandma', 'grandmother', 'granny'],
  ['grandad', 'grandpa', 'grandfather'],
  ['birthday', 'bday'],
  ['film', 'movie', 'cinema'],
  ['game', 'games', 'gaming'],
  ['music', 'song', 'songs', 'tune', 'tunes', 'band'],
  ['work', 'job', 'office'],
  ['school', 'class', 'uni', 'university', 'college'],
  ['holiday', 'vacation', 'trip'],
  ['bike', 'bicycle', 'cycling'],
];
const SYN_MAP = new Map();
for (const g of SYN_GROUPS) for (const w of g) SYN_MAP.set(w, g);

const oneEdit = (a, b) => {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; }
    else {
      if (++diff > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
};

// a word matches another loosely: exact, same 5-letter stem, synonym group, or 1-char typo (for 5+ letter words)
const match = (a, b) => a === b
  || (a.length > 4 && b.length > 4 && (a.slice(0, 5) === b.slice(0, 5) || oneEdit(a, b)))
  || (SYN_MAP.has(a) && SYN_MAP.get(a).includes(b));
const overlap = (a, b) => a.filter(x => b.some(y => match(x, y))).length;

/** The kind a fact most likely is, from its words, when Claude didn't say. */
export function guessKind(text) {
  const t = ' ' + clean(text, 200).toLowerCase() + ' ';
  if (/\b(every (day|morning|evening|night|week|mon|tue|wed|thu|fri|sat|sun)\w*|usually|always|each (day|morning|week)|on (mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|weekends)|before bed|after school|after work)\b/.test(t)) return 'routine';
  if (/\b(tomorrow|tonight|next (week|month|year|mon|tue|wed|thu|fri|sat|sun)\w*|on (mon|tue|wed|thu|fri|sat|sun)\w*|this (weekend|week)|going to|is getting|has an? (\w+ )?(test|exam|interview|appointment|match|party|trip|holiday)|planning|plans? to|in \d+ days)\b/.test(t)) return 'plan';
  if (/\b(hates?|dislikes?|can'?t stand|doesn'?t like|does not like|not a fan|afraid of|scared of|allergic)\b/.test(t)) return 'dislikes';
  if (/\b(feels?|felt|feeling|worried|nervous|sad|stressed|excited about|tired|lonely|happy about|upset|poorly|ill)\b/.test(t)) return 'feeling';
  if (/\b(dog|cat|puppy|kitten|hamster|rabbit|bunny|fish|parrot|pony|horse|pet|mum|mom|dad|mother|father|sister|brother|son|daughter|wife|husband|partner|girlfriend|boyfriend|friend|grandma|grandpa|gran|nan|grandad|granny|aunt|uncle|cousin|baby|kids?|children|family)\b/.test(t)) return 'people';
  if (/\b(loves?|likes?|adores?|favou?rite|enjoys?|fan of|into|obsessed)\b/.test(t)) return /\b(favou?rite (food|colou?r|animal|drink|snack|song|film|movie|book))\b/.test(t) || !/\b(playing|learning|collects?|plays|reads|builds|making)\b/.test(t) ? 'likes' : 'interests';
  if (/\b(learning|plays|playing|collects?|reads|builds|practis|practic|hobby|studies|studying|codes|draws|paints|knits|bakes|gardens|runs|swims|supports)\b/.test(t)) return 'interests';
  return 'about';
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/**
 * When a plan happens, as YYYY-MM-DD, from "2026-12-03", "tomorrow", "friday", "next tuesday", "this weekend",
 * "next week", "in 3 days" or "3 December" (the next one), counted from `today`. null when it can't be read.
 */
export function parseWhen(s, today) {
  s = clean(s, 60).toLowerCase().replace(/^on /, ''); if (!s) return null;
  let x;
  if ((x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return s;
  if (s === 'today' || s === 'tonight') return today;
  if (s === 'tomorrow') return addDays(today, 1);
  if (s === 'yesterday') return addDays(today, -1);
  if ((x = /^in (\d{1,3}) days?$/.exec(s))) return addDays(today, +x[1]);
  if (/^next week$/.test(s)) return addDays(today, 7);
  if (/^(this |the )?weekend$/.test(s) || s === 'next weekend') { const wd = new Date(today + 'T12:00').getDay(); return addDays(today, (wd === 0 ? 0 : 6 - wd) + (s === 'next weekend' ? 7 : 0)); }
  if ((x = /^(this |next )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.exec(s))) {
    const want = WEEKDAYS.indexOf(x[2]), wd = new Date(today + 'T12:00').getDay();
    const n = (want - wd + 7) % 7;
    return addDays(today, n === 0 && x[1] === 'next ' ? 7 : n);
  }
  const md = parseBirthday(s);
  if (md) { const y = +today.slice(0, 4), d = `${y}-${md}`; return d < addDays(today, -60) ? `${y + 1}-${md}` : d; }
  return null;
}

const blankHabits = () => ({ parts: { morning: 0, afternoon: 0, evening: 0, night: 0 }, week: [0, 0, 0, 0, 0, 0, 0], games: {}, slot: '' });
const blank = () => ({
  v: 2, name: null, birthday: null, facts: [], learn: true,
  visits: { first: null, last: null, days: 0, streak: 0, best: 0, count: 0 },
  records: { chess: { won: 0, lost: 0, drawn: 0, last: null, run: 0 }, quiz: { rounds: 0, best: 0, right: 0, asked: 0 }, games: {}, focus: { sessions: 0, minutes: 0 }, made: 0, rolls: 0, doodles: 0 },
  made: [], days: {}, chat: [], talks: [], recapAt: 0, habits: blankHabits(), seen: {},
});
const partOf = h => h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'night';

/** Makes the diary, read from `store` (localStorage by default; tests pass their own { getItem, setItem, removeItem }). */
export function makeMemory({ store = globalThis.localStorage, clock = () => new Date() } = {}) {
  let m = load();
  const listeners = new Set();
  let ids = 0;
  const newId = () => `f${clock().getTime().toString(36)}${(ids++).toString(36)}`;

  function load() {
    try {
      const o = JSON.parse(store?.getItem(KEY) || 'null');
      if (!o || typeof o !== 'object' || (o.v !== 1 && o.v !== 2)) return blank();
      const b = blank(), arr = x => Array.isArray(x) ? x : [], obj = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
      const h = obj(o.habits);
      return { ...b, ...o, v: 2, learn: o.learn !== false,
        visits: { ...b.visits, ...obj(o.visits) },
        records: { ...b.records, ...obj(o.records), chess: { ...b.records.chess, ...obj(o.records?.chess) }, quiz: { ...b.records.quiz, ...obj(o.records?.quiz) }, games: obj(o.records?.games), focus: { ...b.records.focus, ...obj(o.records?.focus) } },
        // (a v1 fact has no kind: it gets the one its words suggest)
        facts: arr(o.facts).filter(f => f && typeof f.text === 'string').map(f => ({ ...f, kind: KINDS[f.kind] ? f.kind : guessKind(f.text) })),
        made: arr(o.made), talks: arr(o.talks).filter(t => t && typeof t.text === 'string'),
        // (v1 chat lines have no time: they count as not yet recapped)
        chat: arr(o.chat).filter(x => x && typeof x.text === 'string').map(x => ({ ...x, t: x.t || 1 })), recapAt: +o.recapAt || 0,
        habits: { ...blankHabits(), ...h, parts: { ...blankHabits().parts, ...obj(h.parts) }, week: arr(h.week).length === 7 ? h.week : blankHabits().week, games: obj(h.games) },
        days: obj(o.days), seen: obj(o.seen) };
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
  /** The fact most like `text` (most of its words the same), as an index, or -1. */
  function sameAs(text) {
    const w = words(text); if (!w.length) return -1;
    let best = -1, score = 0;
    m.facts.forEach((f, i) => {
      const fw = words(f.text); if (!fw.length) return;
      const s = overlap(fw, w) / Math.max(fw.length, w.length);
      if (s > score && s >= .7) { best = i; score = s; }
    });
    return best;
  }
  /** Writes a fact (a new one, or over the one it repeats). Returns the fact. */
  function put({ text, kind, when }) {
    text = clean(text, 160).replace(/^(that )?(they|he|she|the user|user) /i, ''); if (!text) return null;
    kind = KINDS[kind] ? kind : guessKind(text);
    const w = when ? parseWhen(when, today()) : kind === 'plan' ? parseWhen((/\b(today|tonight|tomorrow|(?:this |next )?(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*day|this weekend|next week|in \d+ days?)\b/i.exec(text) || [])[0], today()) : null;
    const i = sameAs(text), old = i >= 0 ? m.facts.splice(i, 1)[0] : null;
    const f = { id: old?.id || newId(), text, kind, day: old?.day || today(), said: today(), ...(w ? { when: w } : old?.when && kind === 'plan' ? { when: old.when } : {}) };
    m.facts.push(f);
    // over the limit: the oldest plan that's long past goes first, then the fact not heard of for longest
    while (m.facts.length > MAX_FACTS) {
      const past = m.facts.findIndex(x => x.kind === 'plan' && x.when && x.when < addDays(today(), -14));
      if (past >= 0) { m.facts.splice(past, 1); continue; }
      let o = 0; m.facts.forEach((x, j) => { if ((x.said || x.day) < (m.facts[o].said || m.facts[o].day)) o = j; }); m.facts.splice(o, 1);
    }
    return f;
  }
  const whenSaid = (when, d = today()) => { const n = daysBetween(d, when); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 1 && n < 7 ? `on ${weekday(when)}` : n < 0 && n > -7 ? `last ${weekday(when)}` : prettyDate(when); };

  const api = {
    /** What this visit is, without counting it: { first, newDay, away (days since the last visit), streak }. */
    peek() {
      const d = today(), last = m.visits.last;
      const away = last ? daysBetween(last, d) : null;
      return { first: !last, newDay: last !== d, away, streak: away === 1 ? m.visits.streak + 1 : away === 0 ? m.visits.streak : 1, name: m.name };
    },
    /** Counts this visit (once a day as a day, every time as a visit). Returns what peek() said before. */
    visit() {
      const p = this.peek(), d = today(), v = m.visits, now = clock();
      v.count++;
      if (p.newDay) { v.days++; v.streak = p.streak; v.best = Math.max(v.best, v.streak); v.first ||= d; }
      v.last = d;
      // when they tend to come: each part of a day counts once
      const part = partOf(now.getHours()), slot = `${d}:${part}`, h = m.habits;
      if (h.slot !== slot) { h.slot = slot; h.parts[part]++; if (p.newDay) h.week[now.getDay()]++; }
      save();
      return p;
    },

    get name() { return m.name; },
    get birthday() { return m.birthday; },
    get visits() { return { ...m.visits }; },
    get records() { return JSON.parse(JSON.stringify(m.records)); },
    /** Learning from the chat (keeping its lines, recapping them) is on: the diary sheet can turn it off. */
    get learn() { return m.learn; },
    set learn(on) { m.learn = !!on; if (!on) { m.chat = []; m.recapAt = clock().getTime(); } save(); },
    /** Is it their birthday today? */
    birthdayToday() { return !!m.birthday && today().slice(5) === m.birthday; },

    /** The remember tool: { fact, kind, when, name, birthday } (any of them). Resolves a sentence for Claude. */
    remember(input = {}) {
      const said = [];
      const name = clean(input.name, 40).replace(/[^\p{L}\p{M}' -]/gu, '').trim();
      if (name) { m.name = name; said.push(`their name is ${name}`); }
      const bd = parseBirthday(input.birthday);
      if (input.birthday && !bd) return { text: `Not kept: "${input.birthday}" is not a date I can read. Use MM-DD, like 03-21.`, error: true };
      if (bd) { m.birthday = bd; said.push(`their birthday is ${prettyDay(bd)}`); }
      if (clean(input.fact)) {
        const f = put({ text: input.fact, kind: input.kind, when: input.when });
        if (f) said.push(`"${f.text}"${f.when ? ` (${whenSaid(f.when)})` : ''}`);
      }
      if (!said.length) return { text: 'Nothing kept: give a fact, a name or a birthday.', error: true };
      log(`learned: ${said.join(', ')}`.replace(/"/g, ''));
      save();
      return `Written in your diary: ${said.join(', ')}. It stays in this browser, and you will remember it next time.`;
    },

    /** The recall tool: { about } looks through everything for a topic, a person, or a time ("last week"). */
    recall(input = {}) {
      const about = clean(input.about, 120).toLowerCase(), d = today(), out = [];
      if (!about || /^(everything|all|me|myself|what you (know|remember))\b/.test(about)) return this.summary({ budget: 3000, all: true }) || 'The diary is empty: you are only just getting to know them.';
      // a time: the days and recaps from then
      let from = null, to = d;
      if (/\byesterday\b/.test(about)) from = to = addDays(d, -1);
      else if (/\blast time\b/.test(about)) { const past = Object.keys(m.days).filter(k => k < d).sort(); from = to = past.at(-1) || null; }
      else if (/\b(last|this|past) week\b/.test(about)) from = addDays(d, -7);
      else if (/\b(last|this|past) month\b/.test(about)) from = addDays(d, -31);
      else if (/\b(first (met|time|day)|when we met)\b/.test(about)) from = to = m.visits.first;
      if (from) {
        for (const t of m.talks) if (t.day >= from && t.day <= to) out.push(`${whenWas(t.day, d)}: ${t.text}`);
        for (const k of Object.keys(m.days).sort()) if (k >= from && k <= to && k !== d) out.push(`${whenWas(k, d)}: ${m.days[k].join(', ')}`);
        return out.length ? `From your diary: ${out.slice(-10).join(' / ')}.` : `Nothing in the diary from ${about.replace(/^what (did we do|happened) /, '')}.`;
      }
      const w = words(about); if (!w.length) return { text: 'Say what to look up, in a few words.', error: true };
      const hits = [];
      const recency = day => {
        if (!day) return 0;
        const age = daysBetween(day, d);
        return age >= 0 && age <= 14 ? .35 * (1 - age / 15) : 0;
      };
      const add = (text, day, extra = 0) => { const n = overlap(words(text), w); if (n) hits.push({ text: day ? `${text} (${whenWas(day, d)})` : text, n: n + extra + recency(day), day: day || '' }); };
      for (const f of m.facts) add(f.text + (f.when ? `, ${whenSaid(f.when, d)}` : ''), f.said || f.day || null, 1);
      for (const t of m.talks) add(t.text, t.day);
      for (const k of Object.keys(m.days)) for (const l of m.days[k]) add(l, k);
      for (const x of m.made) add(`you made them ${x.what}`, x.day);
      for (const x of m.chat) add(`${x.who === 'you' ? 'they said' : 'you said'} "${x.text}"`, x.day);
      if (/\bchess\b/.test(about)) { const c = m.records.chess; hits.push({ text: chessLine(c), n: 9, day: '' }); }
      if (/\b(quiz|trivia)\b/.test(about) && m.records.quiz.rounds) hits.push({ text: `quiz: ${m.records.quiz.rounds} rounds, best ${m.records.quiz.best} out of 10`, n: 9, day: '' });
      if (/\b(focus|pomodoro|sprint)\b/.test(about) && m.records.focus?.sessions) hits.push({ text: `focus sessions: ${m.records.focus.sessions} (${m.records.focus.minutes} min total)`, n: 9, day: '' });
      for (const [g, s] of Object.entries(m.records.games || {})) {
        if (about.includes(g.replace(/_/g, ' ')) || about.includes(g)) hits.push({ text: `${g.replace(/_/g, ' ')}: they won ${s.won}, you won ${s.lost}${s.drawn ? `, ${s.drawn} drawn` : ''}`, n: 9, day: '' });
      }
      if (!hits.length) return `Nothing in the diary about "${input.about}". If it matters, ask them, and remember the answer.`;
      hits.sort((a, b) => b.n - a.n || (b.day > a.day ? 1 : -1));
      return `From your diary: ${[...new Set(hits.slice(0, 8).map(x => x.text))].join(' / ')}.`;
    },

    /** The forget tool: { what } names a fact, "my name", "my birthday", "the chats", or "everything". */
    forget(input = {}) {
      const what = clean(input.what, 160).toLowerCase();
      if (!what) return { text: 'Nothing forgotten: say what to forget.', error: true };
      if (/^(everything|all|it all|all of it|everything about me|the whole diary|your whole diary)$/.test(what)) { this.wipe(); return 'Forgot everything in the diary: their name, the facts, the records, the chats and the days. It starts fresh.'; }
      const gone = [];
      if (/\bname\b/.test(what) && m.name) { gone.push(`their name (${m.name})`); m.name = null; }
      if (/\bbirthday\b/.test(what) && m.birthday) { gone.push('their birthday'); m.birthday = null; }
      if (/\b(chats?|conversations?|what we (said|talked about)|talks?)\b/.test(what) && (m.chat.length || m.talks.length)) { gone.push('what you talked about'); m.chat = []; m.talks = []; m.recapAt = clock().getTime(); }
      if (/\b(records?|scores?)\b/.test(what)) { gone.push('the game records'); m.records = blank().records; }
      if (/\b(habits|when i (come|visit))\b/.test(what)) { gone.push('when they tend to visit'); m.habits = blankHabits(); }
      if (!gone.length) {
        const w = words(what);
        const hit = m.facts.map((f, i) => [i, overlap(words(f.text), w)]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
        // (a recap about it goes too: "forget the dog" should leave nothing about the dog)
        const talks = m.talks.filter(t => overlap(words(t.text), w) >= Math.min(2, w.length));
        if (!hit.length && !talks.length) return { text: `Nothing in the diary matches "${input.what}". It holds: ${m.facts.map(f => f.text).join('; ') || 'no facts'}.`, error: true };
        if (hit.length) { const best = hit[0][1], all = hit.filter(([, n]) => n === best).map(([i]) => i).sort((a, b) => b - a); for (const i of all) { gone.push(`"${m.facts[i].text}"`); m.facts.splice(i, 1); } }
        if (talks.length) { gone.push(`${talks.length} recap${talks.length > 1 ? 's' : ''} mentioning it`); m.talks = m.talks.filter(t => !talks.includes(t)); }
        m.chat = m.chat.filter(x => !overlap(words(x.text), w));
      }
      save();
      return `Forgot ${gone.join(', ')}. It is gone from the diary.`;
    },
    /** One fact taken out by its id (the diary sheet's ✕). */
    drop(id) { const n = m.facts.length; m.facts = m.facts.filter(f => f.id !== id); if (m.facts.length !== n) save(); },
    /** One recap taken out (the diary sheet's ✕), by its index. */
    dropTalk(i) { if (m.talks[i]) { m.talks.splice(i, 1); save(); } },
    /** The diary sheet's edit: a fact's new words (and kind, and when), or 'name' / 'birthday'. Empty words forget it. */
    edit(id, text, o = {}) {
      text = clean(text, 160);
      if (id === 'name') { m.name = clean(text, 40).replace(/[^\p{L}\p{M}' -]/gu, '').trim() || null; save(); return true; }
      if (id === 'birthday') { const bd = parseBirthday(text); if (text && !bd) return false; m.birthday = bd; save(); return true; }
      const f = m.facts.find(x => x.id === id); if (!f) return false;
      if (!text) { this.drop(id); return true; }
      f.text = text; f.said = today();
      if (KINDS[o.kind]) f.kind = o.kind;
      if (o.when !== undefined) { const w = o.when ? parseWhen(o.when, today()) : null; if (w) f.when = w; else delete f.when; }
      save(); return true;
    },
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
        const c = r.chess, res = ['won', 'lost'].includes(o.result) ? o.result : 'drawn';
        c[res]++; c.last = { result: res, level: o.level | 0 || null, day: today() };
        // run: games in a row they won (above 0) or Reverie won (below 0)
        c.run = res === 'won' ? Math.max(0, c.run) + 1 : res === 'lost' ? Math.min(0, c.run) - 1 : 0;
        log(res === 'won' ? 'they beat Reverie at chess' : res === 'lost' ? 'Reverie won at chess' : 'a draw at chess');
      } else if (kind === 'quiz') {
        r.quiz.rounds++; r.quiz.right += o.score | 0; r.quiz.asked += o.of | 0; r.quiz.best = Math.max(r.quiz.best, o.score | 0);
        log(`scored ${o.score} out of ${o.of} in the quiz`);
      } else if (kind === 'game_result' && o.game) {
        const g = clean(o.game, 30).toLowerCase(), res = ['won', 'lost'].includes(o.result) ? o.result : 'drawn';
        r.games ||= {};
        const rec = r.games[g] ||= { won: 0, lost: 0, drawn: 0, run: 0 };
        rec[res]++;
        rec.run = res === 'won' ? Math.max(0, rec.run) + 1 : res === 'lost' ? Math.min(0, rec.run) - 1 : 0;
        const label = g.replace(/_/g, ' ');
        log(res === 'won' ? `they won at ${label}` : res === 'lost' ? `Reverie won at ${label}` : `a draw at ${label}`);
      } else if (kind === 'focus') {
        r.focus ||= { sessions: 0, minutes: 0 };
        const mins = Math.max(1, Math.round(+o.minutes || 25));
        r.focus.sessions++; r.focus.minutes += mins;
        log(`finished a ${mins}-minute focus sprint`);
      } else if (kind === 'play' && o.game) { const g = clean(o.game, 30); m.habits.games[g] = (m.habits.games[g] || 0) + 1; }
      else if (kind === 'roll') r.rolls++;
      else if (kind === 'doodle' && o.what) { r.doodles++; log(`drew ${clean(o.what, 40)}`); }
      else if (kind === 'day' && o.line) log(o.line);
      else if (kind === 'watched' && o.what) log(`watched "${clean(o.what, 70)}" together`);
      save();
    },
    /** A line of the chat ('you' or 'me'), kept until it is recapped (only while learning is on). again: it replaces their last line. */
    said(who, text, again = false) {
      text = clean(text, 200); if (!text || !m.learn) return;
      // (again: the rest of what they were saying, in place of the part said a moment ago)
      if (again && m.chat.at(-1)?.who === who) m.chat.pop();
      m.chat.push({ who, text, day: today(), t: Math.max(clock().getTime(), m.recapAt + 1) });
      if (m.chat.length > MAX_CHAT) m.chat.shift();
      save();
    },
    /** The chat not yet recapped: { lines, upTo (time of the last), theirs (how many lines are theirs) }. */
    pending() {
      const lines = m.chat.filter(x => x.t > m.recapAt);
      return { lines: lines.map(({ who, text, day }) => ({ who, text, day })), upTo: lines.length ? Math.max(...lines.map(x => x.t || 0), m.recapAt + 1) : m.recapAt, theirs: lines.filter(x => x.who === 'you').length };
    },
    /** What the recapper (recap.js) sends with the chat: what the diary already knows, with ids to change. */
    forRecap() {
      return { today: today(), name: m.name, facts: m.facts.map(({ id, kind, text, when }) => ({ id, kind, text, ...(when ? { when } : {}) })), talks: m.talks.slice(-2).map(t => t.text) };
    },
    /**
     * A recap of the chat up to `upTo` (from /api/recap): { recap, add: [{ kind, text, when }], update: [{ id, text,
     * kind, when }], drop: [id], name }. Everything is checked: unknown ids and kinds are skipped, words are trimmed.
     * Returns what changed, as a short line for the log.
     */
    applyRecap(r = {}, upTo = clock().getTime()) {
      if (!m.learn) return 'learning is off';
      const done = [], arr = x => Array.isArray(x) ? x.slice(0, 12) : [];
      const recap = clean(r.recap, 240);
      // (a recap is of the day the lines were said: the first line's day)
      const day = m.chat.find(x => x.t > m.recapAt)?.day || today();
      if (recap) { const last = m.talks.at(-1); if (last && last.day === day && last.text.length + recap.length < 320) last.text = clean(last.text.replace(/\.?$/, '. ') + recap, 320); else m.talks.push({ day, text: recap }); done.push('a recap'); }
      while (m.talks.length > MAX_TALKS) m.talks.shift();
      for (const id of arr(r.drop)) { const i = m.facts.findIndex(f => f.id === id); if (i >= 0) { m.facts.splice(i, 1); done.push('-1 fact'); } }
      for (const u of arr(r.update)) {
        const f = u && m.facts.find(x => x.id === u.id), text = clean(u?.text, 160); if (!f || !text) continue;
        f.text = text; f.said = today(); if (KINDS[u.kind]) f.kind = u.kind;
        if (u.when) { const w = parseWhen(u.when, today()); if (w) f.when = w; }
        done.push('~1 fact');
      }
      for (const a of arr(r.add)) if (a && clean(a.text)) { put({ text: a.text, kind: a.kind, when: a.when }); done.push('+1 fact'); }
      const name = clean(r.name, 40).replace(/[^\p{L}\p{M}' -]/gu, '').trim();
      if (name && !m.name) { m.name = name; done.push('a name'); }
      m.recapAt = Math.max(m.recapAt, upTo);
      // recapped lines aren't needed: only the last few stay, for the sheet's "what we said lately"
      m.chat = m.chat.filter(x => x.t > m.recapAt).concat(m.chat.filter(x => x.t <= m.recapAt).slice(-KEEP_CHAT)).sort((a, b) => a.t - b.t);
      save();
      return done.join(', ') || 'nothing new';
    },
    /** A thing shown once a day (the surprise), so it isn't given twice: true the first time today. */
    once(key) { const d = today(); if (m.seen[key] === d) return false; m.seen[key] = d; save(); return true; },

    /** Plans to ask about: due from 3 days ago to 2 days ahead, soonest first: [{ text, when, said ("yesterday") }]. */
    followUps() {
      const d = today();
      return m.facts.filter(f => f.kind === 'plan' && f.when && daysBetween(d, f.when) >= -3 && daysBetween(d, f.when) <= 2)
        .sort((a, b) => a.when < b.when ? -1 : 1).map(f => ({ text: f.text, when: f.when, said: whenSaid(f.when, d), past: f.when < d }));
    },
    /** When they tend to come, and what they play most, in words ('' when it isn't clear yet). */
    habitLine() {
      const h = m.habits, total = Object.values(h.parts).reduce((a, b) => a + b, 0), bits = [];
      if (total >= 4) { const [part, n] = Object.entries(h.parts).sort((a, b) => b[1] - a[1])[0]; if (n / total >= .5) bits.push(`they usually come ${part === 'night' ? 'late at night' : 'in the ' + part}`); }
      const days = h.week.reduce((a, b) => a + b, 0);
      if (days >= 5) { const wk = h.week[0] + h.week[6]; if (wk / days >= .6) bits.push('mostly at weekends'); else if (wk / days <= .1) bits.push('mostly on weekdays'); }
      const games = Object.entries(h.games).sort((a, b) => b[1] - a[1]);
      if (games[0]?.[1] >= 3) bits.push(`their favourite game is ${games[0][0].replace(/_/g, ' ')} (${games[0][1]} games)`);
      return bits.join(', ');
    },

    /** Everything, for the diary sheet. */
    all() { return JSON.parse(JSON.stringify(m)); },
    /** Calls fn whenever the diary changes. */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /**
     * The diary for Claude, most useful first, within `budget` characters: who they are, what to ask about, what they
     * love, their people, how games went, recaps of past chats, last time. '' when empty. o.all: everything (recall).
     */
    summary({ budget = BUDGET, all = false } = {}) {
      const d = today(), v = m.visits, r = m.records;
      if (!v.last && !m.name && !m.facts.length) return '';
      const bits = [], cut = [];
      const add = (s, must = false) => { if (!s) return; const used = bits.join(' ').length; if (must || all || used + s.length + 1 <= budget) bits.push(s); else cut.push(s); };
      // who they are
      add([m.name && `Their name is ${m.name}.`, m.birthday && `Their birthday is ${prettyDay(m.birthday)}${this.birthdayToday() ? ' (that is TODAY!)' : ''}.`,
        v.first && `You first met on ${prettyDate(v.first)}; this is visit day ${v.days}${v.streak > 1 ? `, ${v.streak} days in a row` : ''}.`].filter(Boolean).join(' '), true);
      if (!m.name) add("You don't know their name yet.", true);
      // what to ask about: plans that were due or are coming
      const fu = this.followUps();
      if (fu.length) add(`To ask about: ${fu.map(f => `${f.text} (${f.said}${f.past ? ': ask how it went' : ''})`).join('; ')}.`, true);
      // facts by kind, the freshest first in each (a plan long past is left out: the recaps have it)
      const fresh = (a, b) => ((b.said || b.day) > (a.said || a.day) ? 1 : -1);
      for (const k of KIND_NAMES) {
        let list = m.facts.filter(f => f.kind === k).sort(fresh);
        if (k === 'plan') list = list.filter(f => !fu.some(x => x.text === f.text) && (!f.when || f.when >= d));
        if (!list.length) continue;
        // (each kind gets its first few in the budget; the rest are a recall away)
        const head = all ? list : list.slice(0, k === 'about' || k === 'people' ? 6 : 4);
        add(`${KINDS[k].say}: ${head.map(f => f.text + (f.when ? ` (${whenSaid(f.when, d)})` : '')).join('; ')}.`);
        if (head.length < list.length) cut.push(k);
      }
      const habits = this.habitLine(); if (habits) add(`Habits: ${habits}.`);
      const games = [];
      const c = r.chess, cg = c.won + c.lost + c.drawn;
      if (cg) games.push(chessLine(c, d));
      if (r.quiz.rounds) games.push(`quiz: ${r.quiz.rounds} round${r.quiz.rounds > 1 ? 's' : ''}, best ${r.quiz.best} out of 10`);
      for (const [g, s] of Object.entries(r.games || {})) {
        const n = (s.won | 0) + (s.lost | 0) + (s.drawn | 0); if (!n) continue;
        games.push(`${g.replace(/_/g, ' ')}: they won ${s.won | 0}, you won ${s.lost | 0}${s.drawn ? `, ${s.drawn} drawn` : ''}`);
      }
      if (games.length) add(`Games so far: ${games.join('; ')}.`);
      if (r.focus?.sessions) add(`Focus sprints: ${r.focus.sessions} completed (${r.focus.minutes} min total).`);
      if (m.made.length) add(`Things you have made for them lately: ${[...new Set(m.made.slice(all ? -24 : -5).map(x => x.what))].join(', ')}.`);
      // past chats, as recaps (newest first)
      const talks = m.talks.slice(all ? -12 : -3).reverse();
      if (talks.length) add(`What you talked about: ${talks.map(t => `${whenWas(t.day, d)}, ${t.text.replace(/\.$/, '')}`).join('. ')}.`);
      // days before today, newest first
      const past = Object.keys(m.days).filter(k => k < d).sort().reverse();
      // (what it learned that day is in the facts already)
      const page = k => (m.days[k] || []).filter(l => !l.startsWith('learned: ')).join(', ');
      if (past[0] && page(past[0])) add(`Last time (${whenWas(past[0], d)}): ${page(past[0])}.`);
      for (const [n, label] of [[7, 'a week ago today'], [30, 'a month ago'], [365, 'a year ago today']]) {
        const k = addDays(d, -n);
        if (k !== past[0] && page(k)) add(`${label[0].toUpperCase() + label.slice(1)}: ${page(k)}.`);
      }
      // chat not yet recapped, from before today
      const chat = m.chat.filter(x => x.t > m.recapAt).slice(-4);
      if (chat.length) add(`The end of your last chat: ${chat.map(x => `${x.who === 'you' ? 'they said' : 'you said'} "${x.text}"`).join(' / ')}.`);
      if (page(d)) add(`Earlier today: ${page(d)}.`);
      const more = cut.length && !all ? ' There is more in your diary: use recall to look something up when it comes up.' : ' Use recall to look up anything older.';
      return `[Your diary, kept on their device, not said aloud: ${bits.join(' ')}${more}]`;
    },
    /** Re-reads the diary from storage (e.g. after importing a backup). */
    reload() { m = load(); for (const f of listeners) try { f(); } catch {} },
  };
  return api;
}

/**
 * Exports all Reverie state stored in localStorage (`reverie.*` keys) as a portable JSON backup object.
 * Works with browser localStorage or a custom Map-like store in Node tests.
 */
export function exportBackup(store = globalThis.localStorage) {
  const data = {};
  if (store) {
    const keys = typeof store.length === 'number' && typeof store.key === 'function'
      ? Array.from({ length: store.length }, (_, i) => store.key(i))
      : Object.keys(store);
    for (const k of keys) {
      if (typeof k === 'string' && k.startsWith('reverie.')) {
        const v = store.getItem(k);
        if (v != null) data[k] = v;
      }
    }
  }
  return { app: 'reverie', v: 1, exportedAt: new Date().toISOString(), keys: data };
}

/**
 * Restores a JSON backup produced by exportBackup() into `store`.
 * Only writes keys starting with `reverie.` whose values are strings. Returns { ok, restored, error? }.
 */
export function importBackup(raw, store = globalThis.localStorage) {
  let obj;
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return { ok: false, restored: 0, error: 'Invalid JSON file.' }; }
  if (!obj || obj.app !== 'reverie' || !obj.keys || typeof obj.keys !== 'object') {
    return { ok: false, restored: 0, error: 'Not a Reverie backup file.' };
  }
  let restored = 0;
  for (const [k, v] of Object.entries(obj.keys)) {
    if (!k.startsWith('reverie.') || typeof v !== 'string') continue;
    try { store?.setItem(k, v); restored++; } catch { /* quota */ }
  }
  return { ok: true, restored };
}

const chessLine = (c, d) => {
  const n = c.won + c.lost + c.drawn; if (!n) return 'no chess games yet';
  let s = `chess: they won ${c.won}, you won ${c.lost}${c.drawn ? `, ${c.drawn} drawn` : ''}`;
  if (c.last) s += `; last game ${c.last.result === 'won' ? 'they won' : c.last.result === 'lost' ? 'you won' : 'a draw'}${c.last.level ? ` at level ${c.last.level}` : ''}${d && c.last.day ? ` (${whenWas(c.last.day, d)})` : ''}`;
  if (c.run >= 2) s += `, and they have beaten you ${c.run} in a row`; else if (c.run <= -2) s += `, and you have won ${-c.run} in a row`;
  return s;
};

/** "03-21" → "21 March". */
export const prettyDay = md => { const [mo, d] = md.split('-').map(Number); return `${d} ${MONTHS[mo - 1]}`; };
const prettyDate = ymd => new Date(ymd + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const weekday = ymd => new Date(ymd + 'T12:00').toLocaleDateString('en-GB', { weekday: 'long' });
const whenWas = (k, d) => { const n = daysBetween(k, d); return n === 0 ? 'today' : n === 1 ? 'yesterday' : n < 7 ? `${n} days ago` : prettyDate(k); };

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
