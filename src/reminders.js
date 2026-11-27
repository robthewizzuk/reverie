// Reminders and timers: "remind me at 6 to call Mum", "a ten minute timer for the pasta", "every morning at 8, remind
// me to take my vitamins". Kept in this browser only (localStorage), like the diary: what they are for never leaves the
// device. (For a notification with the page closed, only the times go to the backend, never the words: timers.js.)
// No three.js and no engine here, so the tests can read it.

const KEY = 'reverie.reminders.v1';
const MAX = 40;                       // reminders and timers kept at once
const MAX_AHEAD = 366 * 864e5;        // a year ahead at most
export const REPEATS = ['daily', 'weekdays', 'weekly'];

const clean = (s, n = 80) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const words = s => clean(s, 200).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
const STOP = new Set(['the', 'my', 'a', 'an', 'to', 'for', 'and', 'of', 'me', 'reminder', 'timer', 'remind', 'it', 'that', 'one']);
const pad2 = n => String(n).padStart(2, '0');

/** "18:00" in their own clock (the page's time zone). */
export const hhmm = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
/** "18:00 today", "09:30 tomorrow", "09:30 on Monday 30 November". */
export function whenText(at, now) {
  const d = new Date(at), n = new Date(now);
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const gap = Math.round((day(d) - day(n)) / 864e5);
  return hhmm(d) + (gap === 0 ? ' today' : gap === 1 ? ' tomorrow' : ' on ' + d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }));
}
/** How long is left, in words: "4 minutes 30 seconds", "2 hours 5 minutes", "3 days". */
export function leftText(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (s < 60) return plural(s, 'second');
  if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; return plural(m, 'minute') + (r && m < 10 ? ' ' + plural(r, 'second') : ''); }
  if (s < 86400 * 2) { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return plural(h, 'hour') + (m ? ' ' + plural(m, 'minute') : ''); }
  return plural(Math.round(s / 86400), 'day');
}
/** A length as a word before "timer": "10 minute", "1 hour 30 minute". */
export const lengthWord = ms => leftText(ms).replace(/(\d+ [a-z]+?)s\b/g, '$1');
/** The countdown on a chip: "4:05", "1:02:30", or for a long way off "18:00", "Sat 09:00". */
export function chipTime(r, now) {
  const left = r.at - now;
  if (r.kind === 'timer' && left < 100 * 3600e3) {
    const s = Math.max(0, Math.ceil(left / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return h ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
  }
  const d = new Date(r.at), n = new Date(now);
  return d.toDateString() === n.toDateString() ? hhmm(d) : d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + hhmm(d);
}

/**
 * A time of day or a date and time, in their own time zone, as the next moment it comes after `now` (ms).
 * "18:00", "6pm", "6:30 pm", "noon", "midnight", "2026-11-28 09:30", "2026-11-28T09:30", "tomorrow 9am",
 * "monday 8:15", "28 November 9am". A time alone that has passed today is tomorrow. null when it can't be read.
 */
export function parseAt(text, now) {
  let s = clean(text, 60).toLowerCase().replace(/(\d)t(\d)/, '$1 $2').replace(/\bo'?clock\b/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const base = new Date(now);
  let y = base.getFullYear(), mo = base.getMonth(), d = base.getDate(), dateGiven = false, x;
  // the date part
  if ((x = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) { y = +x[1]; mo = +x[2] - 1; d = +x[3]; dateGiven = true; s = s.replace(x[0], ' '); }
  else if ((x = /\btomorrow\b/.exec(s))) { const t = new Date(y, mo, d + 1); y = t.getFullYear(); mo = t.getMonth(); d = t.getDate(); dateGiven = true; s = s.replace(x[0], ' '); }
  else if ((x = /\btoday\b|\btonight\b/.exec(s))) { dateGiven = true; s = s.replace(x[0], ' '); if (x[0] === 'tonight' && !/\d/.test(s)) s = '20:00'; }
  else if ((x = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(s))) {
    const want = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(x[1]);
    let add = (want - base.getDay() + 7) % 7;
    const t = new Date(y, mo, d + add); y = t.getFullYear(); mo = t.getMonth(); d = t.getDate(); dateGiven = add > 0 ? true : 'weekday';
    s = s.replace(x[0], ' ').replace(/\b(next|this|on)\b/g, ' ');
  } else if ((x = /\b(\d{1,2})(?:st|nd|rd|th)? (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.exec(s)) || (x = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})(?:st|nd|rd|th)?\b/.exec(s))) {
    const mon = isNaN(+x[1]) ? x[1] : x[2], day = isNaN(+x[1]) ? +x[2] : +x[1];
    mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(mon); d = day; dateGiven = true;
    if (new Date(y, mo, d, 23, 59).getTime() < now) y++;
    s = s.replace(x[0], ' ');
  }
  s = s.replace(/\b(at|on|in the)\b/g, ' ').replace(/\s+/g, ' ').trim();
  // the time part
  let h = null, m = 0;
  if (!s) { if (!dateGiven) return null; h = 9; }   // (a day alone: nine in the morning)
  else if (s === 'noon' || s === 'midday') h = 12;
  else if (s === 'midnight') h = 0;
  else if (s === 'morning') h = 9; else if (s === 'afternoon') h = 14; else if (s === 'evening') h = 18; else if (s === 'night') h = 21;
  else if ((x = /^(\d{1,2})(?:[:.h](\d{2}))?(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?(?: (morning|afternoon|evening|night))?$/.exec(s))) {
    h = +x[1]; m = +(x[2] || 0);
    const ap = x[3]?.[0], part = x[4];
    if (h > 23 || m > 59) return null;
    if (ap === 'p' && h < 12) h += 12; else if (ap === 'a' && h === 12) h = 0;
    else if (!ap && (part === 'afternoon' || part === 'evening' || part === 'night') && h < 12) h += 12;
    else if (!ap && !part && !x[2] && h >= 1 && h <= 7) {
      // "at 6" with no am or pm: the next six to come (morning or evening)
      const am = new Date(y, mo, d, h, 0).getTime();
      if (dateGiven !== true && am <= now) h += 12;
    }
  } else return null;
  let at = new Date(y, mo, d, h, m, 0, 0).getTime();
  if (isNaN(at)) return null;
  if (at <= now && dateGiven !== true) at = new Date(y, mo, d + (dateGiven === 'weekday' ? 7 : 1), h, m).getTime();
  return at;
}

/** A length of time in words or as minutes: 10, "10 minutes", "1h 30m", "an hour and a half", "90 seconds". ms or null. */
export function parseLength(v) {
  if (typeof v === 'number') return isFinite(v) && v > 0 ? v * 60e3 : null;
  let s = clean(v, 60).toLowerCase(); if (!s) return null;
  s = s.replace(/\ban? (hour|minute) and a half\b/g, '1.5 $1s').replace(/\bhalf an? hour\b/g, '30 minutes').replace(/\ba quarter of an hour\b|\bquarter of an hour\b|\ba quarter hour\b/g, '15 minutes')
    .replace(/\b(\d+) and a half (hours?|minutes?)\b/g, (_, n, u) => `${+n + .5} ${u}`).replace(/\b(\d+) (hours?|minutes?) and a half\b/g, (_, n, u) => `${+n + .5} ${u}`)
    .replace(/\ban? (?=hour|minute|min|second|sec|day)/g, '1 ');
  let ms = 0, any = false, x; const re = /(\d+(?:\.\d+)?)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)\b/g;
  while ((x = re.exec(s))) { any = true; ms += +x[1] * ({ d: 864e5, h: 3600e3, m: 60e3, s: 1e3 }[x[2][0]]); }
  if (!any && /^\d+(\.\d+)?$/.test(s)) { ms = +s * 60e3; any = true; }
  return any && ms > 0 ? ms : null;
}

/** The next time a repeating reminder comes round after `after`. */
function nextRepeat(r, after) {
  const d = new Date(r.at);
  for (let i = 0; i < 400; i++) {
    d.setDate(d.getDate() + (r.repeat === 'weekly' ? 7 : 1));
    if (r.repeat === 'weekdays' && (d.getDay() === 0 || d.getDay() === 6)) continue;
    if (d.getTime() > after) return d.getTime();
  }
  return null;
}

/** Makes the list, read from `store` (localStorage by default; tests pass their own), with `clock` in ms. */
export function makeReminders({ store = globalThis.localStorage, clock = () => Date.now() } = {}) {
  let list = load(), ids = 0;
  const listeners = new Set();

  function load() {
    try {
      const o = JSON.parse(store?.getItem(KEY) || 'null');
      return Array.isArray(o?.items) ? o.items.filter(r => r && typeof r.what === 'string' && isFinite(r.at)) : [];
    } catch { return []; }
  }
  function save() {
    try { store?.setItem(KEY, JSON.stringify({ v: 1, items: list })); } catch { /* a private window, or full: kept until the tab closes */ }
    for (const f of listeners) try { f(); } catch { /* a listener's problem */ }
  }
  const sorted = () => [...list].sort((a, b) => a.at - b.at);
  const label = r => r.kind === 'timer' ? `the ${r.what} timer` : `the reminder to ${r.what}`;

  /** The ones that best match `what` (words in common), or every one for "all", or the kind for "the timer". */
  function find(what) {
    const w = clean(what, 80).toLowerCase();
    if (!w || /^(it|that|this|that one|the last one|latest)$/.test(w)) return list.length ? [[...list].sort((a, b) => b.made - a.made)[0]] : [];
    if (/^(all|everything|all of them|all reminders|all timers|all reminders and timers|every (one|timer|reminder))$/.test(w))
      return /timer/.test(w) ? list.filter(r => r.kind === 'timer') : /reminder/.test(w) ? list.filter(r => r.kind === 'reminder') : [...list];
    const ww = words(w);
    if (!ww.length) { const kind = /timer/.test(w) ? 'timer' : /remind/.test(w) ? 'reminder' : null; const of = list.filter(r => !kind || r.kind === kind); return of.length === 1 ? of : []; }
    const scored = list.map(r => [r, words(r.what).filter(x => ww.some(y => y === x || (y.length > 3 && x.startsWith(y.slice(0, 4))))).length]).filter(([, n]) => n);
    if (!scored.length) return [];
    const best = Math.max(...scored.map(([, n]) => n));
    return scored.filter(([, n]) => n === best).map(([r]) => r);
  }

  return {
    /** Every reminder and timer, soonest first. */
    get items() { return sorted(); },
    /** Calls fn whenever the list changes. */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Sets one: { what, kind, minutes | length, at, repeat }. Resolves a sentence for Claude, or { text, error }. */
    set(input = {}) {
      const now = clock();
      const what = clean(input.what, 80).replace(/^(to|for) /i, '').replace(/[.!]+$/, '');
      const lengthMs = input.minutes != null ? parseLength(+input.minutes) : input.length != null ? parseLength(input.length) : null;
      if ((input.minutes != null || input.length != null) && !lengthMs) return { text: `Not set: "${input.minutes ?? input.length}" is not a length of time I can read.`, error: true };
      let at = null;
      if (lengthMs) at = now + lengthMs;
      else if (input.at) { at = parseAt(input.at, now); if (at == null) return { text: `Not set: "${input.at}" is not a time I can read. Give a time like "18:00" or "2026-11-28 09:30", or minutes for a timer.`, error: true }; }
      else return { text: 'Not set: give minutes (for a timer) or a time (for a reminder).', error: true };
      if (at - now > MAX_AHEAD) return { text: 'Not set: that is more than a year away.', error: true };
      if (at <= now) return { text: 'Not set: that time has already gone.', error: true };
      const kind = input.kind === 'timer' || input.kind === 'reminder' ? input.kind : lengthMs && lengthMs <= 6 * 3600e3 && !input.repeat ? 'timer' : 'reminder';
      const repeat = REPEATS.includes(input.repeat) ? input.repeat : null;
      if (repeat === 'weekdays') { const d = new Date(at); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); at = d.getTime(); }
      if (!what && kind === 'reminder') return { text: 'Not set: say what the reminder is for.', error: true };
      const r = { id: `r${now.toString(36)}${(ids++).toString(36)}`, kind, what: what || 'your', at, made: now, ...(repeat ? { repeat } : {}), ...(lengthMs ? { length: lengthMs } : {}) };
      list.push(r);
      if (list.length > MAX) list = sorted().slice(-MAX);
      save();
      const when = kind === 'timer' ? `It goes off in ${leftText(at - now)} (at ${hhmm(new Date(at))})` : `It goes off at ${whenText(at, now)}`;
      const rep = repeat ? `, and again ${repeat === 'daily' ? 'every day' : repeat === 'weekdays' ? 'every weekday' : 'every week'} after that` : '';
      return `Set ${kind === 'timer' ? `a ${lengthWord(lengthMs)} timer for ${r.what === 'your' ? 'them' : r.what}` : `a reminder to ${r.what}`}. ${when}${rep}. It shows on their screen, and you will tell them out loud with a chime when it is time.`;
    },

    /** Cancels the ones `what` names (words in it, "the timer", "all"). Resolves a sentence, or { text, error }. */
    cancel(input = {}) {
      const hit = find(input.what);
      if (!hit.length) return { text: list.length ? `Nothing matches "${input.what}". Set now: ${this.listText()}` : 'There are no reminders or timers set.', error: true };
      const gone = new Set(hit.map(r => r.id)); list = list.filter(r => !gone.has(r.id)); save();
      return `Cancelled ${hit.map(label).join(', ')}.`;
    },

    /** Takes one off by its id (the ✕ on its chip, or a one-off that has gone off). */
    drop(id) { const n = list.length; list = list.filter(r => r.id !== id); if (list.length !== n) save(); },

    /** Pushes one back by some minutes: the one `what` names, or the one that went off last (`recent`). */
    snooze(input = {}, recent = null) {
      const now = clock(), ms = parseLength(input.minutes != null ? +input.minutes : input.length ?? 5) || 5 * 60e3;
      const hit = input.what ? find(input.what)[0] : recent;
      if (!hit) return { text: 'Nothing to snooze: no reminder has gone off just now.', error: true };
      const live = list.find(r => r.id === hit.id);
      if (live && !live.repeat) live.at = now + ms;
      else list.push({ ...hit, id: `r${now.toString(36)}${(ids++).toString(36)}`, at: now + ms, made: now, repeat: undefined, snoozed: true });
      save();
      return `Snoozed ${label(hit)}: it goes off again in ${leftText(ms)}.`;
    },

    /** What is set, in a sentence for Claude. */
    listText() {
      const now = clock();
      if (!list.length) return 'No reminders or timers are set.';
      return sorted().map(r => r.kind === 'timer' ? `the ${r.what} timer (${leftText(r.at - now)} left)` : `a reminder to ${r.what} at ${whenText(r.at, now)}${r.repeat ? ` (${r.repeat})` : ''}`).join('; ') + '.';
    },

    /**
     * The ones whose time has come: each is taken off the list (or, if it repeats, moved on to its next time) and
     * returned as { ...r, late } (late: ms past its time, when the page was closed or asleep).
     */
    due() {
      const now = clock(), out = [];
      for (const r of sorted()) {
        if (r.at > now) break;
        out.push({ ...r, late: now - r.at });
        if (r.repeat) { const next = nextRepeat(r, now); if (next) r.at = next; else list = list.filter(x => x.id !== r.id); }
        else list = list.filter(x => x.id !== r.id);
      }
      if (out.length) save();
      return out;
    },

    /** When the next one goes off (ms), or null. */
    get next() { return list.length ? Math.min(...list.map(r => r.at)) : null; },

    /** A few words for the line Claude reads with each message ('' when none are set). */
    line() {
      if (!list.length) return '';
      const now = clock(), s = sorted().slice(0, 5).map(r => r.kind === 'timer' ? `${r.what} timer ${leftText(r.at - now)} left` : `remind them to ${r.what} at ${whenText(r.at, now)}`);
      return ` Set: ${s.join('; ')}${list.length > 5 ? ` and ${list.length - 5} more` : ''}.`;
    },

    /** Everything gone. */
    wipe() { list = []; try { store?.removeItem(KEY); } catch { /* fine */ } save(); },
  };
}
