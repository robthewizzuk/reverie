// Show and tell: opens the camera window against the scripted Claude, with a made-up camera (a canvas, so no real
// camera is needed): Show sends one small photo with that turn, Make a copy puts a copy on the shelf, a QR code
// hatches a surprise, only the newest photos go along with a turn, and closing lets the camera go.
//   REVERIE_FAKE=1 VITE_GAMES_URL=http://localhost:5179/tests/out/games npm run dev -- --port 5179
//   (tests/out/games/ml linked to engine/ml-cache, from `node engine/scripts/fetch-ml.mjs`)   then   node tests/show.mjs [url]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const url = process.argv[2] || 'http://localhost:5179/?debug';
mkdirSync('tests/out', { recursive: true });
// a QR code reading "reverie show and tell", as its 25 rows of dark (1) and light (0) squares
const QR = [0x1fd087f, 0x1051841, 0x175cb5d, 0x174495d, 0x175445d, 0x104f541, 0x1fd557f, 0xb900, 0x13f8797, 0x1da2e3e, 0x11ff2ad, 0xc822cd, 0x84b149,
  0x111c718, 0x1e53ea7, 0x119e59c, 0x14c47f7, 0x1f914, 0x1fd2159, 0x105171b, 0x175dffb, 0x17545c3, 0x1749613, 0x104846f, 0x1fd8f19];

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-fake-ui-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1, permissions: ['camera'] });
// the camera: a canvas drawn here, showing a toy (a yellow ball on a table) or a QR code (window.__cam)
await page.addInitScript(qr => {
  window.__cam = 'toy'; window.__camStops = 0;
  const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480; const c = cv.getContext('2d');
  const paint = () => {
    c.fillStyle = '#efe8dc'; c.fillRect(0, 0, 640, 480);
    if (window.__cam === 'qr') {
      const k = 12, x0 = 320 - 12.5 * k, y0 = 240 - 12.5 * k;
      c.fillStyle = '#fff'; c.fillRect(x0 - 4 * k, y0 - 4 * k, 33 * k, 33 * k); c.fillStyle = '#000';
      qr.forEach((row, y) => { for (let x = 0; x < 25; x++) if (row >> (24 - x) & 1) c.fillRect(x0 + x * k, y0 + y * k, k, k); });
    } else {
      c.fillStyle = '#8a6a4a'; c.fillRect(0, 330, 640, 150);
      c.fillStyle = '#f2c230'; c.beginPath(); c.arc(320, 250, 90, 0, Math.PI * 2); c.fill();
    }
  };
  paint(); setInterval(paint, 100);
  navigator.mediaDevices.getUserMedia = async () => {
    const s = cv.captureStream(15);
    for (const t of s.getTracks()) { const stop = t.stop.bind(t); t.stop = () => { window.__camStops++; stop(); }; }
    return s;
  };
}, QR);
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' || /\[reverie\]/.test(m.text())) console.log('  page:', m.text().slice(0, 220)); });
// every turn sent to Claude: how many photos it carried
const sent = [];
page.on('request', r => { if (r.url().endsWith('/api/turn')) { const b = JSON.parse(r.postData() || '{}'); sent.push((b.messages || []).flatMap(m => Array.isArray(m.content) ? m.content : []).filter(x => x.type === 'image').length); } });
const shot = name => page.screenshot({ path: `tests/out/show-${name}.png` });
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const idle = () => page.waitForFunction(() => !window.__reverie.brain.busy && !window.__reverie.brain.speaking, null, { timeout: 120000 });

await page.goto(url);
await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 60000 });
await page.click('#wake');
await page.waitForTimeout(500);

// Claude opens the camera window
await page.fill('#say', 'show me something'); await page.press('#say', 'Enter');
await page.waitForFunction(() => window.__reverie.show.open && window.__reverie.show.photo(), null, { timeout: 120000 }).catch(() => fail('the camera window did not open with a picture'));
await idle();
await page.waitForTimeout(800);
await shot('1-open');

// Show: one photo goes with that turn, and Reverie answers
let n = await page.evaluate(() => window.__reverie.brain.history.length);
await page.click('#show button[data-id="show"]');
await page.waitForFunction(n => window.__reverie.brain.history.length > n + 1, n, { timeout: 60000 });
await idle();
const said = await page.evaluate(() => window.__reverie.brain.history.find(m => Array.isArray(m.content) && m.content.some(b => b.type === 'image')));
if (!said) fail('no photo in the history');
else {
  const img = said.content.find(b => b.type === 'image'), text = said.content.find(b => b.type === 'text')?.text || '';
  const kb = Math.round(img.source.data.length * 3 / 4 / 1024);
  console.log(`photo: ${kb} KB; words: ${text.slice(0, 200)}`);
  if (img.source.media_type !== 'image/jpeg' || kb < 2 || kb > 120) fail(`the photo is ${kb} KB`);
  if (!/^\[From the device/.test(text) || !/\[show\]/.test(text)) fail('the words with the photo are wrong: ' + text.slice(0, 200));
}
await shot('2-shown');

// Make a copy: Reverie carries one to the shelf
await page.click('#show button[data-id="copy"]');
await page.waitForFunction(() => (JSON.parse(localStorage.getItem('reverie.room.v1') || '{}').items || []).some(i => i.spot === 'on the shelf'), null, { timeout: 120000 })
  .catch(() => fail('no copy on the shelf'));
await idle();
await page.waitForTimeout(600);
await shot('3-copied');

// a third photo: only the newest two go along
await page.click('#show button[data-id="show"]');
await page.waitForTimeout(400); await idle();
console.log('photos sent with each turn:', sent.join(' '));
if (Math.max(...sent) > 2) fail('more than two photos were sent with a turn');
if (sent.at(-1) !== 2) fail('the newest photos were not sent');

// a QR code: a surprise hatches in its hands
await page.evaluate(() => { window.__cam = 'qr'; });
await page.waitForFunction(() => window.__reverie.show.gifts > 0 && window.__reverie.world.held, null, { timeout: 90000 }).catch(() => fail('nothing hatched from the QR code'));
await idle();
const gift = await page.evaluate(() => window.__reverie.world.held?.short);
console.log('hatched:', gift);
await shot('4-hatched');

// closing lets the camera go
await page.click('#show button[data-id="close"]');
await page.waitForTimeout(300);
const after = await page.evaluate(() => ({ open: window.__reverie.show.open, stops: window.__camStops }));
if (after.open || !after.stops) fail('the camera was not let go: ' + JSON.stringify(after));
if (errors.length) fail('page errors: ' + errors.join(' | '));
await browser.close();
console.log(process.exitCode ? 'show: failed' : 'show: ok');
