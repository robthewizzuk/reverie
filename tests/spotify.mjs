// Spotify against a pretend Spotify (every call to Spotify is answered here): coming back from the sign-in page
// swaps the code for tokens, "play music ..." searches and plays on their phone (the page's own player isn't loaded
// here), the line Claude reads says what is playing, and pause works. Uses the scripted Claude:
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/spotify.mjs [origin]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const origin = process.argv[2] || 'http://127.0.0.1:5179';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
let fails = 0; const fail = msg => { console.error('FAIL:', msg); fails++; };
const calls = [], errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' || /\[reverie\] spotify/.test(m.text())) console.log('  page:', m.text().slice(0, 200)); });
await page.route('**/api.bigdatacloud.net/**', r => r.abort());
await page.route('**/api.open-meteo.com/**', r => r.abort());
await page.route('**/sdk.scdn.co/**', r => r.abort());   // (no player in the page: it plays on their phone)
await page.route('https://accounts.spotify.com/api/token', async r => {
  const body = new URLSearchParams(r.request().postData()); calls.push('token ' + body.get('grant_type') + ' ' + (body.get('code_verifier') ? 'with verifier' : ''));
  r.fulfill({ json: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 } });
});
let playing = null;
await page.route('https://api.spotify.com/v1/**', async r => {
  const u = new URL(r.request().url()), m = r.request().method(), p = u.pathname.replace('/v1', '');
  calls.push(`${m} ${p}${u.search}`);
  if (r.request().headers().authorization !== 'Bearer AT') return r.fulfill({ status: 401, json: { error: { status: 401, message: 'bad token' } } });
  const track = { name: 'Shake It Off', uri: 'spotify:track:1', artists: [{ name: 'Taylor Swift' }], album: { uri: 'spotify:album:9' } };
  if (p === '/search') return r.fulfill({ json: { tracks: { items: [track] }, artists: { items: [{ name: 'Taylor Swift', uri: 'spotify:artist:5' }] }, playlists: { items: [] }, albums: { items: [] } } });
  if (p === '/me/player/devices') return r.fulfill({ json: { devices: [{ id: 'phone', name: "Rob's iPhone", is_active: true }] } });
  if (p === '/me/player/play') { playing = JSON.parse(r.request().postData() || '{}'); return r.fulfill({ status: 204 }); }
  if (p === '/me/player/pause') { playing = null; return r.fulfill({ status: 204 }); }
  if (p === '/me/player') return playing ? r.fulfill({ json: { is_playing: true, item: track, device: { id: 'phone', name: "Rob's iPhone" } } }) : r.fulfill({ status: 204 });
  r.fulfill({ status: 404, json: { error: { message: 'not here' } } });
});

// back from Spotify's page with a code (as if connect() had sent them there)
await page.goto(origin + '/');
await page.evaluate(() => sessionStorage.setItem('reverie.spotify.pkce', JSON.stringify({ verifier: 'v'.repeat(64), state: 'st8' })));
await page.goto(origin + '/?debug&code=CODE&state=st8');
await page.waitForFunction(() => window.__reverie?.music?.spotify.signedIn, null, { timeout: 180000 }).catch(() => fail('not signed in after coming back'));
if (/code=/.test(page.url())) fail('the code is still in the address: ' + page.url());
if (!calls.some(c => /token authorization_code with verifier/.test(c))) fail('no token swap: ' + calls.join(' | '));
await page.waitForSelector('#wake:not([hidden])', { timeout: 90000 });
await page.click('#wake');
await page.fill('#say', 'play music taylor swift'); await page.press('#say', 'Enter');
await page.waitForFunction(() => /Shake It Off/.test(window.__reverie.music.line()), null, { timeout: 30000 }).catch(() => fail('nothing playing'));
const line = await page.evaluate(() => window.__reverie.music.line());
console.log('line:', line);
if (!playing || playing.context_uri !== 'spotify:artist:5') fail('did not play the artist: ' + JSON.stringify(playing));
if (!calls.some(c => /PUT \/me\/player\/play\?device_id=phone/.test(c))) fail('not played on the phone');
const hist = await page.evaluate(() => JSON.stringify(window.__reverie.brain.history));
if (!/Playing songs by Taylor Swift on Rob's iPhone/.test(hist)) fail('Claude was not told: ' + hist.slice(-400));
await page.waitForSelector('#music:not([hidden]) [data-id="toggle"]:not([hidden])', { timeout: 10000 }).catch(() => fail('no now-playing pill'));
await page.screenshot({ path: 'tests/out/spotify.png' });
// "Reverie, ..." gets through while music plays; a lyric doesn't
const gate = await page.evaluate(() => [window.__reverie.music.heardOk("'cause the players gonna play play play"), window.__reverie.music.heardOk('Reverie what song is this'), window.__reverie.music.heardOk('pause')]);
if (gate.join() !== 'false,true,true') fail('lyric gate: ' + gate);
await page.click('#music [data-id="toggle"]');
await page.waitForTimeout(800);
if (playing) fail('pause did not pause');
if (errors.length) fail('page errors: ' + errors.join(' | '));
console.log('calls:', calls.join(' | '));
await browser.close();
console.log(fails ? `${fails} failed` : 'spotify: all passed');
process.exit(fails ? 1 : 0);
