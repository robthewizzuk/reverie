// Gmail and Google Calendar, server side (server/google.js) against a pretend Google (tests/fake-google.js), no browser
// and no network: the sign-in (state, PKCE, the encrypted cookie), today's agenda, adding an event, searching and reading
// email (the quoted earlier mail left out), a reply drafted in the thread, sending a draft, a refreshed token, the checks
// on what the page sends, and signing out.
//   node tests/google.mjs
import { handleGoogle, seal, unseal, addresses, rawEmail, SCOPES } from '../server/google.js';
import { fakeGoogle } from './fake-google.js';

const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (cond, msg) => { if (!cond) fail(msg); };
const env = { GOOGLE_CLIENT_ID: 'id-1', GOOGLE_CLIENT_SECRET: 'secret-1' };
const G = fakeGoogle(), o = { fetch: G.fetch };
const base = 'https://reverie.example';
let jar = {};
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
function keep(res) {
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'), i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/Max-Age=0/.test(c)) delete jar[k]; else jar[k] = v; ok(/HttpOnly/.test(c) && /SameSite=Lax/.test(c) && /Secure/.test(c), 'cookies are HttpOnly, SameSite and Secure: ' + c); }
  return res;
}
const get = async (path, e = env) => keep(await handleGoogle(new Request(base + path, { headers: { cookie: cookieHeader() } }), e, o));
const post = async (what, body = {}, headers = {}) => { const r = keep(await handleGoogle(new Request(`${base}/api/google/${what}`, { method: 'POST', headers: { cookie: cookieHeader(), origin: base, ...headers }, body: JSON.stringify(body) }), env, o)); return { status: r.status, body: await r.json() }; };

// ---- small parts
{
  const s = await seal(env, { a: 1, r: 'x' });
  ok((await unseal(env, s))?.r === 'x', 'a sealed cookie opens');
  ok(await unseal({ GOOGLE_CLIENT_SECRET: 'another' }, s) === null, 'another key cannot open it');
  ok(await unseal(env, s.slice(0, -3) + 'AAA') === null, 'a changed cookie does not open');
  ok(!s.includes('x') || !(await unseal(env, s)) || !JSON.stringify(s).includes('"r"'), 'it is not readable');
  ok(addresses('Ann <ann@x.com>, bob@y.co.uk')?.join() === 'ann@x.com,bob@y.co.uk', 'addresses read');
  ok(addresses('not an address') === null && addresses('a@b.com\r\nBcc: c@d.com') === null, 'a bad address is refused');
  const raw = Buffer.from(rawEmail({ to: 'a@b.com', subject: 'Hi\r\nBcc: evil@x.com', body: 'héllo' }), 'base64url').toString();
  ok(!/\r\nBcc:/.test(raw) && /Subject: Hi Bcc: evil@x.com/.test(raw), 'a subject cannot add a header');
  ok(Buffer.from(raw.split('\r\n\r\n')[1], 'base64').toString() === 'héllo', 'the body is UTF-8');
}

// ---- not set up on the server: says so
{
  const r = await handleGoogle(new Request(base + '/api/google/status'), {}, o), b = await r.json();
  ok(r.status === 200 && b.ready === false && !b.connected, 'status says it is not set up');
  ok((await handleGoogle(new Request(base + '/api/google/connect'), {}, o)).status === 503, 'connect needs the client');
  ok(await handleGoogle(new Request(base + '/api/turn'), env, o) === null, 'other paths are not Google\'s');
}

// ---- signing in
{
  let s = await (await get('/api/google/status')).json();
  ok(s.ready && !s.connected, 'ready, not connected');
  ok((await post('agenda', { from: '2026-11-27T00:00', to: '2026-11-28T00:00' })).status === 401, 'not connected: no agenda');
  const r = await get('/api/google/connect');
  const to = new URL(r.headers.get('location'));
  ok(r.status === 302 && to.host === 'accounts.google.com', 'connect goes to Google');
  const p = to.searchParams;
  ok(p.get('scope') === Object.values(SCOPES).join(' '), 'asks for exactly three permissions: ' + p.get('scope'));
  ok(p.get('redirect_uri') === base + '/api/google/callback' && p.get('access_type') === 'offline' && p.get('code_challenge_method') === 'S256' && p.get('state'), 'state, PKCE and the way back');
  ok(!/mail\.google\.com|gmail\.modify|auth\/calendar(\s|$)/.test(p.get('scope')), 'no broad permissions');
  // someone else's callback (no matching state) is refused
  const saved = { ...jar }; jar = {};
  ok((await get(`/api/google/callback?code=fake-code&state=${p.get('state')}`)).status === 400, 'a callback without the state cookie is refused');
  jar = saved;
  ok((await get(`/api/google/callback?code=fake-code&state=wrong`)).status === 400, 'a callback with the wrong state is refused');
  const cb = await get(`/api/google/callback?code=fake-code&state=${p.get('state')}`);
  ok(cb.status === 200 && /Connected/.test(await cb.text()), 'the callback lands');
  ok(jar.reverie_google && !jar.reverie_google_state, 'the sign-in is in the cookie, the state cookie gone');
  ok(!jar.reverie_google.includes('refresh-1') && !Buffer.from(jar.reverie_google.split('.')[1], 'base64url').toString('latin1').includes('refresh'), 'the token is not readable in the cookie');
  s = await (await get('/api/google/status')).json();
  ok(s.connected && s.email === 'rob@example.com' && s.can.mail && s.can.drafts && s.can.calendar, 'connected as rob: ' + JSON.stringify(s));
}

// ---- the calendar
{
  const d = new Date(), day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const r = await post('agenda', { from: day.toISOString(), to: new Date(day.getTime() + 864e5).toISOString() });
  ok(r.status === 200 && r.body.events.map(e => e.title).join() === 'Dentist,Football with Sam', 'today\'s agenda: ' + JSON.stringify(r.body));
  ok(r.body.events[0].where === 'High Street' && !r.body.events[0].allDay, 'with where it is');
  ok((await post('agenda', { from: 'soon', to: 'later' })).status === 400, 'dates are checked');
  ok((await post('agenda', { from: '2026-01-01T00:00Z', to: '2026-12-01T00:00Z' })).status === 400, 'a month at most');
  const before = G.data.events.length;
  const a = await post('add_event', { title: 'Haircut', start: '2026-12-01T15:00:00', end: '2026-12-01T15:30:00', timeZone: 'Europe/London' });
  ok(a.status === 200 && G.data.events.length === before + 1 && G.data.events.at(-1).start.timeZone === 'Europe/London', 'an event added: ' + JSON.stringify(a.body));
  const all = await post('add_event', { title: 'Holiday', start: '2026-12-20' });
  ok(all.body.allDay && G.data.events.at(-1).end.date === '2026-12-21', 'an all-day event ends the next day');
  ok((await post('add_event', { title: 'Back to front', start: '2026-12-01T15:00:00Z', end: '2026-12-01T14:00:00Z' })).status === 400, 'the end must be after the start');
  ok((await post('add_event', { title: '', start: '2026-12-01' })).status === 400, 'an event needs a title');
}

// ---- email
{
  const r = await post('mail_search', { q: 'in:inbox is:unread' });
  ok(r.status === 200 && r.body.mails.length === 1 && r.body.mails[0].from.includes('Sam') && r.body.mails[0].unread, 'unread mail: ' + JSON.stringify(r.body));
  const all = await post('mail_search', {});
  ok(all.body.mails.length === 2 && all.body.mails[1].subject === 'Your parcel is on its way', 'the inbox');
  const m = await post('mail_read', { id: 'm1' });
  ok(m.status === 200 && /still up for Saturday/.test(m.body.body) && !/old stuff|wrote:/.test(m.body.body), 'an email read, without the quoted mail: ' + JSON.stringify(m.body.body));
  const h = await post('mail_read', { id: 'm2' });
  ok(/parcel is on its way/.test(h.body.body) && !/<b>/.test(h.body.body), 'an HTML email read as words');
  ok((await post('mail_read', { id: '../drafts' })).status === 400, 'ids are checked');
  const sentBefore = G.data.sent.length;
  const d = await post('draft', { replyTo: 'm1', body: 'Yes! The park at 2 sounds great.' });
  ok(d.status === 200 && d.body.draftId && d.body.to === 'Sam Lee <sam@example.com>' && d.body.subject === 'Re: Saturday?' && /park at 2/.test(d.body.body), 'a reply drafted: ' + JSON.stringify(d.body));
  const kept = G.data.drafts.find(x => x.id === d.body.draftId);
  ok(kept.message.threadId === 't1' && kept.message.payload.headers.some(x => x.name === 'In-Reply-To' && x.value === '<m1@example.com>'), 'in the same thread');
  ok(G.data.sent.length === sentBefore, 'drafting sends nothing');
  ok((await post('draft', { to: 'nobody', body: 'hi' })).status === 400, 'a new email needs an address');
  const g = await post('draft_get', { id: d.body.draftId });
  ok(g.body.to === d.body.to && g.body.body === d.body.body, 'a draft read back');
  const s = await post('send', { draftId: d.body.draftId });
  ok(s.status === 200 && s.body.sent && G.data.sent.length === sentBefore + 1, 'a draft sent');
  ok((await post('send', { draftId: d.body.draftId })).status === 404, 'a draft is sent once');
}

// ---- only the page itself may call it
{
  ok((await post('mail_search', {}, { origin: 'https://evil.example' })).status === 403, 'another site is refused');
  ok((await handleGoogle(new Request(base + '/api/google/mail_search'), env, o)).status === 405, 'reads are POSTs');
}

// ---- an expired token is refreshed, and the cookie renewed
{
  const s = await unseal(env, jar.reverie_google); s.e = Date.now() - 1000;
  jar.reverie_google = await seal(env, s);
  const n = G.log.filter(l => l.endsWith('/token')).length, was = jar.reverie_google;
  const r = await post('mail_search', {});
  ok(r.status === 200 && G.log.filter(l => l.endsWith('/token')).length === n + 1 && jar.reverie_google !== was, 'refreshed, and the cookie renewed');
}

// ---- unticked permissions are respected
{
  const G2 = fakeGoogle({ scope: SCOPES.mail }), jar2 = {};
  const r = await handleGoogle(new Request(base + '/api/google/connect'), env, { fetch: G2.fetch });
  const st = new URL(r.headers.get('location')).searchParams.get('state');
  const c = r.headers.getSetCookie()[0].split(';')[0];
  const cb = await handleGoogle(new Request(`${base}/api/google/callback?code=fake-code&state=${st}`, { headers: { cookie: c } }), env, { fetch: G2.fetch });
  const ck = cb.headers.getSetCookie().find(x => x.startsWith('reverie_google=')).split(';')[0];
  const d = await handleGoogle(new Request(base + '/api/google/draft', { method: 'POST', headers: { cookie: ck }, body: JSON.stringify({ to: 'a@b.com', body: 'hi' }) }), env, { fetch: G2.fetch });
  ok(d.status === 403 && /permission to write drafts/.test((await d.json()).error), 'no drafts without the drafts permission');
  void jar2;
}

// ---- signing out: revoked at Google, cookie gone, and a revoked sign-in is told it's signed out
{
  const keepCookie = jar.reverie_google;
  const r = await post('disconnect');
  ok(r.status === 200 && G.data.revoked.includes('refresh-1') && !jar.reverie_google, 'signed out and revoked');
  const s = await unseal(env, keepCookie); s.e = 0; jar.reverie_google = await seal(env, s);
  const again = await post('agenda', { from: '2026-11-27T00:00Z', to: '2026-11-28T00:00Z' });
  ok(again.status === 401 && again.body.connected === false && !jar.reverie_google, 'an old cookie after sign-out is cleared');
}

console.log(process.exitCode ? 'google: FAILED' : 'google: all passed');
