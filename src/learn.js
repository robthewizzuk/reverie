// What you are learning together, kept in this browser only (localStorage), never on a server: each subject you have
// had a lesson in (a topic such as "volcanoes", or a language), how many lessons, the points you have covered, how the
// quizzes went, what to do next time, and for a language the words you have met, each in a little review box (a word
// you get right moves up a box and comes back less often; a miss sends it back to box 1, so it comes round tomorrow).
// Claude reads a short line of it with the diary at the top of each chat, and the diary sheet shows it all.
// No three.js and no engine here, so the tests can read it.
import { dayOf, daysBetween } from './memory.js';

const KEY = 'reverie.learn.v1';
const MAX_SUBJECTS = 16, MAX_POINTS = 30, MAX_WORDS = 200;
/** Days until a word in box b comes round again (box 1: tomorrow ... box 5: a month). */
export const GAP = [0, 1, 2, 4, 9, 21, 45];
const clean = (s, n = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** The key a subject is kept under: "Spanish", "spanish " and "SPANISH" are one subject. */
export const keyOf = s => clean(s, 60).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

const blank = () => ({ v: 1, subjects: {} });

/** Makes the learning book, read from `store` (localStorage by default; tests pass their own). */
export function makeLearning({ store = globalThis.localStorage, clock = () => new Date() } = {}) {
  let m = load();
  const listeners = new Set();
  const today = () => dayOf(clock());

  function load() {
    try { const o = JSON.parse(store?.getItem(KEY) || 'null'); return o && o.v === 1 && o.subjects && typeof o.subjects === 'object' ? o : blank(); } catch { return blank(); }
  }
  function save() {
    // (the subjects not studied for longest drop off past MAX_SUBJECTS)
    const all = Object.entries(m.subjects).sort((a, b) => (b[1].last || '').localeCompare(a[1].last || ''));
    for (const [k] of all.slice(MAX_SUBJECTS)) delete m.subjects[k];
    try { store?.setItem(KEY, JSON.stringify(m)); } catch { /* a private window, or full */ }
    for (const f of listeners) try { f(); } catch { /* a listener's problem */ }
  }
  const due = (w, d = today()) => !w.seen || daysBetween(w.seen, d) >= GAP[w.box];

  const api = {
    /** A subject by its name, or null. */
    get(name) { const s = m.subjects[keyOf(name)]; return s ? JSON.parse(JSON.stringify(s)) : null; },
    /** Every subject, most recent first. */
    list() { return Object.values(JSON.parse(JSON.stringify(m.subjects))).sort((a, b) => (b.last || '').localeCompare(a.last || '')); },

    /** A lesson begins: the subject is made (or found), its count goes up. Returns it as it was before, for "last time". */
    begin({ topic, language = '', level = '' }) {
      let name = clean(language || topic, 60); if (!name) return null;
      name = name[0].toUpperCase() + name.slice(1);
      const k = keyOf(name), was = m.subjects[k] ? JSON.parse(JSON.stringify(m.subjects[k])) : null;
      const s = m.subjects[k] ||= { name, kind: language ? 'language' : 'topic', level: '', lessons: 0, first: today(), last: null, points: [], words: [], quiz: { right: 0, asked: 0 }, next: '', focus: '' };
      if (language) s.kind = 'language';
      if (level) s.level = clean(level, 30);
      // (a language lesson can have a theme: "Spanish" with focus "food")
      s.focus = language && topic && keyOf(topic) !== k ? clean(topic, 60) : s.focus;
      // (the day of the lesson before this one, for "last time", when this one is on a new day)
      if (s.last && s.last !== today()) s.lastBefore = s.last;
      s.lessons++; s.last = today();
      save();
      return was;
    },
    /** Points covered on the board, kept (the same point twice is kept once). */
    covered(name, points) {
      const s = m.subjects[keyOf(name)]; if (!s) return;
      for (const p of [].concat(points || []).map(x => clean(x, 90)).filter(Boolean)) {
        const i = s.points.findIndex(q => q.toLowerCase() === p.toLowerCase()); if (i >= 0) s.points.splice(i, 1);
        s.points.push(p);
      }
      s.points = s.points.slice(-MAX_POINTS); save();
    },
    /** A new word for a language: kept in box 1, due tomorrow. Returns true when it was new. */
    word(name, { word, meaning = '', sounds = '' }) {
      const s = m.subjects[keyOf(name)]; word = clean(word, 40); if (!s || !word) return false;
      const old = s.words.find(w => w.word.toLowerCase() === word.toLowerCase());
      if (old) { if (meaning) old.meaning = clean(meaning, 60); if (sounds) old.sounds = clean(sounds, 40); save(); return false; }
      s.words.push({ word, meaning: clean(meaning, 60), sounds: clean(sounds, 40), box: 1, seen: today(), right: 0, wrong: 0 });
      if (s.words.length > MAX_WORDS) s.words.shift();
      save(); return true;
    },
    /** A quiz question answered, right or not; `word` (a word from its list) moves up a box, or back to box 1. */
    answered(name, right, word = '') {
      const s = m.subjects[keyOf(name)]; if (!s) return;
      s.quiz.asked++; if (right) s.quiz.right++;
      const w = word && s.words.find(x => x.word.toLowerCase() === clean(word, 40).toLowerCase());
      if (w) { w.box = right ? Math.min(GAP.length - 1, w.box + 1) : 1; w.seen = today(); if (right) w.right++; else w.wrong++; }
      save();
    },
    /** The lesson is over: what was learned, and what to do next time. */
    end(name, { learned = [], next = '' } = {}) {
      const s = m.subjects[keyOf(name)]; if (!s) return;
      this.covered(name, learned);
      if (next) s.next = clean(next, 120);
      save();
    },
    /** The words of a language that are due for review today, the most overdue first. */
    due(name, n = 6) {
      const s = m.subjects[keyOf(name)], d = today(); if (!s) return [];
      return s.words.filter(w => due(w, d)).sort((a, b) => a.box - b.box || (a.seen || '').localeCompare(b.seen || '')).slice(0, n).map(w => ({ ...w }));
    },
    /** What Reverie is told when a lesson starts: what you did before, and what to do now. */
    recap(name) {
      const s = m.subjects[keyOf(name)]; if (!s || s.lessons < 2) return '';
      const bits = [`This is lesson ${s.lessons} of ${s.name}${s.level ? ` (${s.level})` : ''}; the last one was ${when(s.lastBefore || s.last, today())}.`];
      if (s.points.length) bits.push(`Covered so far: ${s.points.slice(-8).join('; ')}.`);
      if (s.quiz.asked) bits.push(`Quizzes: ${s.quiz.right} of ${s.quiz.asked} right.`);
      if (s.next) bits.push(`Last time you planned to do next: ${s.next}.`);
      if (s.kind === 'language') {
        if (s.words.length) bits.push(`Words they have met (${s.words.length}): ${s.words.slice(-12).map(w => w.word).join(', ')}.`);
        const d = this.due(name);
        if (d.length) bits.push(`Due for review today: ${d.map(w => `${w.word} (${w.meaning})`).join(', ')}. Start with a quick quiz on a couple of these (give the word with each quiz question).`);
      }
      return bits.join(' ');
    },
    /** A line for the diary summary Claude reads: '' when nothing has been learned yet. */
    summary() {
      const subs = this.list().slice(0, 5); if (!subs.length) return '';
      const d = today();
      const one = s => {
        const due = s.kind === 'language' ? this.due(s.name).length : 0;
        return `${s.name}${s.kind === 'language' ? ' (a language)' : ''}: ${s.lessons} lesson${s.lessons === 1 ? '' : 's'}, last ${when(s.last, d)}${s.quiz.asked ? `, quizzes ${s.quiz.right} of ${s.quiz.asked}` : ''}${s.words.length ? `, ${s.words.length} words` : ''}${due ? ` (${due} due for review)` : ''}${s.next ? `; next time: ${s.next}` : ''}`;
      };
      return `[Learning together, kept on their device, not said aloud: ${subs.map(one).join('. ')}. Offer to carry on now and then, lightly.]`;
    },
    /** Forget one subject by name, or every one ("everything"). Returns what went, or ''. */
    forget(what) {
      const w = keyOf(what);
      if (!w) return '';
      if (/^(everything|all|all of it|all my lessons|my lessons|lessons|learning|what i learned|what i ve learned|my learning)$/.test(w)) { const n = Object.keys(m.subjects).length; m = blank(); save(); return n ? 'all of the lessons' : ''; }
      const k = Object.keys(m.subjects).find(k => k === w || w.includes(k) || k.includes(w));
      if (!k) return '';
      const name = m.subjects[k].name; delete m.subjects[k]; save(); return `the ${name} lessons`;
    },
    wipe() { m = blank(); try { store?.removeItem(KEY); } catch { /* fine */ } save(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return api;
}

const when = (k, d) => { if (!k) return 'today'; const n = daysBetween(k, d); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 14 ? `${n} days ago` : new Date(k + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }); };
