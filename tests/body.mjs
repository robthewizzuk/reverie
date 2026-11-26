// Body language test: wakes the creature, checks it makes idle moves on its own, perks up the moment you start
// typing, learns from pokes (the Tiny Brains Coach) in moments like the one it was poked in, and keeps that after a
// reload. Saves a few frames to tests/out/.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/body.mjs [url]
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
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const R = (fn, arg) => page.evaluate(fn, arg);

async function open() {
  await page.goto(url);
  await page.waitForFunction(() => window.__reverie?.body, null, { timeout: 180000 });
  await page.waitForSelector('#wake:not([hidden])', { timeout: 60000 });
  await page.click('#wake');
  await page.waitForFunction(() => !window.__reverie.brain.speaking, null, { timeout: 60000 });
}
await open();
await R(() => window.__reverie.body.forget());

// 1. idle moves on its own
const seen = new Set();
for (let i = 0; i < 40; i++) { const a = await R(() => window.__reverie.body.last?.act); if (a) seen.add(a); await page.waitForTimeout(500); }
console.log('idle moves chosen in 20 s:', [...seen].join(', ') || 'none');
if (!seen.size) fail('no idle moves');
await page.screenshot({ path: 'tests/out/body-1-idle.png' });

// 2. perks up the moment you type, before anything is sent
await page.focus('#say'); await page.keyboard.type('h');
const perked = await R(() => window.__reverie.world.creature.idling);
if (perked !== 'perk') fail('did not perk up on typing: ' + perked);
await page.fill('#say', '');

// 3. pokes teach it: the rules' choice for one moment, then "I liked sway" twice in that moment
const picks = (n, see) => R(([n, see]) => {
  const { body } = window.__reverie, c = {};
  for (let i = 0; i < n; i++) { const a = body.coach.pick(see, ['rest', 'glance', 'sway', 'hop', 'stretch'].sort(() => Math.random() - .5)); c[a] = (c[a] || 0) + 1; }
  return c;
}, [n, see]);
const spot = [-.2, -1, -1, -1, .3], other = [.9, 1, 1, .8, -1];
console.log('before, in one spot:', JSON.stringify(await picks(200, spot)));
await R(([spot]) => { const { body } = window.__reverie; body.coach.correct(spot, 'sway'); body.coach.correct(spot.map(x => x + .03), 'sway'); }, [spot]);
const after = await picks(200, spot), elsewhere = await picks(200, other);
console.log('after two "liked sway" there:', JSON.stringify(after));
console.log('a different moment:', JSON.stringify(elsewhere));
if ((after.sway || 0) < 150) fail('the liked move did not win in that spot');
if ((elsewhere.sway || 0) > 80) fail('the lesson leaked into an unlike moment');

// 4. a real poke right after a move counts as liking it
// (a test browser draws a few frames a second, so the creature's clock runs slow: speed it up)
await R(() => { const b = window.__reverie.body, u = b.update; b.update = dt => u(dt * 6); });
await page.waitForFunction(() => { const l = window.__reverie.body.last; return l && l.act !== 'rest' && window.__reverie.world.creature.idling === l.act; }, null, { timeout: 30000 });
const liked = await R(() => window.__reverie.body.poke());
if (!liked) fail('a poke during a move was not taken as liking it');
await page.screenshot({ path: 'tests/out/body-2-poked.png' });

// 5. drowsy when left alone (sped up: pretend it has been quiet a long time)
await R(() => { window.__reverie.body.update(0); });
await page.waitForFunction(() => !window.__reverie.brain.speaking, null, { timeout: 30000 });
await page.evaluate(() => { const b = window.__reverie.body; const u = b.update; b.update = dt => u(dt * 10); });
await page.waitForFunction(() => window.__reverie.world.creature.drowsy, null, { timeout: 15000 }).catch(() => fail('never got drowsy'));
await page.waitForTimeout(1500);
await page.screenshot({ path: 'tests/out/body-3-drowsy.png' });

// 6. what it learnt is still there after a reload
const held = await R(() => window.__reverie.body.coach.corrections.length);
await open();
const kept = await R(() => window.__reverie.body.coach.corrections.length);
console.log(`corrections: ${held} before reload, ${kept} after`);
if (kept < held || !kept) fail('the lessons were not kept');
await R(() => window.__reverie.body.forget());

if (errors.length) fail('page errors: ' + errors.join(' | '));
await browser.close();
console.log(process.exitCode ? 'body: failed' : 'body: ok');
