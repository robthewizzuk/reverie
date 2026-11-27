// The toys in src/fun.js, against the scripted Claude (REVERIE_FAKE=1): makes a prop and smashes it into real pieces
// (gs.destruction) that land on the rug and fade, slices another in two, puts on fireworks and bubbles (gs.fx3d), and
// shakes and tilts the phone (gs.device, with made-up sensor events): Reverie gets dizzy, things on the floor jump,
// Claude hears of it, and a tilt leans the stage's gravity. Pictures in tests/out/fun-*.png.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/fun.mjs [url]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5179/?debug';
mkdirSync('tests/out', { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => { errors.push(String(e)); console.log('  pageerror:', e.stack?.split('\n').slice(0, 4).join(' | ')); });
page.on('console', m => { if (m.type() === 'error' || /\[reverie\] (smash|could not break)/.test(m.text())) console.log('  page:', m.text().slice(0, 300)); });
const shot = name => page.screenshot({ path: `tests/out/fun-${name}.png` });
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const say = async text => { await page.fill('#say', text); await page.press('#say', 'Enter'); };
const quiet = () => page.waitForFunction(() => { const r = window.__reverie; return !r.brain.busy && !r.brain.speaking; }, null, { timeout: 90000 }).catch(() => fail('did not go quiet'));
const result = re => page.waitForFunction(src => window.__reverie.brain.history.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result' && new RegExp(src).test(b.content))), re.source, { timeout: 90000 }).then(() => true, () => false);
const lastResult = () => page.evaluate(() => { const h = window.__reverie.brain.history; for (let i = h.length - 1; i >= 0; i--) { const m = h[i]; if (Array.isArray(m.content)) { const b = m.content.find(b => b.type === 'tool_result'); if (b) return b.content; } } return ''; });

// (this Chromium has the motion permission ask that iPhones have: say yes, as a person tapping Allow would)
await page.addInitScript(() => { for (const E of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) if (E) E.requestPermission = async () => 'granted'; });
await page.goto(url);
await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 90000 });
await page.click('#wake');
await page.waitForTimeout(500);
await quiet();

// ---- smash
await say('make me a teapot');
if (!await result(/^Made/)) fail('nothing was made');
await quiet();
const t0 = Date.now();
await say('smash it');
if (!await result(/^(Smashed|.* went up in a puff)/)) fail('smash gave no result');
console.log('smash:', (await lastResult()).slice(0, 160), `(${Date.now() - t0} ms to the result)`);
const bits = await page.evaluate(() => window.__reverie.world.floorBodies().length);
if (bits < 4) fail(`only ${bits} pieces on the floor`);
await page.waitForTimeout(1200);
await shot('1-smashed');
const ys = await page.evaluate(() => window.__reverie.world.floorBodies().map(b => +b.pos.y.toFixed(2)));
console.log('pieces at heights:', ys.join(' '));
// (a piece's place is its mesh's origin, not its middle, so a few centimetres under the floor is still on it)
if (ys.some(y => y < -.3 || y > 1.5)) fail('pieces fell through the floor or flew off');
if (!/some broken bits/.test(await page.evaluate(() => window.__reverie.world.scene()))) fail('Claude is not told about the broken bits');
await quiet();

// ---- slice
await say('make me a watermelon');
await result(/^Made a.*watermelon|^Made/);
await quiet();
await say('slice it');
if (!await result(/^Sliced/)) fail('slice gave no result');
await page.waitForTimeout(1200);
await shot('2-sliced');
await quiet();

// ---- shows
await say('fireworks');
if (!await result(/^Six little fireworks/)) fail('no fireworks');
await page.waitForTimeout(1500);
await shot('3-fireworks');
await quiet();
await say('bubbles');
if (!await result(/^Bubbles/)) fail('no bubbles');
await page.waitForTimeout(1500);
await shot('4-bubbles');
await quiet();

// ---- the phone: shakes and a tilt, from made-up sensor events
const motion = (x, y, z) => page.evaluate(([x, y, z]) => { const e = new Event('devicemotion'); e.accelerationIncludingGravity = { x, y, z }; e.acceleration = null; e.rotationRate = null; e.interval = 16; dispatchEvent(e); }, [x, y, z]);
await say('make me a ball'); await result(/^Made/); await quiet();
await say('throw it'); await quiet();
const before = await page.evaluate(() => window.__reverie.world.floorBodies().map(b => b.pos.y));
for (let i = 0; i < 8; i++) { await motion(i % 2 ? 30 : -30, 9.8, 0); await page.waitForTimeout(280); }
await page.waitForTimeout(150);
const jumped = await page.evaluate(() => window.__reverie.world.floorBodies().map(b => b.pos.y));
if (!jumped.some((y, i) => y > (before[i] ?? 0) + .03)) fail('nothing on the floor jumped when shaken');
await shot('5-dizzy');
if (!await page.waitForFunction(() => window.__reverie.brain.history.some(m => typeof m.content === 'string' && /\[phone\] They just shook/.test(m.content)), null, { timeout: 20000 }).then(() => true, () => false)) fail('Claude never heard about the shake');
await quiet();
// a tilt: the first reading is how it is held, then the right side goes down
const orient = (beta, gamma) => page.evaluate(([beta, gamma]) => { const e = new Event('deviceorientation'); e.alpha = 0; e.beta = beta; e.gamma = gamma; dispatchEvent(e); }, [beta, gamma]);
await orient(60, 0); await page.waitForTimeout(300);
await orient(60, 20); await page.waitForTimeout(600);
const g = await page.evaluate(() => { const w = window.__reverie.world.physics.world.gravity; return { x: w.x, y: w.y, z: w.z }; });
console.log('gravity while tilted:', JSON.stringify(g));
if (!(g.x > 1)) fail('tilting right did not lean gravity right');
// held still at that angle, it comes back upright
// (frames are few and far between in a software-drawn test page, and the tilt eases by frame time: keep holding up to 40 s)
let g2 = g.x;
for (let i = 0; i < 80 && Math.abs(g2) > Math.abs(g.x) * .5; i++) { await orient(60, 20); await page.waitForTimeout(500); g2 = await page.evaluate(() => window.__reverie.world.physics.world.gravity.x); }
console.log('gravity after holding still:', g2.toFixed(2));
if (Math.abs(g2) > Math.abs(g.x) * .5) fail('held still, gravity did not come back upright');

await say('clear');
await quiet();
if (await page.evaluate(() => window.__reverie.world.floorBodies().length)) fail('clear left bits on the floor');
if (errors.length) fail('page errors: ' + errors.join(' | '));
await browser.close();
if (!process.exitCode) console.log('fun test passed');
