// Pure state for Reverie's Time Capsule jars on the shelf (no Three.js, testable in Node).
// Seal a note (and optionally a 3D prop!) until a future date ("tomorrow", "in a week", "in a month",
// "2026-12-25", or "my birthday"). When the date arrives, the jar glows golden and jiggles on the shelf
// and joins the daily briefing until opened.

const KEY = 'reverie.capsules.v1';
export const MAX_CAPSULES = 4;

const memStore = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

/** Parses a future date expression into epoch ms, or null if invalid. */
export function parseOpenDate(raw, now = Date.now(), birthday = null) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  const base = new Date(now);
  const startOfDay = (y, m, d) => new Date(y, m, d, 8, 0, 0, 0).getTime();

  // "my birthday" / "birthday" (birthday is MM-DD)
  if (/birthday/.test(s) && birthday && /^\d{2}-\d{2}$/.test(birthday)) {
    const [mm, dd] = birthday.split('-').map(Number);
    let t = startOfDay(base.getFullYear(), mm - 1, dd);
    if (t <= now) t = startOfDay(base.getFullYear() + 1, mm - 1, dd);
    return t;
  }
  if (/^tomorrow$/.test(s)) return startOfDay(base.getFullYear(), base.getMonth(), base.getDate() + 1);
  if (/^next week$/.test(s)) return startOfDay(base.getFullYear(), base.getMonth(), base.getDate() + 7);
  if (/^next month$/.test(s)) return startOfDay(base.getFullYear(), base.getMonth() + 1, base.getDate());
  if (/^next year$/.test(s)) return startOfDay(base.getFullYear() + 1, base.getMonth(), base.getDate());

  // "in N minutes / hours / days / weeks / months / years"
  const rel = /^in\s+(?:a|an|(\d+))\s+(minute|min|hour|hr|day|week|month|year)s?$/.exec(s);
  if (rel) {
    const n = rel[1] ? parseInt(rel[1], 10) : 1, unit = rel[2];
    if (n <= 0) return null;
    if (unit === 'minute' || unit === 'min') return now + n * 60e3;
    if (unit === 'hour' || unit === 'hr') return now + n * 3600e3;
    if (unit === 'day') return startOfDay(base.getFullYear(), base.getMonth(), base.getDate() + n);
    if (unit === 'week') return startOfDay(base.getFullYear(), base.getMonth(), base.getDate() + n * 7);
    if (unit === 'month') return startOfDay(base.getFullYear(), base.getMonth() + n, base.getDate());
    if (unit === 'year') return startOfDay(base.getFullYear() + n, base.getMonth(), base.getDate());
  }

  // ISO date YYYY-MM-DD
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const t = startOfDay(+iso[1], +iso[2] - 1, +iso[3]);
    return t > now ? t : null;
  }
  // Fallback Date.parse
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed) && parsed > now) return parsed;
  return null;
}

export function formatDay(ts) {
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function makeCapsuleState({ store = typeof localStorage !== 'undefined' ? localStorage : memStore(), clock = () => Date.now(), birthday = () => null } = {}) {
  let data = { items: [], seq: 1 };
  try {
    const raw = JSON.parse(store.getItem(KEY) || 'null');
    if (raw && Array.isArray(raw.items)) {
      data.items = raw.items.filter(c => c && c.id && c.note && Number.isFinite(c.openAt)).slice(0, MAX_CAPSULES);
      data.seq = Number.isFinite(raw.seq) ? raw.seq : data.items.length + 1;
    }
  } catch { /* empty */ }

  const save = () => { try { store.setItem(KEY, JSON.stringify(data)); } catch { /* private window */ } };
  const active = () => data.items.filter(c => !c.opened);
  const due = (now = clock()) => active().filter(c => c.openAt <= now);

  function seal({ note, prop = '', until, label = '' } = {}) {
    const cleanNote = String(note || '').trim().slice(0, 320);
    if (!cleanNote) return { error: 'Tell me what note to seal inside the time capsule.' };
    if (active().length >= MAX_CAPSULES) return { error: `The shelf already has ${MAX_CAPSULES} sealed time capsules. Open or remove one first.` };
    const now = clock();
    const openAt = typeof until === 'number' && until > now ? until : parseOpenDate(until, now, birthday());
    if (!openAt) return { error: `I couldn't work out a future date from "${until || ''}" — try "tomorrow", "in a week", "in a month", or a date like "2026-12-25".` };
    const cap = {
      id: 'c' + data.seq++,
      note: cleanNote,
      prop: String(prop || '').trim().slice(0, 60),
      label: String(label || '').trim().slice(0, 40) || `For ${formatDay(openAt)}`,
      createdAt: now,
      openAt,
      opened: false,
    };
    data.items.push(cap);
    // prune old opened items to stay tidy
    data.items = [...active(), ...data.items.filter(c => c.opened).slice(-4)];
    save();
    return { capsule: cap, text: `Sealed your time capsule jar on the shelf until ${formatDay(openAt)}${cap.prop ? ` (with ${cap.prop} tucked inside)` : ''}!` };
  }

  function open(idOrQuery = '', { force = false } = {}) {
    const now = clock();
    const list = active();
    if (!list.length) return { error: 'There are no sealed time capsules on the shelf.' };
    const q = String(idOrQuery || '').toLowerCase().trim();
    const cap = (q && list.find(c => c.id === q || c.label.toLowerCase().includes(q) || c.note.toLowerCase().includes(q)))
      || due(now)[0]
      || list[0];
    if (!force && cap.openAt > now) {
      const days = Math.max(1, Math.ceil((cap.openAt - now) / 86400e3));
      return { locked: true, capsule: cap, text: `That time capsule ("${cap.label}") is still sealed until ${formatDay(cap.openAt)} (${days} ${days === 1 ? 'day' : 'days'} to go). Say "open it early" if you really want to peek!` };
    }
    cap.opened = true; cap.openedAt = now; save();
    return { capsule: cap, text: `Popped open the time capsule from ${formatDay(cap.createdAt)}! The note inside says: "${cap.note}"${cap.prop ? ` And tucked inside was: ${cap.prop}!` : ''}` };
  }

  function remove(idOrQuery = '') {
    const q = String(idOrQuery || '').toLowerCase().trim();
    const list = active();
    const cap = (q && list.find(c => c.id === q || c.label.toLowerCase().includes(q))) || list.at(-1);
    if (!cap) return { error: 'No sealed time capsule to remove.' };
    data.items = data.items.filter(c => c.id !== cap.id); save();
    return { capsule: cap, text: `Removed the time capsule "${cap.label}" from the shelf.` };
  }

  function list() {
    const items = active();
    if (!items.length) return 'No sealed time capsules on the shelf yet.';
    const now = clock();
    return items.map(c => `"${c.label}" (${c.openAt <= now ? 'READY TO OPEN!' : `opens ${formatDay(c.openAt)}`}${c.prop ? `, holds ${c.prop}` : ''})`).join('; ');
  }

  function line() {
    const items = active();
    if (!items.length) return '';
    const ready = due();
    if (ready.length) return ` Time capsule on the shelf: ${ready.length} READY TO OPEN (${ready.map(c => `"${c.label}"`).join(', ')} — glowing and jiggling!).`;
    return ` Time capsules on the shelf: ${items.length} sealed (next opens ${formatDay(Math.min(...items.map(c => c.openAt)))}).`;
  }

  function briefingLine() {
    const ready = due();
    if (!ready.length) return '';
    return `A time capsule on the shelf is ready to open today (${ready.map(c => `"${c.label}" from ${formatDay(c.createdAt)}`).join(', ')}): tell them excitedly that the jar is glowing on the shelf and they can tap it or ask you to open it!`;
  }

  return {
    get items() { return active(); },
    due, seal, open, remove, list, line, briefingLine,
  };
}
