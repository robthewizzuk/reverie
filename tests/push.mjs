// The Worker's push for reminders (worker/src/push.js), in node: a VAPID key is made, the token it signs checks out
// with the public key, the page's list is checked (only real push services, only times), and the empty push carries
// the right headers.
//   node tests/push.mjs
import { makeVapid, vapidToken, checkSync, sendPush, b64url } from '../worker/src/push.js';

const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (cond, msg) => { if (!cond) fail(msg); };
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));

const k = await makeVapid();
ok(unb64(k.pub).length === 65 && unb64(k.pub)[0] === 4, 'the public key is a raw P-256 point (65 bytes), as browsers want');
ok(k.jwk.d && k.jwk.kty === 'EC', 'the private key is kept as a JWK');
const now = Date.now();
const jwt = await vapidToken(k.jwk, 'https://fcm.googleapis.com', 'https://reverie.example.workers.dev', now);
const [h, b, sig] = jwt.split('.');
const claims = JSON.parse(new TextDecoder().decode(unb64(b)));
ok(JSON.parse(new TextDecoder().decode(unb64(h))).alg === 'ES256', 'ES256');
ok(claims.aud === 'https://fcm.googleapis.com' && claims.sub === 'https://reverie.example.workers.dev' && claims.exp > now / 1000 && claims.exp <= now / 1000 + 24 * 3600, 'claims: ' + JSON.stringify(claims));
const pub = await crypto.subtle.importKey('raw', unb64(k.pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
ok(unb64(sig).length === 64, 'the signature is r and s (64 bytes), as JWS wants');
ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64(sig), new TextEncoder().encode(`${h}.${b}`)), 'the token verifies with the public key');

const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'x', auth: 'y' } };
let c = checkSync({ subscription: sub, times: [{ id: 'r1', at: now + 60e3 }, { id: 'r0', at: now + 1000 }, { id: 'old', at: now - 864e5 }] }, now);
ok(!c.error && c.times.length === 2 && c.times[0].id === 'r0', 'times sorted, old ones dropped: ' + JSON.stringify(c));
ok(!JSON.stringify(c).includes('what'), 'only times are kept');
ok(checkSync({ subscription: { endpoint: 'https://evil.example.com/x' }, times: [] }).error, 'only real push services');
ok(checkSync({ subscription: { endpoint: 'http://fcm.googleapis.com/x' }, times: [] }).error, 'https only');
ok(checkSync({ subscription: sub, times: Array.from({ length: 65 }, (_, i) => ({ id: 'r' + i, at: now + 1e5 })) }).error, 'at most 64 times');
ok(checkSync({ subscription: sub, times: [{ id: 'r', at: 'soon' }] }).error, 'times are numbers');
for (const e of ['https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/abc', 'https://wns2-par02p.notify.windows.com/w/?token=x'])
  ok(!checkSync({ subscription: { endpoint: e }, times: [] }).error, 'allowed: ' + e);

let sent = null;
const status = await sendPush(sub.endpoint, { pub: k.pub, token: (aud, s) => vapidToken(k.jwk, aud, s) }, 'https://reverie.example.workers.dev', async (url, o) => { sent = { url, ...o }; return { status: 201 }; });
ok(status === 201 && sent.url === sub.endpoint && sent.method === 'POST', 'posted to the push address');
ok(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(sent.headers.Authorization) && sent.headers.Authorization.endsWith(k.pub), 'VAPID header: ' + sent.headers.Authorization.slice(0, 40));
ok(sent.headers.TTL && sent.headers.Urgency === 'high' && !sent.body, 'an empty push, urgent, with a TTL');
ok(b64url(new Uint8Array([251, 255])) === '-_8', 'base64url');
console.log(process.exitCode ? 'push: failed' : 'push: ok');
