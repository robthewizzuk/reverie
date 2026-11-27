// The escape room, against the scripted Claude (REVERIE_FAKE=1): the puzzle maker at every level, then a level 4 room
// solved the way a person would (lifting things, the chest, the colour box up close, the lanterns, a hint, the code
// said out loud), a level 1 room from the Again button, and starting, stopping and restarting leaving one room behind.
// Pictures in tests/out/escape-*.png.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/escape.mjs [url]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5179/?debug';
mkdirSync('tests/out', { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => { errors.push(String(e)); console.log('  pageerror:', e.stack?.split('\n').slice(0, 4).join(' | ')); });
page.on('console', m => { if (m.type() === 'error') console.log('  page:', m.text().slice(0, 300)); });
const shot = name => page.screenshot({ path: `tests/out/escape-${name}.png` });
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const say = async text => { await page.fill('#say', text); await page.press('#say', 'Enter'); };
const quiet = () => page.waitForFunction(() => { const r = window.__reverie; return !r.brain.busy && !r.brain.speaking; }, null, { timeout: 90000 }).catch(() => fail('did not go quiet'));
const settled = () => page.waitForFunction(() => { const { world } = window.__reverie, c = world.view.cam.position, g = world.game.camera.pos; return Math.hypot(c.x - g[0], c.y - g[1], c.z - g[2]) < .01; }, null, { timeout: 60000 }).catch(() => fail('camera did not settle'));
const game = () => page.evaluate(() => { const g = window.__reverie.world.game; return g && { id: g.id, state: g.state, bar: g.bar()?.text, ctx: g.context() }; });
const until = (fn, arg, what, timeout = 60000) => page.waitForFunction(fn, arg, { timeout }).catch(() => fail(what));
/** Taps a tagged piece of the room (kind, i) where it is on screen, dy metres above its origin. */
async function tapOn(kind, i = 0, dy = .08) {
  const at = await page.evaluate(([kind, i, dy]) => {
    const { world, gs } = window.__reverie, THREE = gs.hd.THREE, root = world.view.scene.getObjectByName('escape room');
    let o = null; root.traverse(x => { if (!o && x.userData.esc?.kind === kind && x.userData.esc.i === i) o = x; });
    const q = o.getWorldPosition(new THREE.Vector3()); q.y += dy; q.project(world.view.cam);
    const r = document.querySelector('#view').getBoundingClientRect();
    return { x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height };
  }, [kind, i, dy]);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(120);
}

await page.goto(url);
await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 90000 });
await page.click('#wake');
await page.waitForTimeout(500);

// ---- the puzzle maker, at every level, many times over
const made = await page.evaluate(async () => {
  const e = await import('/src/games/escape.js');
  const out = { bad: [], levels: {} };
  for (let level = 1; level <= 5; level++) for (let k = 0; k < 200; k++) {
    const p = e.makePuzzle(level);
    const why = [];
    if (p.code.length !== p.dials || p.notes.length !== p.dials) why.push('a note for every dial');
    if (new Set(p.notes.map(n => n.dial)).size !== p.dials) why.push('each dial once');
    if (p.code.some(d => d < 1 || d > 9)) why.push('digits 1 to 9');
    if (p.spots.filter(s => s.holds === 'key').length !== 1 || p.spots.filter(s => s.holds === 'note').length !== 1) why.push('one key, one note under things');
    if (level >= 3 !== !!p.notes.find(n => n.count)) why.push('a counting note from level 3');
    const c = p.notes.find(n => n.count); if (c && p.code[c.dial] !== p.candles) why.push('the candles are the number');
    if (c && c.at === 'spot') why.push('the first note is never the question');
    if (level >= 2 !== !!p.box) why.push('a colour box from level 2');
    if (p.box && p.box.start.every((x, i) => x === p.box.want[i])) why.push('the box starts unsolved');
    if (p.box?.painted && p.box.painted.every((x, i) => x === i)) why.push('the painting is not in wheel order');
    if (level >= 4 !== !!p.lights) why.push('lanterns from level 4');
    if (p.lights && (p.lights.start.every(Boolean) || !e.solveLights(p.lights.start))) why.push('lanterns start unlit and solvable');
    if (why.length) out.bad.push(level + ': ' + why.join(', '));
    out.levels[level] = `${p.dials} dials, ${p.spots.length} hiding places${p.box ? `, ${p.box.wheels} wheels` : ''}${p.lights ? `, ${p.lights.start.length} lanterns` : ''}`;
  }
  out.digits = [e.digitsOf('the code is four seven two'), e.digitsOf('472'), e.digitsOf('4, 7 and 2')].map(d => d.join(''));
  out.colours = e.coloursOf('red then blue and green please').join();
  out.lights = e.solveLights([true, false, false, true]).join();
  return out;
});
console.log('puzzles:', JSON.stringify(made.levels));
if (made.bad.length) fail('bad puzzles: ' + [...new Set(made.bad)].slice(0, 5).join(' | '));
if (made.digits.join() !== '472,472,472') fail('digits read wrong: ' + made.digits);
if (made.colours !== '0,3,2') fail('colours read wrong: ' + made.colours);
if (made.lights !== '0,1,2,3') fail('lanterns solved wrong: ' + made.lights);

// ---- asked for in words, it starts at once
await say("let's do an escape room");
await until(() => window.__reverie.world.game?.id === 'escape' && window.__reverie.world.game.state === 'playing', null, 'no escape room from asking');
await quiet();

// ---- a level 4 room, solved by hand
await page.evaluate(() => window.__reverie.world.play('escape', { level: 4 }));
await settled();
await page.waitForTimeout(6000);   // (the generator's models for the hiding places)
await shot('1-room');
// everything you need is in view from the seat: the hiding places, the chest, the box, the lanterns, every candle
const offScreen = await page.evaluate(() => {
  const { world, gs } = window.__reverie, THREE = gs.hd.THREE, root = world.view.scene.getObjectByName('escape room');
  const r = document.querySelector('#view').getBoundingClientRect(), bar = document.querySelector('#gamebar').getBoundingClientRect(), out = [];
  root.traverse(o => {
    const k = o.userData.esc?.kind || (o.userData.flame ? 'candle' : null); if (!k) return;
    const q = o.getWorldPosition(new THREE.Vector3()); q.y += .06; q.project(world.view.cam);
    const x = (q.x + 1) / 2 * r.width, y = r.top + (1 - q.y) / 2 * r.height;
    if (x < 8 || x > r.width - 8 || y < r.top + 70 || y > bar.top - 4) out.push(`${k} at ${Math.round(x)},${Math.round(y)}`);
  });
  return out;
});
if (offScreen.length) fail('out of view: ' + offScreen.join('; '));
const P = await page.evaluate(() => window.__reverie.world.game.puzzle);
console.log('level 4:', P.theme.name, '| code', P.code.join(''), '| notes', P.notes.map(n => n.at + (n.count ? '?' : '')).join(' '), '| candles', P.candles);

// lift everything on the floor
for (let i = 0; i < P.spots.length; i++) { await tapOn('spot', i); await page.waitForTimeout(400); }
await until(() => /key/.test(window.__reverie.world.game.context()) && /note saying/.test(window.__reverie.world.game.context()), null, 'lifting things did not find the key and the note');
await page.waitForTimeout(600);
await shot('2-found');
// the chest
await tapOn('chest', 0, .1);
await until(() => /Solved: the chest/.test(window.__reverie.world.game.context()), null, 'the chest did not open');
await quiet();
// the colour box, up close
await tapOn('box', 0, .45);
await settled(); await page.waitForTimeout(300);
await shot('3-box');
for (let i = 0; i < P.box.wheels; i++) for (let k = 0; k < (P.box.want[i] - P.box.start[i] + 5) % 5; k++) await tapOn('wheel', i, 0);
await until(() => /the colour box/.test(window.__reverie.world.game.context()), null, 'the colour box did not open');
await quiet();
// the lanterns, after stepping back from the box
await page.click('#gamebar button[data-id="back"]');
await page.waitForFunction(() => window.__reverie.world.game.camera.pos[2] === 2.2, null, { timeout: 20000 }).catch(() => fail('Back did not step back'));
await settled();
const lit0 = await page.evaluate(() => window.__reverie.world.game.lit);
if (lit0.join() !== P.lights.start.join()) console.log('  (the lanterns were touched before: ' + lit0.join() + ')');
const sol = await page.evaluate(async lit => (await import('/src/games/escape.js')).solveLights(lit), lit0);
for (const i of sol) await tapOn('lantern', i, .12);
await until(() => /the lanterns/.test(window.__reverie.world.game.context()), null, 'the lanterns did not all light');
await quiet();
// a hint, from the button: Reverie is told the next step
await page.click('#gamebar button[data-id="hint"]');
await page.waitForTimeout(300);
const hintNews = await page.evaluate(() => [...window.__reverie.brain.history].reverse().find(m => m.role === 'user' && /\[escape\] They pressed Hint/.test(typeof m.content === 'string' ? m.content : JSON.stringify(m.content))));
await quiet();
const ctx = (await game()).ctx;
console.log('context:', ctx.slice(0, 400));
if (!/candles|Set the dials|mark/.test(ctx)) fail('the hint is not about the candles or the door');
if (!hintNews) console.log('  (the hint news was folded into another turn)');
// a wrong code, then the right one, said out loud
await say('code 0 0 0 0');
await until(() => !window.__reverie.brain.busy, null, 'wrong code turn');
if ((await game()).state !== 'playing') fail('a wrong code opened the door');
await quiet();
await say('code ' + P.code.join(' '));
await until(() => window.__reverie.world.game.state === 'won', null, 'the right code did not open the door');
await page.waitForFunction(() => window.__reverie.world.view.scene.getObjectByName('escape room').children[0].userData.hinge.rotation.y < -1.7, null, { timeout: 60000 }).catch(() => fail('the door did not swing open'));
await shot('4-escaped');
console.log('won:', (await game()).bar);
await quiet();

// ---- again, at level 1, from the button: the old room goes, one new one comes
await page.evaluate(() => window.__reverie.world.play('escape', { level: 1 }));
await page.click('#gamebar button[data-id="again"]').catch(() => {});
await page.waitForTimeout(400);
const rooms = await page.evaluate(() => window.__reverie.world.view.scene.children.filter(o => o.name === 'escape room').length);
if (rooms !== 1) fail(`${rooms} escape rooms in the scene after Again`);
const L1 = await page.evaluate(() => window.__reverie.world.game.puzzle);
if (L1.dials !== 2 || L1.box || L1.lights) fail('level 1 is not the small room');
// done: everything goes
await page.click('#gamebar button[data-id="leave"]');
await page.waitForFunction(() => document.querySelector('#gamebar').hidden, null, { timeout: 20000 }).catch(() => {});
const left = await page.evaluate(() => ({ game: !!window.__reverie.world.game, rooms: window.__reverie.world.view.scene.children.filter(o => o.name === 'escape room').length, bar: !document.querySelector('#gamebar').hidden }));
if (left.game || left.rooms || left.bar) fail('Done left something behind: ' + JSON.stringify(left));
// and another game straight after takes over cleanly
await page.evaluate(() => window.__reverie.world.play('escape', { level: 2 }));
await page.evaluate(() => window.__reverie.world.play('noughts'));
const after = await page.evaluate(() => ({ id: window.__reverie.world.game?.id, rooms: window.__reverie.world.view.scene.children.filter(o => o.name === 'escape room').length }));
if (after.id !== 'noughts' || after.rooms) fail('switching games left the escape room: ' + JSON.stringify(after));
await page.evaluate(() => window.__reverie.world.stopGame());

if (errors.length) fail(errors.length + ' page errors');
console.log(process.exitCode ? 'escape: FAILED' : 'escape: ok');
await browser.close();
