// The reminders and timers on the page: a chip for each at the bottom of the stage (a countdown for a timer, the time
// for a reminder, a ✕ to cancel), a soft chime when one goes off (rung again every few seconds until they stop it or
// say anything), Reverie telling them in its own words, and a notification when the page is in the background.
//
// With the page closed: once they allow notifications (the bell on the chips), the browser's push service and the
// Worker (worker/src/push.js) wake the service worker (public/sw.js) at the right time. Only the times go to the
// Worker, never what the reminders are for: the service worker reads those from this browser (a copy in IndexedDB,
// written here), so the words never leave the device.
import gs from '../engine/src/gamescroll.js';
import { chipTime, hhmm, leftText, lengthWord } from './reminders.js';

const API = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '') + '/api/push';
const RING_EVERY = 6000, RING_FOR = 60000;   // the chime again every 6 s, for a minute at most
const LATE = 2 * 60e3;                       // gone off more than 2 minutes ago (the page was closed): told, not rung
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A soft bell: two struck notes with their partials, like a kitchen timer's ding without the shrill.
let chimes = 0;
function chime(loud = true) {
  try {
    const { tone } = gs.sound, v = loud ? 1 : .6;
    for (const [f, at] of [[1046.5, 0], [1318.5, .22]]) {
      tone(f, { len: 1.1, wave: 'sine', vol: .09 * v, attack: .004, at });
      tone(f * 2.76, { len: .45, wave: 'sine', vol: .025 * v, attack: .002, at });
      tone(f * 5.4, { len: .18, wave: 'sine', vol: .01 * v, attack: .002, at });
    }
    chimes++;
  } catch { /* no sound yet (before the first tap) */ }
}

// ---- the copy the service worker reads (IndexedDB: localStorage can't be read there)
function idb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open('reverie', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('kv');
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
async function mirror(items) {
  try {
    const db = await idb();
    await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(items.map(({ id, kind, what, at, repeat, length }) => ({ id, kind, what, at, repeat, length })), 'reminders'); t.oncomplete = res; t.onerror = () => rej(t.error); });
    db.close();
  } catch { /* no IndexedDB (a private window): notifications with the page closed just say "a reminder" */ }
}

const b64url = s => { const p = '='.repeat((4 - s.length % 4) % 4), raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); };

/**
 * el: the #timers element. reminders: reminders.js. canTalk(): true when Reverie is awake and free to speak.
 * announce(text): Reverie says it (brain.hear as news). onRing(items): it went off (a wave, a little burst).
 */
export function makeTimers({ el, reminders, canTalk = () => false, announce = () => {}, onRing = () => {} }) {
  let ringing = [], recent = null, tell = [], nextRing = 0, ringUntil = 0, timer = 0, shown = '';
  let reg = null, sub = null, pushKey = null, synced = '';

  // ---- the service worker and push
  async function setupWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      navigator.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'reminders-due') check(); });
      sub = await reg.pushManager?.getSubscription().catch(() => null) || null;
      if (sub) sync();
    } catch (e) { console.info('[reverie] no service worker: ' + (e?.message || e)); }
  }
  const notifyState = () => !('Notification' in window) || !reg ? 'unsupported' : Notification.permission;
  /** The bell on the chips: asks to notify (from the tap), then signs up for push where the Worker offers it. */
  async function allow() {
    if (notifyState() === 'unsupported') return 'unsupported';
    const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (p === 'granted') await subscribe();
    render();
    return p;
  }
  async function subscribe() {
    if (sub || !reg?.pushManager) return !!sub;
    try {
      pushKey ??= await fetch(API).then(r => r.ok ? r.json() : null).then(j => j?.key || '').catch(() => '');
      if (!pushKey) return false;   // (the dev server, or a Worker without push: notifications only while the page is open)
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64url(pushKey) });
      synced = ''; await sync();
      return true;
    } catch (e) { console.info('[reverie] push not available: ' + (e?.message || e)); return false; }
  }
  /** Tells the Worker when to wake this browser: the times only (and a few repeats ahead), never the words. */
  async function sync() {
    if (!sub) return;
    const times = [];
    for (const r of reminders.items) {
      times.push({ id: r.id, at: r.at });
      if (r.repeat) for (let t = r.at, i = 0; i < 13; i++) { const d = new Date(t); d.setDate(d.getDate() + (r.repeat === 'weekly' ? 7 : 1)); if (r.repeat === 'weekdays') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); t = d.getTime(); times.push({ id: r.id, at: t }); }
    }
    const body = JSON.stringify({ subscription: sub.toJSON(), times: times.slice(0, 60) });
    if (body === synced) return; synced = body;
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      if (!r.ok) { synced = ''; console.info('[reverie] push sync: ' + r.status); }
    } catch { synced = ''; }
  }

  // ---- going off
  function notify(list) {
    // (with push on, the service worker shows these; without it, the page does while it is in the background)
    if (!document.hidden || sub || notifyState() !== 'granted' || !reg) return;
    for (const r of list) reg.showNotification(r.kind === 'timer' ? `${r.what === 'your' ? 'Your' : cap(r.what)} timer is done` : 'Reverie: a reminder', {
      body: r.kind === 'timer' ? `Your ${r.length ? lengthWord(r.length) + ' ' : ''}timer has finished.` : cap(r.what), tag: `${r.id}@${r.at}`, icon: './icon-192.png', badge: './favicon-32.png',
      requireInteraction: true, data: { url: location.href },
    }).catch(() => {});
  }
  function check() {
    const due = reminders.due(); if (!due.length) return;
    const now = Date.now(), fresh = due.filter(r => r.late < LATE), late = due.filter(r => r.late >= LATE);
    if (fresh.length) { ringing.push(...fresh.map(r => ({ ...r, since: now }))); nextRing = now; ringUntil = now + RING_FOR; onRing(fresh); }
    if (late.length) { ringing.push(...late.map(r => ({ ...r, since: now, missed: true }))); if (!fresh.length) chime(false); }
    recent = due.at(-1);
    tell.push(...due);
    notify(due);
    render();
  }
  /** What Reverie is told, for it to say in its own words. */
  function note(list) {
    const now = Date.now(), lines = list.map(r => {
      const was = r.late >= LATE ? ` It went off at ${hhmm(new Date(r.at))}, ${leftText(r.late)} ago, while they were away: mention it gently.` : '';
      return r.kind === 'timer' ? `[timer] The ${r.length ? lengthWord(r.length) + ' ' : ''}timer${r.what === 'your' ? '' : ' for ' + r.what} has finished.${was || ' Tell them now, in one short, lively line.'}`
        : `[reminder] It is ${hhmm(new Date(now))}: time to ${r.what}${r.repeat ? ` (their ${r.repeat} reminder)` : ''}.${was || ' Tell them now, warmly, in one short line.'}`;
    });
    return lines.join('\n') + '\nThe chime is ringing on their screen until they answer; if they ask, snooze it with the reminder tool.';
  }

  function tick() {
    const now = Date.now();
    check();
    if (ringing.some(r => !r.missed && !r.done) && now >= nextRing && now < ringUntil) { chime(); nextRing = now + RING_EVERY; }
    if (tell.length && canTalk()) { const list = tell; tell = []; announce(note(list)); }
    // a stopped chip fades after a while
    const before = ringing.length; ringing = ringing.filter(r => !(r.done && now - r.done > 15000)); if (ringing.length !== before) render();
    render();
    // the next check: a second (for the countdowns), or just in time for the next one when there is nothing to count
    clearTimeout(timer);
    const next = reminders.next, wait = ringing.length || (next && next - now < 3600e3) ? 1000 : Math.min(60e3, next ? next - now : 60e3);
    timer = setTimeout(tick, Math.max(250, wait));
  }

  // ---- the chips
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  const name = r => r.kind === 'timer' ? (r.what === 'your' ? 'Timer' : cap(r.what)) : cap(r.what);
  function render(force = false) {
    const now = Date.now(), items = reminders.items;
    // each chip: its shape (rebuilt only when that changes, so a button is never swapped under a finger) and its time
    const chips = [];
    for (const r of ringing) {
      const state = r.done ? 'stopped' : r.missed ? 'missed' : 'ringing';
      chips.push({ key: `ring:${r.id}:${state}`, when: r.done ? 'Done' : r.missed ? hhmm(new Date(r.at)) : r.kind === 'timer' ? "Time's up!" : 'Now!',
        html: `<div class="chip ${state}" data-ring="${esc(r.id)}"><span class="ico" aria-hidden="true">${r.kind === 'timer' ? '⏲\uFE0F' : '🔔'}</span><span class="what">${esc(name(r))}</span><span class="when"></span>`
          + (r.done ? '' : `${r.missed ? '' : '<button type="button" data-snooze="1" aria-label="Snooze for 5 minutes">+5</button>'}<button type="button" data-stop="1" aria-label="${r.missed ? 'Dismiss' : 'Stop'}">${r.missed ? '✕' : 'Stop'}</button>`) + '</div>' });
    }
    for (const r of items.slice(0, 6)) chips.push({ key: `item:${r.id}:${r.at}`, when: chipTime(r, now),
      html: `<div class="chip" data-id="${esc(r.id)}"><span class="ico" aria-hidden="true">${r.kind === 'timer' ? '⏲\uFE0F' : '🔔'}</span><span class="what">${esc(name(r))}${r.repeat ? ' <i>↻</i>' : ''}</span><span class="when"></span>`
        + `<button type="button" data-cancel="1" aria-label="Cancel ${esc(name(r))}">✕</button></div>` });
    if (items.length > 6) chips.push({ key: `more:${items.length}`, html: `<div class="chip more">+${items.length - 6} more</div>` });
    if (items.length && notifyState() === 'default') chips.push({ key: 'bell', html: '<button type="button" class="chip bell" data-allow="1">🔔 Tell me even when Reverie is closed</button>' });
    const shape = chips.map(c => c.key).join('|');
    if (force || shape !== shown) { shown = shape; el.innerHTML = chips.map(c => c.html).join(''); el.hidden = !chips.length; }
    chips.forEach((c, i) => { const w = c.when != null && el.children[i]?.querySelector('.when'); if (w && w.textContent !== c.when) w.textContent = c.when; });
  }
  el.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const chip = b.closest('.chip');
    if (b.dataset.allow) { await allow(); return; }
    if (b.dataset.cancel) { reminders.drop(chip.dataset.id); gs.sound.sounds.back?.(); }
    else if (b.dataset.stop) stop(chip.dataset.ring);
    else if (b.dataset.snooze) { const r = ringing.find(x => x.id === chip.dataset.ring); if (r) { reminders.snooze({ minutes: 5 }, r); stop(r.id, true); } }
    render();
  });
  /** Stops the chime (one, or all of them). */
  function stop(id = null, gone = false) {
    const now = Date.now();
    for (const r of ringing) if (!id || r.id === id) r.done = gone ? 1 : now;
    if (!ringing.some(r => !r.done && !r.missed)) ringUntil = 0;
    ringing = ringing.filter(r => r.done !== 1 && !(r.missed && r.done));
  }

  reminders.onChange(() => { mirror(reminders.items); sync(); render(); });
  mirror(reminders.items);
  setupWorker();
  tick();

  return {
    /** The reminder tool: { action: set | cancel | snooze | list, ... }. */
    async tool(input = {}) {
      const a = input.action || 'set';
      if (a === 'set') {
        const r = reminders.set(input); if (r.error) return r;
        gs.sound.sounds.toggle?.(); tick();
        const st = notifyState();
        return r + (st === 'default' ? ' If they might close you before then, they can tap the bell under the chips to get a notification anyway.' : st === 'denied' ? ' Notifications are blocked in their browser, so keep this page open for it.' : '');
      }
      if (a === 'cancel') return reminders.cancel(input);
      if (a === 'snooze') { const r = reminders.snooze(input, recent); if (!r.error) stop(recent?.id, true); render(); return r; }
      if (a === 'list') return reminders.listText() + (notifyState() === 'granted' ? '' : ' (They can tap the bell on the chips to get a notification even when you are closed.)');
      return { text: 'action must be set, cancel, snooze or list.', error: true };
    },
    /** They said something: the chime stops (they've heard it). */
    heard() { if (ringing.some(r => !r.done)) { stop(); render(); } },
    /** Ask for notifications (from a tap). */
    allow,
    get ringing() { return ringing; },
    get notify() { return notifyState(); },
    get pushing() { return !!sub; },
    /** How many times the chime has rung (for the tests). */
    get chimes() { return chimes; },
    check: tick,
  };
}
