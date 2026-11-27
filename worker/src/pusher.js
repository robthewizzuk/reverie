// The Durable Objects behind /api/push (push.js has the pure parts). One Pusher for each browser that allowed
// notifications holds its reminders' times and wakes itself (an alarm) at the next one, to send it an empty push. One
// more, named "vapid", made its signing key the first time it was asked (no secret to set up): the private half never
// leaves it.
import { DurableObject } from 'cloudflare:workers';
import { b64url, makeVapid, vapidToken, checkSync, sendPush } from './push.js';

const enc = new TextEncoder();
const sha = async s => b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));

/** One browser's times (or, named "vapid", the signing key). */
export class Pusher extends DurableObject {
  async _vapid() {
    let k = await this.ctx.storage.get('vapid');
    if (!k) { k = await makeVapid(); await this.ctx.storage.put('vapid', k); }
    return k;
  }
  /** The public key, made the first time ("vapid" only). */
  async key() { return (await this._vapid()).pub; }
  /** A signed token for a push service ("vapid" only). */
  async token(aud, sub) { return vapidToken((await this._vapid()).jwk, aud, sub); }
  /** This browser's times now (all of them, replacing the last list). An empty list forgets the browser. */
  async sync({ endpoint, times, from }) {
    if (!times.length) { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); return 0; }
    await this.ctx.storage.put({ endpoint, times, from, tries: 0 });
    await this.ctx.storage.setAlarm(times[0].at);
    return times.length;
  }
  async alarm() {
    const { endpoint, times = [], from, tries = 0 } = Object.fromEntries(await this.ctx.storage.get(['endpoint', 'times', 'from', 'tries']));
    if (!endpoint || !times.length) return;
    const now = Date.now(), due = times.filter(t => t.at <= now + 15e3), left = times.filter(t => t.at > now + 15e3);
    if (due.length) {
      const keys = this.env.PUSH.get(this.env.PUSH.idFromName('vapid'));
      const vapid = { pub: await keys.key(), token: (aud, sub) => keys.token(aud, sub) };
      let status = 0;
      try { status = await sendPush(endpoint, vapid, from); } catch (e) { console.log('push failed', String(e)); }
      if (status === 404 || status === 410) { await this.ctx.storage.deleteAll(); return; }   // (they unsubscribed, or the browser was reset)
      if (!(status >= 200 && status < 300) && tries < 3) { await this.ctx.storage.put('tries', tries + 1); await this.ctx.storage.setAlarm(now + 60e3 * (tries + 1)); return; }
      if (!(status >= 200 && status < 300)) console.log('push gave up', status);
    }
    if (!left.length) { await this.ctx.storage.deleteAll(); return; }
    await this.ctx.storage.put({ times: left, tries: 0 });
    await this.ctx.storage.setAlarm(left[0].at);
  }
}

/** GET /api/push: the public key ({ key }). POST /api/push: { subscription, times } → { ok, times }. */
export async function handlePush(request, env) {
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (!env.PUSH) return json({ error: 'push is not set up here' }, 404);
  const keys = env.PUSH.get(env.PUSH.idFromName('vapid'));
  if (request.method === 'GET') return json({ key: await keys.key() });
  if (request.method !== 'POST') return json({ error: 'GET or POST' }, 405);
  const text = await request.text();
  if (text.length > 16000) return json({ error: 'too big' }, 413);
  let o; try { o = JSON.parse(text); } catch { return json({ error: 'not JSON' }, 400); }
  const c = checkSync(o); if (c.error) return json({ error: c.error }, 400);
  // (the VAPID "sub": where the push service can reach whoever runs this, the page's own address)
  const from = new URL(request.url).origin;
  const n = await env.PUSH.get(env.PUSH.idFromName('sub:' + await sha(c.endpoint))).sync({ endpoint: c.endpoint, times: c.times, from });
  return json({ ok: true, times: n });
}
