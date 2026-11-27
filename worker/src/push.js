// Web Push for reminders and timers, so Reverie can tap you on the shoulder with the page closed.
//
// What it knows: a browser's push address and the times its reminders go off. Never what they are for: the push it
// sends is empty, and the service worker (public/sw.js) reads the words from the browser's own copy.
// This file is the pure part (keys, tokens, checks, the send), so node can test it: tests/push.mjs. The Durable
// Objects that keep the times and wake at them are in pusher.js.

const MAX_TIMES = 64, AHEAD = 400 * 864e5;
// the browsers' own push services (no other address is ever posted to)
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

export const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = new TextEncoder();

/** A signing key pair for VAPID: { jwk (private), pub (the raw public key, base64url, for the page) }. */
export async function makeVapid() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { jwk: await crypto.subtle.exportKey('jwk', k.privateKey), pub: b64url(await crypto.subtle.exportKey('raw', k.publicKey)) };
}

/** The VAPID header's token for a push service (`aud`: its origin), signed with the private key. */
export async function vapidToken(jwk, aud, sub, now = Date.now()) {
  const head = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub })));
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

/** Checks what the page sent: { subscription: { endpoint }, times: [{ id, at }] }. { endpoint, times } or { error }. */
export function checkSync(o, now = Date.now()) {
  const endpoint = o?.subscription?.endpoint;
  let u; try { u = new URL(endpoint); } catch { return { error: 'no push address' }; }
  if (u.protocol !== 'https:' || !PUSH_HOSTS.some(h => h.test(u.hostname))) return { error: 'not a push service' };
  if (!Array.isArray(o.times) || o.times.length > MAX_TIMES) return { error: `times must be a list of at most ${MAX_TIMES}` };
  const times = [];
  for (const t of o.times) {
    if (!t || typeof t.id !== 'string' || t.id.length > 40 || !Number.isFinite(t.at)) return { error: 'each time is { id, at }' };
    if (t.at > now - 3600e3 && t.at < now + AHEAD) times.push({ id: t.id, at: Math.round(t.at) });
  }
  return { endpoint, times: times.sort((a, b) => a.at - b.at) };
}

/** Sends one empty push (the service worker wakes and looks for itself). Resolves the push service's status. */
export async function sendPush(endpoint, vapid, sub, fetcher = fetch) {
  const aud = new URL(endpoint).origin;
  const res = await fetcher(endpoint, { method: 'POST', headers: { TTL: String(12 * 3600), Urgency: 'high', 'Content-Length': '0', Authorization: `vapid t=${await vapid.token(aud, sub)}, k=${vapid.pub}` } });
  return res.status;
}

