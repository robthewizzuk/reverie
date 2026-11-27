// Prop motion test (src/motion.js): a new prop pops into its hands (from nothing, past full size, back), one set down
// squashes onto its spot and springs back, a tapped one rocks, a fan's blades turn and a ghost bobs by themselves,
// saved things pop back in one after another after a reload, and cleared things shrink away before they go. Nothing
// springs once all is at rest. Time is stepped by hand (world.update) so the curves are the same on a slow software GPU.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/motion.mjs [url]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5179/';
mkdirSync('tests/out', { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
await page.route('**/api.bigdatacloud.net/**', r => r.fulfill({ json: {} }));
await page.route('**/api.open-meteo.com/**', r => r.fulfill({ json: {} }));
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') console.log('  page:', m.text().slice(0, 300)); });
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const R = (fn, arg) => page.evaluate(fn, arg);
const quiet = () => page.waitForFunction(() => !window.__reverie.brain.busy && !window.__reverie.world.walking, null, { timeout: 120000 });

async function open() {
  await page.waitForFunction(() => window.__reverie?.world, null, { timeout: 180000 });
  await page.waitForSelector('#wake:not([hidden])', { timeout: 90000 });
  await page.click('#wake'); await quiet();
}
await page.goto(url);
await page.waitForFunction(() => window.__reverie?.world, null, { timeout: 180000 });
await R(() => localStorage.removeItem('reverie.room.v1'));
await page.reload(); await open();

// steps the world by hand n times (dt each) and records what fn(world) says after each
const trace = (src, n = 60, dt = 1 / 60) => R(([src, n, dt]) => {
  const w = window.__reverie.world, f = new Function('w', 'return ' + src), out = [];
  for (let i = 0; i < n; i++) { w.update(dt); out.push(f(w)); }
  return out;
}, [src, n, dt]);
const r2 = x => Math.round(x * 100) / 100;

// 1. pops into its hands
await R(() => window.__reverie.world.make('a teapot'));
const popY = await trace('w.held.pivot.userData.flex.scale.y', 70);
console.log('pop (height):', popY.filter((_, i) => i % 5 === 0).map(r2).join(' '));
if (!(popY[0] < .6)) fail('it did not start small: ' + popY[0]);
if (!(Math.max(...popY) > 1.05)) fail('it did not overshoot as it popped: ' + Math.max(...popY));
if (Math.abs(popY.at(-1) - 1) > .02) fail('it did not settle at full size: ' + popY.at(-1));

// 2. set down on the shelf: it squashes onto it, springs back, and is still
await R(() => window.__reverie.world.place({ item: 'it', spot: 'on the shelf' })); await quiet();
const kept = await R(() => window.__reverie.world.kept.length);
if (kept !== 1) fail('the teapot was not kept: ' + kept);
const land = await R(() => { const w = window.__reverie.world, e = w.kept[0]; w.motion.land(e); const out = []; for (let i = 0; i < 70; i++) { w.update(1 / 60); out.push(e.pivot.userData.flex.scale.y); } return out; });
console.log('land (height):', land.filter((_, i) => i % 5 === 0).map(r2).join(' '));
if (!(Math.min(...land) < .9)) fail('it did not squash as it landed: ' + Math.min(...land));
if (Math.abs(land.at(-1) - 1) > .03) fail('it did not spring back: ' + land.at(-1));

// 3. tapped: it rocks
const tapped = await R(() => {
  const w = window.__reverie.world, e = w.kept[0], v = w.view, p = e.pivot.getWorldPosition(new e.pivot.position.constructor());
  w.update(1 / 60); p.project(v.cam);
  const c = document.querySelector('canvas').getBoundingClientRect();
  return { x: (p.x + 1) / 2 * c.width, y: (1 - p.y) / 2 * c.height };
});
const hit = await R(({ x, y }) => window.__reverie.world.tap(x, y), tapped);
const rock = await trace('Math.hypot(w.kept[0].pivot.userData.flex.rotation.x, w.kept[0].pivot.userData.flex.rotation.z)', 90);
console.log('tap:', hit, 'rock:', rock.filter((_, i) => i % 6 === 0).map(r2).join(' '));
if (hit !== 'thing') fail('tapping the teapot did not hit it: ' + hit);
if (!(Math.max(...rock) > .1)) fail('it did not rock when tapped');

// 4. their own small movements: a fan's blades turn, a ghost bobs
await R(() => window.__reverie.world.make('a desk fan'));
const fan = await R(() => {
  const w = window.__reverie.world, L = w.held.life; if (!L?.parts?.length) return null;
  const m = L.parts[0], ax = m.userData.axis, a0 = m.rotation[ax]; for (let i = 0; i < 30; i++) w.update(1 / 60); return { turned: m.rotation[ax] - a0, spin: L.spin };
});
console.log('fan:', JSON.stringify(fan));
if (!fan || !(Math.abs(fan.turned) > .5)) fail('the fan\'s blades did not turn by themselves');
await R(() => window.__reverie.world.make('a ghost'));
const bob = await trace('w.held.pivot.userData.thing.position.y', 120);
console.log('ghost bob range:', r2((Math.max(...bob) - Math.min(...bob)) * 100), 'cm');
if (!(Math.max(...bob) - Math.min(...bob) > .003)) fail('the ghost did not bob');
await page.screenshot({ path: 'tests/out/motion-1-ghost.png' });

// 5. after a reload, the kept teapot pops back in
await page.reload(); await page.waitForFunction(() => window.__reverie?.world?.kept?.length === 1, null, { timeout: 180000 }).catch(() => fail('the teapot did not come back'));
const back = await R(() => { const w = window.__reverie.world, e = w.kept[0]; return { springing: !!e.flexing, y: e.pivot.userData.flex.scale.y }; });
console.log('back after reload:', JSON.stringify(back));
await open();
const restY = await R(() => window.__reverie.world.kept[0].pivot.userData.flex.scale.y);
if (Math.abs(restY - 1) > .02) fail('the teapot did not finish popping back in: ' + restY);

// 6. cleared: it swells a touch and shrinks away, then it has gone
await R(() => window.__reverie.world.make('a red ball'));
const going = await R(() => {
  const w = window.__reverie.world, e = w.held, out = [];
  for (let i = 0; i < 60; i++) w.update(1 / 60);   // (popped in fully first)
  w.clear({ room: true }); const there = !!e.pivot.parent;
  for (let i = 0; i < 60; i++) { w.update(1 / 60); out.push(e.pivot.parent ? e.pivot.userData.flex.scale.y : -1); }
  return { there, out, kept: w.kept.length };
});
console.log('vanish (height):', going.out.filter((_, i) => i % 4 === 0).map(r2).join(' '));
if (!going.there) fail('it went at once, without shrinking away');
if (!(Math.max(...going.out) > 1.04)) fail('it did not swell before it went');
if (going.out.at(-1) !== -1) fail('it was still there after a second');
if (going.kept !== 0) fail('the room was not cleared');

// 7. all at rest: nothing springs
const busy = await R(() => { const w = window.__reverie.world; for (let i = 0; i < 120; i++) w.update(1 / 30); return w.motion.busy; });
if (busy) fail(busy + ' things still springing at rest');

if (errors.length) fail('page errors: ' + errors.join(' | '));
console.log(process.exitCode ? 'motion test FAILED' : 'motion test passed');
await browser.close();
