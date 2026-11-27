// Room test: makes a lamp and has Reverie carry it to the window, moves a held prop onto the shelf, paints the walls
// and the rug, then reloads and checks the room came back as it was left. Saves pictures to tests/out/room-*.png.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/room.mjs [url]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5179/?debug';
mkdirSync('tests/out', { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
await page.route('**/api.bigdatacloud.net/**', r => r.fulfill({ json: {} }));
await page.route('**/api.open-meteo.com/**', r => r.fulfill({ json: {} }));
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') console.log('  page:', m.text().slice(0, 300)); });
const shot = name => page.screenshot({ path: `tests/out/room-${name}.png` });
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const R = (fn, arg) => page.evaluate(fn, arg);
const lastResult = () => R(() => { const h = window.__reverie.brain.history; for (let i = h.length - 1; i >= 0; i--) { const c = h[i].content; if (Array.isArray(c)) { const r = c.find(b => b.type === 'tool_result'); if (r) return String(r.content); } } return ''; });

async function open() {
  await page.goto(url);
  await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
  await page.waitForSelector('#wake:not([hidden])', { timeout: 60000 });
  await page.click('#wake');
  await page.waitForTimeout(800);
}
async function ask(text, until, timeout = 120000) {
  await page.fill('#say', text); await page.press('#say', 'Enter');
  await page.waitForTimeout(400);
  await page.waitForFunction(until, null, { timeout }).catch(() => fail(`"${text}" did not finish`));
  await page.waitForTimeout(700);
}
const settled = () => !window.__reverie.brain.busy && !window.__reverie.world.walking;

await open();
await R(() => localStorage.removeItem('reverie.room.v1'));
await page.reload(); await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 60000 }); await page.click('#wake'); await page.waitForTimeout(800);

// 1. make a lamp and put it by the window: it walks there (seen mid-walk), sets it down, comes back
await page.fill('#say', 'make a lamp and put it by the window'); await page.press('#say', 'Enter');
await page.waitForFunction(() => window.__reverie.world.walking, null, { timeout: 120000 }).catch(() => fail('it never walked'));
await page.waitForTimeout(700);
await shot('1-walking');
const away = await R(() => { const p = window.__reverie.world.creature.root.position; return Math.hypot(p.x, p.z); });
if (!(away > .1)) fail('it did not leave its spot while carrying: ' + away);
await page.waitForFunction(settled, null, { timeout: 60000 }).catch(() => fail('the carry did not finish'));
await page.waitForTimeout(600);
let room = await R(() => window.__reverie.world.room);
console.log('room:', JSON.stringify(room.map(i => [i.words, i.spot, i.x, i.y, i.z])));
console.log('result:', await lastResult());
if (room.length !== 1 || room[0].spot !== 'by the window') fail('the lamp is not by the window');
const home = await R(() => { const p = window.__reverie.world.creature.root.position; return Math.hypot(p.x, p.z); });
if (home > .03) fail('it did not walk back: ' + home);
await shot('2-lamp-by-window');

// 2. a prop in its hands, then onto the shelf (kept small there)
await ask('make a red teapot', () => !!window.__reverie.world.held && !window.__reverie.brain.busy);
await ask('put it on the shelf', settled);
room = await R(() => window.__reverie.world.room);
const pot = room.find(i => i.spot === 'on the shelf');
if (!pot) fail('the teapot is not on the shelf: ' + JSON.stringify(room));
else if (pot.size > .31 || Math.abs(pot.y - 1.245) > .01) fail('the teapot on the shelf is the wrong size or height: ' + JSON.stringify(pot));
if (await R(() => !!window.__reverie.world.held)) fail('it still holds the teapot');

// 3. move the lamp somewhere else, and paint the room
await ask('move the lamp to the right of you', settled);
room = await R(() => window.__reverie.world.room);
if (!room.some(i => /lamp/.test(i.words) && i.spot === 'right of you')) fail('the lamp did not move: ' + JSON.stringify(room.map(i => [i.words, i.spot])));
if (room.length !== 2) fail('moving the lamp made a copy: ' + room.length);
await ask('paint the walls sky blue', settled);
await ask('paint the rug #3a6e4c', settled);
await page.waitForTimeout(1500);
await shot('3-painted');
const kept = await R(() => JSON.parse(localStorage.getItem('reverie.room.v1') || 'null'));
console.log('kept:', JSON.stringify(kept?.colours));
if (kept?.colours?.walls !== '#87ceeb' || kept?.colours?.rug !== '#3a6e4c') fail('the room colours were not kept');
const line = await R(() => window.__reverie.world.scene());
console.log('scene line:', line);
if (!/In the room: .*lamp.*\(right of you\)/.test(line)) fail('Claude is not told what is in the room');

// 4. clearing props keeps the room; after a reload it is all back
await ask('clear', settled);
if ((await R(() => window.__reverie.world.room)).length !== 2) fail('clear emptied the room');
await page.reload();
await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
await page.waitForFunction(() => window.__reverie.world.room.length === 2, null, { timeout: 120000 }).catch(() => fail('the room did not come back after a reload'));
await page.waitForTimeout(1500);
await shot('4-after-reload');
const walls = await R(() => { let m = null; window.__reverie.world.view.scene.traverse(o => { if (o.isMesh && o.material?.name === 'room:walls') m = o.material; }); return m && '#' + m.color.getHexString(); });
console.log('walls after reload:', walls);
if (!/87ceeb/i.test(String(walls))) fail('the wall colour did not come back');

// 5. take it back into its hands
await page.click('#wake').catch(() => {});
await ask('bring the teapot back', settled);
if (!(await R(() => !!window.__reverie.world.held))) fail('the teapot was not fetched back to its hands');
if ((await R(() => window.__reverie.world.room)).length !== 1) fail('the fetched teapot is still listed in the room');

if (errors.length) fail('page errors: ' + errors.join(' | '));
await browser.close();
console.log(process.exitCode ? 'room: failed' : 'room: ok');
