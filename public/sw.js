// Reverie's service worker: only for reminders and timers when the page is closed or in the background. It caches
// nothing and never touches the page's requests (no fetch handler), so the page always loads fresh.
//
// The Worker (worker/src/push.js) sends an empty push at each reminder's time: it knows the times, never the words.
// What the reminders are for is read here from this browser's own copy (IndexedDB, written by src/timers.js).

const STEP = { daily: 1, weekdays: 1, weekly: 7 };

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

function db() {
  return new Promise((res, rej) => {
    const q = indexedDB.open('reverie', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('kv');
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
async function get(key) {
  const d = await db();
  try { return await new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
  finally { d.close(); }
}
async function put(key, value) {
  const d = await db();
  try { await new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(value, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
  finally { d.close(); }
}

/** The latest time a reminder came round, up to `now` (its own time, or a repeat of it after), or null if not yet. */
function latest(r, now) {
  if (r.at > now) return null;
  let t = r.at;
  if (r.repeat) for (let i = 0; i < 400; i++) {
    const d = new Date(t); d.setDate(d.getDate() + STEP[r.repeat]);
    if (r.repeat === 'weekdays') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    if (d.getTime() > now) break;
    t = d.getTime();
  }
  return t;
}

const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const mins = ms => { const m = Math.round(ms / 60e3); return m >= 60 ? `${Math.round(m / 6) / 10} hour` : `${m} minute`; };

async function onPush() {
  const now = Date.now() + 30e3;   // (a push can come a moment early)
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  // the page is on screen: it rings and says it itself
  if (windows.some(c => c.visibilityState === 'visible')) { for (const c of windows) c.postMessage({ type: 'reminders-due' }); return; }
  let items = [], shown = {};
  try { items = (await get('reminders')) || []; shown = (await get('shown')) || {}; } catch { /* no copy: a plain notification below */ }
  const due = [];
  for (const r of items) {
    const t = latest(r, now);
    if (t == null || now - t > 12 * 3600e3 || shown[r.id] >= t) continue;
    due.push({ ...r, at: t }); shown[r.id] = t;
  }
  for (const k of Object.keys(shown)) if (!items.some(r => r.id === k)) delete shown[k];
  try { await put('shown', shown); } catch { /* fine */ }
  // (a push must show something: if the copy has nothing due, a plain one)
  if (!due.length) {
    if (items.length && Object.keys(shown).length) return;   // (already shown, from an earlier push: nothing new)
    return self.registration.showNotification('Reverie', { body: 'You have a reminder.', tag: 'reverie', icon: './icon-192.png', badge: './favicon-32.png', data: { url: './' } });
  }
  await Promise.all(due.map(r => self.registration.showNotification(
    r.kind === 'timer' ? `${r.what === 'your' ? 'Your' : cap(r.what)} timer is done` : 'Reverie: a reminder',
    { body: r.kind === 'timer' ? `Your ${r.length ? mins(r.length) + ' ' : ''}timer has finished.` : cap(r.what), tag: `${r.id}@${r.at}`, icon: './icon-192.png', badge: './favicon-32.png', requireInteraction: true, data: { url: './' } })));
}

self.addEventListener('push', e => e.waitUntil(onPush()));

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(c => 'focus' in c);
    if (open) { await open.focus(); open.postMessage({ type: 'reminders-due' }); return; }
    await self.clients.openWindow(new URL(e.notification.data?.url || './', self.registration.scope).href);
  })());
});
