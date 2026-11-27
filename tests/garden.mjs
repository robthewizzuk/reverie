// Windowsill garden test: three pots on the sill under the round window. Plants a sunflower and a tulip by asking,
// and a surprise seed by tapping an empty pot; moves time on (days) to see them sprout, bud and flower; leaves them dry
// until they droop; waters them with a tap (a little rain cloud) and they perk up; picks a flower into its hands; and
// after a reload the garden is still there. Claude is told about it each turn. Pictures in tests/out/garden-*.png.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/garden.mjs [--gl] [url]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const argv = process.argv.slice(2), gl = argv.includes('--gl');
const url = argv.find(a => !a.startsWith('--')) || 'http://localhost:5179/';
mkdirSync('tests/out', { recursive: true });
const icd = join(dirname(chromium.executablePath()), 'vk_swiftshader_icd.json');
const browser = await chromium.launch(gl ? { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] }
  : { args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--use-angle=vulkan', '--enable-features=Vulkan'], env: { ...process.env, VK_ICD_FILENAMES: icd } });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
await page.route('**/api.bigdatacloud.net/**', r => r.fulfill({ json: {} }));
await page.route('**/api.open-meteo.com/**', r => r.fulfill({ json: {} }));
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') console.log('  ' + m.text().slice(0, 300)); });
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const R = (fn, arg) => page.evaluate(fn, arg);
const quiet = () => page.waitForFunction(() => !window.__reverie.brain.busy && !window.__reverie.brain.speaking, null, { timeout: 90000 });
async function say(text) { await page.fill('#say', text); await page.press('#say', 'Enter'); await page.waitForTimeout(400); await quiet(); }
const run = s => R(s => { const { world, garden } = window.__reverie; for (let i = 0; i < s * 20; i++) { world.update(.05); garden.update(.05); } }, s);
const pots = () => R(() => window.__reverie.garden.plants.pots.map(p => p && { kind: p.kind, name: p.name, g: +p.g.toFixed(2), water: +p.water.toFixed(2), dry: +p.dry.toFixed(1) }));
// a seat close to the sill, and back to the usual one
const seat = s => R(s => { const w = window.__reverie.world, v = w.view; w.__draw ||= w.draw; w.draw = s ? c => { v.cam.position.set(...s[0]); v.cam.lookAt(...s[1]); w.__draw(c); } : w.__draw; }, s);
const CLOSE = [[-.3, 1.4, -.25], [-.3, 1.27, -1.53]];
async function shot(name, s = CLOSE) { await seat(s); await page.waitForTimeout(1500); await page.screenshot({ path: `tests/out/garden-${name}.png` }); console.log('saved', `tests/out/garden-${name}.png`); }

async function open(fresh) {
  await page.goto(url);
  await page.waitForFunction(() => window.__reverie?.garden, null, { timeout: 180000 });
  if (fresh) { await R(() => localStorage.removeItem('reverie.garden.v1')); await page.reload(); await page.waitForFunction(() => window.__reverie?.garden, null, { timeout: 180000 }); }
  await page.waitForSelector('#wake:not([hidden])', { timeout: 120000 });
  await R(() => { window.__reverie.world.daylight.set({ time: 'afternoon', weather: 'clear' }); document.querySelector('#caption').style.display = 'none'; });
  await page.click('#wake');
  await quiet();
}
await open(true);
if (!/three empty pots/.test(await R(() => window.__reverie.world.scene()))) fail('Claude is not told about the empty pots');
await shot('0-empty');

// 1. planting by asking
await say('plant a sunflower called sunny');
await say('plant a pink tulip');
let p = await pots();
console.log('planted:', JSON.stringify(p));
if (p[0]?.kind !== 'sunflower' || p[0].name !== 'Sunny' || p[1]?.kind !== 'tulip') fail('the sunflower and tulip were not planted');

// 2. tapping the empty right pot plants a surprise seed
const xy = i => R(i => { const { world, garden } = window.__reverie, a = garden.at[i].clone(); a.y += .05; a.project(world.view.cam); const r = document.querySelector('#view').getBoundingClientRect(); return { x: r.left + (a.x + 1) / 2 * r.width, y: r.top + (1 - a.y) / 2 * r.height }; }, i);
await seat(null); await page.waitForTimeout(300);
let t = await xy(2); await page.mouse.click(t.x, t.y); await page.waitForTimeout(500);
p = await pots(); console.log('after tapping the empty pot:', p[2]?.kind);
if (!p[2]) fail('tapping an empty pot did not plant a surprise seed');

// 3. days pass, watered each day: sprouts, leaves, buds, flowers
const day = n => R(n => { const g = window.__reverie.garden; for (let d = 0; d < n; d++) { g.plants.pots.forEach((q, i) => q && g.plants.water(i)); g.skip(24); } }, n);
await day(1); await run(2); await shot('1-sprouts');
await day(2); await run(2); await shot('2-day3');
await day(3); await run(2); await shot('3-flowers');
await shot('3-flowers-front', null);
p = await pots(); console.log('after six days:', JSON.stringify(p));
if (!(p[0].g >= 1 && p[1].g >= 1)) fail('the sunflower and tulip did not flower in six days');
const line = await R(() => window.__reverie.world.scene());
console.log('Claude hears:', line.slice(line.indexOf('Your windowsill garden')));
if (!/Sunny the sunflower, in flower/.test(line)) fail('Claude is not told the sunflower is in flower');

// 4. at night the tulip closes and a glowbloom would glow
await R(() => window.__reverie.world.daylight.set({ time: 'night' })); await run(3); await shot('4-night');
await R(() => window.__reverie.world.daylight.set({ time: 'afternoon' })); await run(2);

// 5. two days dry: drooping; a tap waters it and it perks up
await R(() => window.__reverie.garden.skip(50)); await run(8);
p = await pots(); console.log('two days dry:', JSON.stringify(p));
if (!(p[0].dry > 20)) fail('it did not dry out');
await shot('5-drooping');
await seat(null); await page.waitForTimeout(300);
t = await xy(0); await page.mouse.click(t.x, t.y);
await seat(CLOSE); await run(.5); await page.screenshot({ path: 'tests/out/garden-6-raincloud.png' });
await run(4);
p = await pots(); if (!(p[0].water === 1 && p[0].dry === 0)) fail('a tap did not water the sunflower');
await shot('7-perked-up');

// 6. picking a flower puts one in its hands
await seat(null);
await say('water the plants');
await say('pick the flower');
const held = await R(() => window.__reverie.world.held?.short || null);
console.log('in its hands:', held);
if (!held) fail('picking did not put a flower in its hands');
await page.waitForTimeout(1500); await page.screenshot({ path: 'tests/out/garden-8-picked.png' });

// 7. more kinds: a daisy, a glowbloom (lit up at night) and a strawberry, grown for six days
await R(() => { const g = window.__reverie.garden; [0, 1, 2].forEach(i => g.plants.dig(i)); });
await say('plant daisies in the left pot'); await say('plant something magic called glim'); await say('plant strawberries in the right pot');
await day(6); await run(2); await shot('9-daisy-glowbloom-strawberry');
await R(() => window.__reverie.world.daylight.set({ time: 'night' })); await run(3); await shot('10-night-glow');
p = await pots(); console.log('second garden:', JSON.stringify(p.map(q => q?.kind)));
if (p.map(q => q?.kind).join() !== 'daisy,glowbloom,strawberry') fail('the second garden was not daisy, glowbloom, strawberry');

// 8. kept after a reload
await open(false);
p = await pots(); console.log('after a reload:', JSON.stringify(p));
if (p[1]?.name !== 'Glim' || !p[0] || !p[2]) fail('the garden was not kept');
if (errors.length) fail('page errors: ' + errors.join(' | ').slice(0, 600));
await browser.close();
console.log(process.exitCode ? 'garden test FAILED' : 'garden test passed');
