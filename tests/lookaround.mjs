// Looking around the room: a drag swings the camera round Reverie, a scroll and a pinch come closer, it never leaves
// the room, a tap still pokes Reverie, and the recentre button eases back to the seat. Pictures in tests/out/.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/lookaround.mjs [url]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] || 'http://localhost:5179/';
mkdirSync('tests/out', { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1, hasTouch: true });
await page.route('**/api.bigdatacloud.net/**', r => r.fulfill({ json: {} }));
await page.route('**/api.open-meteo.com/**', r => r.fulfill({ json: {} }));
page.on('pageerror', e => console.log('page error:', String(e).slice(0, 300)));
let failed = false;
const fail = m => { console.log('FAIL:', m); failed = true; };
await page.goto(url);
await page.waitForFunction(() => window.__reverie?.body, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 120000 });
await page.click('#wake'); await page.waitForTimeout(1500);
const cam = () => page.evaluate(() => { const c = window.__reverie.world.view.cam.position; return { x: +c.x.toFixed(3), y: +c.y.toFixed(3), z: +c.z.toFixed(3), off: window.__reverie.world.look.offsets, button: !document.querySelector('#recentre').hidden }; });
const settle = () => page.waitForTimeout(2500);
const backHome = () => page.waitForFunction(() => { const o = window.__reverie.world.look.offsets; return Math.abs(o.yaw) + Math.abs(o.pitch) + Math.abs(o.zoom - 1) < .01; }, null, { timeout: 30000, polling: 250 }).catch(() => fail('did not ease back'));
const home = await cam(); console.log('home:', JSON.stringify(home));
if (home.button) fail('the recentre button shows before looking around');
await page.screenshot({ path: 'tests/out/look-0-home.png' });

// 1. a mouse drag to the left swings the camera round to the right of Reverie
await page.mouse.move(300, 400); await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(300 - i * 15, 400 - i * 2); await page.waitForTimeout(16); }
await page.mouse.up(); await settle();
const swung = await cam(); console.log('dragged:', JSON.stringify(swung));
if (!(swung.x > home.x + .3)) fail('a drag did not swing the camera round');
if (!swung.button) fail('the recentre button did not show');
await page.screenshot({ path: 'tests/out/look-1-dragged.png' });

// 2. dragging far keeps the camera inside the room
await page.mouse.move(400, 400); await page.mouse.down();
for (let i = 1; i <= 30; i++) { await page.mouse.move(400 - i * 20, 400 + i * 10); await page.waitForTimeout(10); }
await page.mouse.up(); await settle();
const far = await cam(); console.log('dragged far:', JSON.stringify(far));
const gap = await page.evaluate(async p => { const { ROOM } = await import('/src/look.js'), { inside } = await import('/src/shell.js'); return { left: inside(p.x, p.y, p.z), want: ROOM.gap, y0: ROOM.y0, y1: ROOM.y1 }; }, far);
if (gap.left < gap.want - .01 || far.y < gap.y0 - 1e-3 || far.y > gap.y1 + 1e-3) fail(`the camera left the room (${JSON.stringify(far)}, ${gap.left.toFixed(3)} m from the wall)`);
await page.screenshot({ path: 'tests/out/look-2-far.png' });

// 3. the recentre button eases back to the seat
await page.click('#recentre');
await page.waitForFunction(h => { const c = window.__reverie.world.view.cam.position; return Math.hypot(c.x - h.x, c.y - h.y, c.z - h.z) < .02; }, home, { timeout: 30000, polling: 250 }).catch(() => {});
const back = await cam(); console.log('recentred:', JSON.stringify(back));
if (Math.hypot(back.x - home.x, back.y - home.y, back.z - home.z) > .02) fail('recentre did not come back to the seat');
if (back.button) fail('the recentre button stayed after recentring');

// 4. scrolling in comes closer
await page.mouse.move(210, 400); await page.mouse.wheel(0, -400); await settle();
const nearer = await cam(); console.log('scrolled:', JSON.stringify(nearer));
const dist = p => Math.hypot(p.x, p.y - .4, p.z);
if (!(dist(nearer) < dist(home) - .2)) fail('scrolling in did not come closer');
await page.screenshot({ path: 'tests/out/look-3-closer.png' });
await page.click('#recentre'); await backHome();

// 5. a two-finger pinch out comes closer too (touch, through the browser's own touch events)
const cdp = await page.context().newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
await touch('touchStart', [[190, 400], [230, 400]]);
for (let i = 1; i <= 10; i++) { await touch('touchMove', [[190 - i * 10, 400], [230 + i * 10, 400]]); await page.waitForTimeout(16); }
await touch('touchEnd', []); await settle();
const pinched = await cam(); console.log('pinched:', JSON.stringify(pinched));
if (!(dist(pinched) < dist(home) - .2)) fail('a pinch did not come closer');
await page.click('#recentre'); await backHome();

// 6. a tap on Reverie still pokes it (and doesn't move the camera)
const pokes0 = await page.evaluate(() => window.__reverie.body.pokes ?? null);
const at = await page.evaluate(() => { const { world, gs } = window.__reverie, v = new gs.hd.THREE.Vector3(); world.creature.root.getWorldPosition(v); v.y += .3; v.project(world.view.cam); const r = document.querySelector('#view').getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; });
const hit = await page.evaluate(({ x, y }) => { const r = document.querySelector('#view').getBoundingClientRect(); return window.__reverie.world.tap(x - r.left, y - r.top); }, at);
console.log('a tap there hits:', hit, 'pokes before:', pokes0);
let boings = 0; await page.exposeFunction('__boing', () => boings++);
await page.evaluate(() => { const b = window.__reverie.body, p = b.poke.bind(b); b.poke = () => { window.__boing(); return p(); }; });
await page.mouse.click(at.x, at.y); await page.waitForTimeout(400);
if (!boings) fail('a tap on Reverie did not poke it');
const still = await cam(); if (still.button) fail('a tap moved the camera');

await browser.close();
console.log(failed ? 'look around: FAILED' : 'look around: all good');
process.exit(failed ? 1 : 0);
