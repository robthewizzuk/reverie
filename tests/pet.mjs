// Moods and pets test: its mood rises with play and shows in its body, is told to Claude and kept after a reload; it
// makes a pet (a fox called Pip) that pops out, wanders by itself, hops with hearts when tapped, chases a thrown prop,
// does a trick, and is still there, by name, after a reload. Pictures in tests/out/.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/pet.mjs [url]
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
page.on('console', m => { if (/\[reverie\] mood/.test(m.text()) || m.type() === 'error') console.log('  ' + m.text().slice(0, 400)); });
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const R = (fn, arg) => page.evaluate(fn, arg);
const quiet = () => page.waitForFunction(() => !window.__reverie.brain.busy && !window.__reverie.brain.speaking && !window.__reverie.world.walking, null, { timeout: 90000 });
async function say(text) { await page.fill('#say', text); await page.press('#say', 'Enter'); await page.waitForTimeout(400); await quiet(); }

async function open(fresh) {
  await page.goto(url);
  await page.waitForFunction(() => window.__reverie?.mood, null, { timeout: 180000 });
  if (fresh) { await R(() => { localStorage.removeItem('reverie.pet.v1'); window.__reverie.mood.reset(); }); await page.reload(); await page.waitForFunction(() => window.__reverie?.mood, null, { timeout: 180000 }); }
  await page.waitForSelector('#wake:not([hidden])', { timeout: 90000 });
  await page.click('#wake');
  await quiet();
}
await open(true);

// 1. the mood: starts content, rises with play, and the body follows
const m0 = await R(() => ({ joy: window.__reverie.mood.joy, level: window.__reverie.mood.level, cheer: window.__reverie.world.creature.cheer }));
console.log('mood at the start:', JSON.stringify(m0));
await say('make me a teapot');
await say('throw it');
for (let i = 0; i < 4; i++) { await page.mouse.click(210, 470); await page.waitForTimeout(250); }
await page.waitForTimeout(2500);
const m1 = await R(() => ({ joy: window.__reverie.mood.joy, spark: window.__reverie.mood.spark, cheer: window.__reverie.world.creature.cheer, line: window.__reverie.world.scene() }));
console.log('after some play:', JSON.stringify(m1));
if (!(m1.joy > m0.joy)) fail('joy did not rise with play');
if (!(m1.cheer > m0.cheer)) fail('its body did not get cheerier');
if (!/Your mood:/.test(m1.line)) fail('Claude is not told its mood');
const sent = await R(() => window.__reverie.brain.history.filter(m => m.role === 'user' && typeof m.content === 'string').at(-1)?.content || '');
if (!/Your mood:/.test(sent)) fail('the mood did not go to Claude with what was said: ' + sent.slice(0, 200));
// the voice follows it too
const tone = await R(async () => { const { sayOptions } = await import('/src/looks.js'); window.__reverie.mood.set(.95); const hi = sayOptions(); window.__reverie.mood.set(.2); const lo = sayOptions(); window.__reverie.mood.set(.6); return { hi, lo }; });
console.log('voice when overjoyed / low:', JSON.stringify({ hi: [tone.hi.lively, tone.hi.size, tone.hi.mood], lo: [tone.lo.lively, tone.lo.size, tone.lo.mood] }));
if (!(tone.hi.lively > tone.lo.lively)) fail('a happier voice is not livelier');

// 2. a pet: made, pops out, and is told to Claude
await say('clear');
await say('make me a pet fox called Pip');
await page.waitForFunction(() => window.__reverie.world.keeper?.pet, null, { timeout: 60000 });
const p1 = await R(() => { const k = window.__reverie.world.keeper; return { about: k.about, mode: k.mode, line: window.__reverie.world.scene() }; });
console.log('pet:', JSON.stringify(p1));
if (p1.about?.like !== 'fox' || !/pip/i.test(p1.about?.name)) fail('the pet is not a fox called Pip');
if (!/Your pet: Pip/i.test(p1.line)) fail('Claude is not told about the pet');
await page.waitForTimeout(1200);
const named = await R(() => window.__reverie.world.keeper.nameShown);
console.log('its name floats over it:', named);
if (!named) fail('the pet\'s name did not show');
await page.screenshot({ path: 'tests/out/pet-1-made.png' });

// 3. it wanders on its own
const where = () => R(() => { const p = window.__reverie.world.keeper.pet.position; return { x: p.x, z: p.z, mode: window.__reverie.world.keeper.mode }; });
// (the stage run on without drawing, 20 s of it: the software GPU here draws a frame in about half a second)
const run = s => R(s => { const w = window.__reverie.world; for (let i = 0; i < s * 20; i++) w.update(.05); }, s);
const w0 = await where(), modes = new Set(); let moved = 0, last = w0;
for (let i = 0; i < 40; i++) { await run(.5); const w = await where(); modes.add(w.mode); moved += Math.hypot(w.x - last.x, w.z - last.z); last = w; }
console.log(`wandered ${moved.toFixed(2)} m in 20 s; modes: ${[...modes].join(', ')}`);
if (moved < .3) fail('the pet did not wander');
await page.screenshot({ path: 'tests/out/pet-2-wander.png' });

// 4. tapping it: it hops, with hearts
const at = await R(() => { const { world } = window.__reverie, k = world.keeper; k.pet.position.set(.3, 0, .6);
  const v = k.pet.position.clone(); v.y += k.pet.size.height * .5 + k.height; v.project(world.view.cam); const r = document.querySelector('#view').getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, on: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 }; });
if (at.on) {
  const j0 = await R(() => window.__reverie.mood.joy);
  await page.mouse.click(at.x, at.y); await page.waitForTimeout(200);
  const tapped = await R(() => ({ mode: window.__reverie.world.keeper.mode, hearts: window.__reverie.world.floaties.flying, joy: window.__reverie.mood.joy }));
  console.log('tapped the pet:', JSON.stringify(tapped));
  if (tapped.mode !== 'patted') fail('tapping the pet did nothing');
  if (!(tapped.joy > j0)) fail('patting the pet did not cheer Reverie up');
  await page.waitForTimeout(400); await page.screenshot({ path: 'tests/out/pet-3-patted.png' });
} else console.log('(the pet was off screen; tap skipped)');

// 5. a thrown prop: it gives chase
const chases0 = await R(() => window.__reverie.world.keeper.chases);
await say('make me a ball'); await say('throw it');
let chased = false;
const ball0 = await R(() => { const p = window.__reverie.world.floorThings().at(-1)?.pivot.position; return p && { x: p.x, z: p.z }; });
for (let i = 0; i < 40 && !chased; i++) { await run(.1); chased = await R(c => window.__reverie.world.keeper.chases > c, chases0); }
console.log('chased the ball:', chased);
if (!chased) fail('the pet did not chase the thrown ball');
// it gets there and noses the ball along
let booped = false;
for (let i = 0; i < 60 && chased && !booped; i++) { await run(.1); booped = await R(() => window.__reverie.world.keeper.mode !== 'chase'); }
const ball1 = await R(() => { const p = window.__reverie.world.floorThings().at(-1)?.pivot.position; return p && { x: p.x, z: p.z }; });
console.log('reached it, and the ball went from', JSON.stringify(ball0), 'to', JSON.stringify(ball1));
if (!booped) fail('the pet never reached the ball');
await page.screenshot({ path: 'tests/out/pet-4-chase.png' });

// 6. a trick
await say('pet play_dead');
const trick = await R(() => ({ mode: window.__reverie.world.keeper.mode, trick: window.__reverie.world.keeper.trick }));
console.log('trick:', JSON.stringify(trick));
if (trick.mode !== 'trick' || trick.trick !== 'play_dead') fail('the trick did not start');
await page.waitForTimeout(1200); await page.screenshot({ path: 'tests/out/pet-5-trick.png' });

// 7. after a reload: the pet comes back by name, and the mood is kept
const joyBefore = await R(() => window.__reverie.mood.joy);
await open(false);
await page.waitForFunction(() => window.__reverie.world.keeper?.pet, null, { timeout: 60000 });
const back = await R(() => ({ about: window.__reverie.world.keeper.about, joy: window.__reverie.mood.joy }));
console.log('after a reload:', JSON.stringify(back));
if (back.about?.name !== 'Pip' && back.about?.name !== 'pip') fail('the pet was not kept');
if (Math.abs(back.joy - joyBefore) > .05) fail('the mood was not kept');

// 8. sleepy Reverie: the pet curls up beside it
await R(() => window.__reverie.body.update(200));   // (left alone for a while)
let slept = false;
for (let i = 0; i < 12 && !slept; i++) { await run(.25); slept = await R(() => window.__reverie.world.keeper.mode === 'sleep'); }
console.log('curled up when Reverie got sleepy:', slept);
if (!slept) fail('the pet did not curl up when Reverie got sleepy');
await run(6); await page.waitForTimeout(1500); await page.screenshot({ path: 'tests/out/pet-6-asleep.png' });

// speed: a frame's CPU time with the pet about
const ms = await R(async () => { const t = []; let a = performance.now(); for (let i = 0; i < 30; i++) { await new Promise(r => requestAnimationFrame(r)); const b = performance.now(); t.push(b - a); a = b; } t.sort((x, y) => x - y); return t[15]; });
console.log(`median frame ${ms.toFixed(1)} ms (software GPU)`);

if (errors.length) fail('page errors: ' + errors.join(' | '));
await browser.close();
console.log(process.exitCode ? 'pet test FAILED' : 'pet test passed');
