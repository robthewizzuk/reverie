// Gmail and Google Calendar for Reverie: Google sign-in, and a few small calls to Google on the page's behalf. It runs
// in the same two places as turn.js (the Vite dev server and the Cloudflare Worker), with the client secret read from
// the environment (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET), never in the page.
//
// Nothing is stored on a server. After sign-in, the Google tokens go into one cookie, encrypted (AES-GCM, with a key
// made from GOOGLE_COOKIE_KEY or else the client secret) and HttpOnly, so the page's own scripts can't read it either.
// Signing out revokes the tokens at Google and clears the cookie.
//
// The permissions asked for, and nothing more:
//   gmail.readonly   read and search email
//   gmail.compose    write drafts, and send a draft (only ever after a tap on Yes on the page)
//   calendar.events  see and add events (adding only ever after a tap on Yes on the page)
//
//   GET  /api/google/connect     -> Google's consent page (opened in a popup by the page)
//   GET  /api/google/callback    <- Google sends the person back here; the tokens go into the cookie
//   GET  /api/google/status      -> { ready, connected, email, can: { mail, drafts, calendar } }
//   POST /api/google/disconnect
//   POST /api/google/agenda      { from, to }                    -> { events: [{ id, title, start, end, allDay, where }] }
//   POST /api/google/add_event   { title, start, end, allDay, where, notes, timeZone } -> { id, title, start, end }
//   POST /api/google/mail_search { q, max }                      -> { mails: [{ id, threadId, from, subject, date, snippet, unread }] }
//   POST /api/google/mail_read   { id }                          -> { id, threadId, from, to, subject, date, body }
//   POST /api/google/draft       { replyTo, to, subject, body }  -> the draft as Google keeps it: { draftId, to, subject, body }
//   POST /api/google/draft_get   { id }                          -> the same
//   POST /api/google/send        { draftId }                     -> { sent: true }

export const SCOPES = {
  mail: 'https://www.googleapis.com/auth/gmail.readonly',
  drafts: 'https://www.googleapis.com/auth/gmail.compose',
  calendar: 'https://www.googleapis.com/auth/calendar.events',
};
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth', TOKEN = 'https://oauth2.googleapis.com/token', REVOKE = 'https://oauth2.googleapis.com/revoke';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me', CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary';
const COOKIE = 'reverie_google', STATE = 'reverie_google_state';
const KEEP_DAYS = 180;              // the sign-in cookie lasts this long (Google's refresh token inside lasts until revoked)
const MAX_BODY = 20_000;            // bytes a request may send
const MAX_TEXT = 3500;              // characters of an email's text sent back (it all goes on to Claude)

const enc = new TextEncoder(), dec = new TextDecoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const utf8b64 = s => { const b = enc.encode(s); let out = ''; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(out); };
const random = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

// ---- the cookie: encrypted, so it can be kept by the browser without a database

const keys = new Map();
async function keyFor(env) {
  const secret = env.GOOGLE_COOKIE_KEY || env.GOOGLE_CLIENT_SECRET;
  if (!keys.has(secret)) {
    const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
    keys.set(secret, await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('reverie'), info: enc.encode('google sign-in cookie') },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
  }
  return keys.get(secret);
}
/** obj -> an encrypted, URL-safe string (exported for the tests). */
export async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(env), enc.encode(JSON.stringify(obj)));
  return b64url(iv) + '.' + b64url(ct);
}
/** The string back to obj, or null if it was changed, made with another key, or isn't one. */
export async function unseal(env, s) {
  try { const [iv, ct] = s.split('.'); return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64url(iv) }, await keyFor(env), unb64url(ct)))); }
  catch { return null; }
}
const cookieOf = (request, name) => (request.headers.get('cookie') || '').split(/;\s*/).find(c => c.startsWith(name + '='))?.slice(name.length + 1) || null;
const setCookie = (url, name, value, maxAge) => `${name}=${value}; Path=/api/google; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${url.protocol === 'https:' ? '; Secure' : ''}`;

// ---- checking what the page sends

const str = (v, max) => typeof v === 'string' && v.length <= max;
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
/** "Ann <ann@x.com>, bob@y.com" -> the addresses, or null if any is not an address. */
export function addresses(s) {
  if (!str(s, 2000)) return null;
  const list = s.split(/[,;]/).map(x => x.trim()).filter(Boolean).map(x => (/<([^>]+)>\s*$/.exec(x)?.[1] || x).trim());
  return list.length && list.length <= 10 && list.every(a => EMAIL.test(a)) ? list : null;
}
/** A header value: one line, no way to add a header of its own. */
const oneLine = s => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
/** Encoded for a header when it isn't plain ASCII. */
const header = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${utf8b64(s)}?=`;

// ---- reading Gmail's messages

const headerOf = (msg, name) => msg.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
const bodyText = data => { try { return dec.decode(unb64url(data)); } catch { return ''; } };
/** HTML to plain words (good enough to summarise; never shown as HTML). */
const unhtml = h => h.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
/** The words of a message: its plain text part (or its HTML part, as words), without the quoted earlier mail. */
export function textOf(payload) {
  const parts = [], walk = p => { if (!p) return; parts.push(p); (p.parts || []).forEach(walk); };
  walk(payload);
  const plain = parts.find(p => p.mimeType === 'text/plain' && p.body?.data), html = parts.find(p => p.mimeType === 'text/html' && p.body?.data);
  let t = plain ? bodyText(plain.body.data) : html ? unhtml(bodyText(html.body.data)) : '';
  const lines = [];
  for (const line of t.replace(/\r/g, '').split('\n')) {
    if (/^On .{6,200}wrote:\s*$/.test(line) || /^-{2,}\s*Original Message\s*-{2,}/i.test(line) || /^From: .+/.test(line) && lines.length > 2) break;
    if (!/^\s*>/.test(line)) lines.push(line.trimEnd());
  }
  t = lines.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '… (cut short)' : t;
}
const mailOf = m => ({
  id: m.id, threadId: m.threadId, from: headerOf(m, 'From'), to: headerOf(m, 'To'), subject: headerOf(m, 'Subject'), date: headerOf(m, 'Date'),
  snippet: (m.snippet || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'), unread: (m.labelIds || []).includes('UNREAD'),
});

/** An email as Gmail wants it (RFC 2822, base64url). Exported for the tests. */
export function rawEmail({ to, cc, subject, body, inReplyTo, references }) {
  const lines = [`To: ${oneLine(to)}`];
  if (cc) lines.push(`Cc: ${oneLine(cc)}`);
  lines.push(`Subject: ${header(oneLine(subject))}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${oneLine(inReplyTo)}`, `References: ${oneLine(references ? references + ' ' + inReplyTo : inReplyTo)}`);
  lines.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', utf8b64(String(body)).replace(/.{76}/g, '$&\r\n'));
  return b64url(enc.encode(lines.join('\r\n')));
}
const draftOf = d => ({ draftId: d.id, threadId: d.message?.threadId, to: headerOf(d.message, 'To'), cc: headerOf(d.message, 'Cc'), subject: headerOf(d.message, 'Subject'), body: textOf(d.message?.payload) });

// ---- the calendar

const eventOf = e => ({
  id: e.id, title: e.summary || '(no title)', allDay: !e.start?.dateTime,
  start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, where: e.location || '',
});
const nextDay = ymd => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

// ---- talking to Google

class SignedOut extends Error {}

/** One person's sign-in for this request: the session from the cookie, refreshed when its access token runs out. */
function sessionFor(env, url, session, f) {
  let changed = false;
  async function refresh() {
    const r = await f(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: session.r, grant_type: 'refresh_token' }) });
    const t = await r.json().catch(() => ({}));
    if (!r.ok || !t.access_token) { if (t.error === 'invalid_grant' || r.status === 400 || r.status === 401) throw new SignedOut(); throw new Error('Google sign-in did not answer'); }
    session.a = t.access_token; session.e = Date.now() + (t.expires_in || 3600) * 1000; changed = true;
  }
  /** A call to a Google API: JSON back, or an Error with Google's own words. */
  async function call(u, init = {}, again = true) {
    if (!session.a || Date.now() > session.e - 60_000) await refresh();
    const r = await f(u, { ...init, headers: { authorization: `Bearer ${session.a}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } });
    if (r.status === 401 && again) { session.a = null; return call(u, init, false); }
    const body = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) {
      const why = body?.error?.message || body?.error_description || `Google said ${r.status}`;
      throw Object.assign(new Error(r.status === 403 && /scope|permission/i.test(why) ? 'Reverie was not given that permission when you signed in' : why), { status: r.status });
    }
    return body;
  }
  /** The response, with the cookie renewed if the token was refreshed. */
  async function respond(status, body) {
    return json(status, body, changed ? { 'set-cookie': setCookie(url, COOKIE, await seal(env, session), KEEP_DAYS * 86400) } : {});
  }
  return { call, respond };
}

/** What the person was asked for and gave (Google lets them untick boxes). */
const canFrom = scope => Object.fromEntries(Object.entries(SCOPES).map(([k, s]) => [k, (scope || '').split(' ').includes(s)]));

/** The page that the popup lands on after Google: tells the page that opened it, then closes. */
const landing = (ok, why = '') => new Response(`<!doctype html><meta charset="utf-8"><title>Reverie</title>
<body style="font:16px system-ui;padding:2em;text-align:center">${ok ? 'Connected! You can close this window.' : 'Not connected: ' + why.replace(/[<>&]/g, '')}
<script>try{opener&&opener.postMessage({reverie:'google',ok:${ok}},location.origin)}catch(e){}setTimeout(function(){opener?close():location.replace('/')},${ok ? 600 : 4000})</script>`,
{ status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

/**
 * Handles /api/google/*. env carries GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. o.fetch stands in for fetch, and o.authUrl
 * for Google's consent page (the tests).
 * Returns null for any other path.
 */
export async function handleGoogle(request, env = {}, o = {}) {
  const url = new URL(request.url), f = o.fetch || fetch;
  const m = /^\/api\/google\/([a-z_]+)$/.exec(url.pathname); if (!m) return null;
  const what = m[1], ready = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const redirect = url.origin + '/api/google/callback';

  if (request.method === 'GET' && what === 'status') {
    const s = ready && await unseal(env, cookieOf(request, COOKIE) || '');
    return json(200, { ready, connected: !!s?.r, email: s?.m || '', can: canFrom(s?.s) });
  }
  if (!ready) return json(503, { error: 'Google is not set up on the server yet: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing.' });

  if (request.method === 'GET' && what === 'connect') {
    const state = random(16), verifier = random(32);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
    const to = new URL(o.authUrl || AUTH);
    to.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: Object.values(SCOPES).join(' '),
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state, code_challenge: challenge, code_challenge_method: 'S256' });
    return new Response(null, { status: 302, headers: { location: to.href, 'set-cookie': setCookie(url, STATE, await seal(env, { s: state, v: verifier }), 600), 'cache-control': 'no-store' } });
  }

  if (request.method === 'GET' && what === 'callback') {
    const st = await unseal(env, cookieOf(request, STATE) || '');
    if (url.searchParams.get('error')) return landing(false, url.searchParams.get('error') === 'access_denied' ? 'you said no on Google\'s page' : 'Google said ' + url.searchParams.get('error'));
    if (!st || st.s !== url.searchParams.get('state') || !url.searchParams.get('code')) return landing(false, 'the sign-in timed out or came from somewhere else. Try again.');
    const r = await f(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code: url.searchParams.get('code'), code_verifier: st.v, grant_type: 'authorization_code', redirect_uri: redirect }) });
    const t = await r.json().catch(() => ({}));
    if (!r.ok || !t.refresh_token) return landing(false, t.error_description || 'Google did not give a sign-in to keep. Try again.');
    const session = { r: t.refresh_token, a: t.access_token, e: Date.now() + (t.expires_in || 3600) * 1000, s: t.scope || '' };
    if (canFrom(session.s).mail) {
      const p = await f(GMAIL + '/profile', { headers: { authorization: `Bearer ${t.access_token}` } }).then(x => x.ok ? x.json() : {}).catch(() => ({}));
      session.m = p.emailAddress || '';
    }
    const res = landing(true);
    res.headers.append('set-cookie', setCookie(url, COOKIE, await seal(env, session), KEEP_DAYS * 86400));
    res.headers.append('set-cookie', setCookie(url, STATE, '', 0));
    return res;
  }

  if (request.method !== 'POST') return json(405, { error: 'POST only' });
  // only the page itself may call these (the cookie is SameSite=Lax too)
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin && origin !== env.ALLOWED_ORIGIN) return json(403, { error: 'Forbidden' });
  const text = await request.text();
  if (text.length > MAX_BODY) return json(413, { error: 'too long' });
  let body = {}; if (text) { try { body = JSON.parse(text); } catch { return json(400, { error: 'not JSON' }); } }
  if (!body || typeof body !== 'object') return json(400, { error: 'not an object' });

  const session = await unseal(env, cookieOf(request, COOKIE) || '');
  const gone = () => json(401, { error: 'not connected', connected: false }, { 'set-cookie': setCookie(url, COOKIE, '', 0) });

  if (what === 'disconnect') {
    if (session?.r) await f(REVOKE, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: session.r }) }).catch(() => {});
    return json(200, { connected: false }, { 'set-cookie': setCookie(url, COOKIE, '', 0) });
  }
  if (!session?.r) return gone();
  const g = sessionFor(env, url, session, f), can = canFrom(session.s);
  const need = k => { if (!can[k]) throw Object.assign(new Error(`Reverie was not given permission to ${{ mail: 'read your email', drafts: 'write drafts', calendar: 'use your calendar' }[k]} when you signed in. Sign in again and tick that box.`), { status: 403 }); };
  const bad = msg => { throw Object.assign(new Error(msg), { status: 400 }); };

  try {
    switch (what) {
      case 'agenda': {
        need('calendar');
        if (!str(body.from, 40) || !str(body.to, 40) || !ISO.test(body.from) || !ISO.test(body.to)) bad('from and to must be dates and times');
        const from = new Date(body.from), to = new Date(body.to);
        if (!(to > from) || to - from > 32 * 864e5) bad('ask for up to a month at a time');
        const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '25',
          fields: 'items(id,summary,location,start,end,status)' });
        const r = await g.call(`${CAL}/events?${q}`);
        return g.respond(200, { events: (r.items || []).filter(e => e.status !== 'cancelled').map(eventOf) });
      }
      case 'add_event': {
        need('calendar');
        if (!str(body.title, 300) || !body.title.trim()) bad('title must be a few words');
        if (!str(body.start, 40) || !ISO.test(body.start) || body.end != null && (!str(body.end, 40) || !ISO.test(body.end))) bad('start and end must be dates or dates and times');
        if (['where', 'notes'].some(k => body[k] != null && !str(body[k], 2000)) || body.timeZone != null && !str(body.timeZone, 64)) bad('where, notes and timeZone must be short text');
        const allDay = !!body.allDay || /^\d{4}-\d{2}-\d{2}$/.test(body.start);
        const day = s => s.slice(0, 10), tz = body.timeZone || undefined;
        const start = allDay ? { date: day(body.start) } : { dateTime: body.start, timeZone: tz };
        let end;
        if (allDay) end = { date: body.end && day(body.end) > day(body.start) ? day(body.end) : nextDay(day(body.start)) };
        else end = { dateTime: body.end || new Date(new Date(body.start).getTime() + 3600e3).toISOString(), timeZone: tz };
        if (!allDay && !(new Date(end.dateTime) > new Date(body.start))) bad('the end must be after the start');
        const r = await g.call(`${CAL}/events`, { method: 'POST', body: JSON.stringify({ summary: body.title.trim(), location: body.where || undefined, description: body.notes || undefined, start, end }) });
        return g.respond(200, eventOf(r));
      }
      case 'mail_search': {
        need('mail');
        if (body.q != null && !str(body.q, 300)) bad('q must be a short search');
        const max = Math.max(1, Math.min(15, Math.floor(+body.max || 8)));
        const list = await g.call(`${GMAIL}/messages?${new URLSearchParams({ q: body.q || 'in:inbox', maxResults: String(max) })}`);
        const meta = new URLSearchParams([['format', 'metadata'], ...['From', 'To', 'Subject', 'Date'].map(h => ['metadataHeaders', h]), ['fields', 'id,threadId,labelIds,snippet,payload/headers']]);
        const mails = await Promise.all((list.messages || []).map(x => g.call(`${GMAIL}/messages/${encodeURIComponent(x.id)}?${meta}`)));
        return g.respond(200, { mails: mails.map(mailOf), more: (list.resultSizeEstimate || 0) > mails.length ? list.resultSizeEstimate : 0 });
      }
      case 'mail_read': {
        need('mail');
        if (!str(body.id, 100) || !/^[\w-]+$/.test(body.id)) bad('id must be an email\'s id');
        const msg = await g.call(`${GMAIL}/messages/${body.id}?format=full`);
        return g.respond(200, { ...mailOf(msg), cc: headerOf(msg, 'Cc'), body: textOf(msg.payload) });
      }
      case 'draft': {
        need('drafts');
        if (!str(body.body, 10000) || !body.body.trim()) bad('body must be the words of the email');
        if (body.subject != null && !str(body.subject, 300)) bad('subject must be short');
        let to = body.to, subject = body.subject, cc = body.cc, threadId, inReplyTo, references;
        if (body.replyTo != null) {
          if (!str(body.replyTo, 100) || !/^[\w-]+$/.test(body.replyTo)) bad('replyTo must be an email\'s id');
          need('mail');
          const q = new URLSearchParams([['format', 'metadata'], ...['From', 'Reply-To', 'Subject', 'Message-ID', 'References'].map(h => ['metadataHeaders', h])]);
          const orig = await g.call(`${GMAIL}/messages/${body.replyTo}?${q}`);
          threadId = orig.threadId; inReplyTo = headerOf(orig, 'Message-ID'); references = headerOf(orig, 'References');
          to ||= headerOf(orig, 'Reply-To') || headerOf(orig, 'From');
          const s = headerOf(orig, 'Subject'); subject ||= /^re:/i.test(s) ? s : 'Re: ' + s;
        }
        if (!addresses(to)) bad('to must be one or more email addresses');
        if (cc && !addresses(cc)) bad('cc must be email addresses');
        const raw = rawEmail({ to, cc, subject: subject || '(no subject)', body: body.body, inReplyTo, references });
        const d = await g.call(`${GMAIL}/drafts`, { method: 'POST', body: JSON.stringify({ message: { raw, ...(threadId ? { threadId } : {}) } }) });
        const full = await g.call(`${GMAIL}/drafts/${d.id}?format=full`);
        return g.respond(200, draftOf(full));
      }
      case 'draft_get': {
        need('drafts');
        if (!str(body.id, 100) || !/^[\w-]+$/.test(body.id)) bad('id must be a draft\'s id');
        return g.respond(200, draftOf(await g.call(`${GMAIL}/drafts/${body.id}?format=full`)));
      }
      case 'send': {
        need('drafts');
        if (!str(body.draftId, 100) || !/^[\w-]+$/.test(body.draftId)) bad('draftId must be a draft\'s id');
        const r = await g.call(`${GMAIL}/drafts/send`, { method: 'POST', body: JSON.stringify({ id: body.draftId }) });
        return g.respond(200, { sent: true, id: r.id, threadId: r.threadId });
      }
      default: return json(404, { error: 'Not found' });
    }
  } catch (e) {
    if (e instanceof SignedOut) return gone();
    return g.respond(e.status && e.status < 500 ? e.status : 502, { error: String(e.message || e).slice(0, 300) });
  }
}
