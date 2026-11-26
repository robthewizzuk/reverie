// The newer engine kits, against the scripted Claude (REVERIE_FAKE=1): rolls real dice (gs.dice) and reads them,
// hosts a quiz (gs.trivia) answered by a buzzer tap, a bar button and out loud, opens the drawing pad (gs.doodle),
// draws a house and has it made, and checks the sky outside (gs.real) reaches Claude. Pictures in tests/out/kits-*.png.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/kits.mjs [url]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5179/?debug';
mkdirSync('tests/out', { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => { errors.push(String(e)); console.log('  pageerror:', e.stack?.split('\n').slice(0, 4).join(' | ')); });
page.on('console', m => { if (m.type() === 'error') console.log('  page:', m.text().slice(0, 300)); if (/\[reverie\] \[doodle\]/.test(m.text())) console.log('  ' + m.text().slice(0, 240)); });
const shot = name => page.screenshot({ path: `tests/out/kits-${name}.png` });
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const say = async text => { await page.fill('#say', text); await page.press('#say', 'Enter'); };
const quiet = () => page.waitForFunction(() => { const r = window.__reverie; return !r.brain.busy && !r.brain.speaking; }, null, { timeout: 60000 }).catch(() => fail('did not go quiet'));
const history = () => page.evaluate(() => window.__reverie.brain.history.map(m => typeof m.content === 'string' ? m.content : m.content.map(b => b.type + (b.type === 'tool_result' ? ':' + b.content : b.type === 'text' ? ':' + b.text : '')).join(',')));

await page.goto(url);
await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 60000 });
await page.click('#wake');
await page.waitForTimeout(500);

// ---- dice
await say('roll 2d6');
await page.waitForFunction(() => window.__reverie.brain.history.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result' && /^Threw 2 real dice/.test(b.content))), null, { timeout: 60000 }).catch(() => fail('2d6 did not come back from real dice'));
await shot('1-dice');
await quiet();
await say('roll a d20');
await page.waitForFunction(() => window.__reverie.brain.history.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result' && /^Rolled 1d20 by magic/.test(b.content))), null, { timeout: 30000 }).catch(() => fail('d20 did not roll'));
await page.waitForTimeout(300);
await shot('2-d20');
await quiet();
let h = await history();
console.log('dice:', h.filter(x => /tool_result:(Threw|Rolled)/.test(x)).map(x => x.slice(0, 160)).join(' | '));
const sky = h.find(x => /^\[From the device/.test(x)) || '';
console.log('device line:', sky.split('\n')[0]);
if (!/the sun is|it is dark outside/.test(sky)) fail('the sky outside did not reach Claude');

// ---- quiz
await say("let's do a quiz");
await page.waitForFunction(() => window.__reverie.world.game?.id === 'quiz' && window.__reverie.world.game.state === 'you', null, { timeout: 60000 }).catch(() => fail('no quiz'));
await page.waitForFunction(() => { const { world } = window.__reverie, c = world.view.cam.position, g = world.game.camera.pos; return Math.hypot(c.x - g[0], c.y - g[1], c.z - g[2]) < .005; }, null, { timeout: 60000 });
await page.waitForTimeout(600);
await shot('3-quiz');
console.log('context:', await page.evaluate(() => window.__reverie.world.game.context().slice(0, 260)));
await quiet();
// a tap on the first buzzer, where it is on screen
const p = await page.evaluate(() => {
  const { world, gs } = window.__reverie, THREE = gs.hd.THREE, cv = document.querySelector('#view');
  const g = world.game; let target = null;
  world.view.scene.traverse(o => { if (!target && o.userData?.cap && o.visible && o.userData.i === 0) target = o; });
  const q = target.getWorldPosition(new THREE.Vector3()); q.y += .03; q.project(world.view.cam);
  const r = cv.getBoundingClientRect(); return { x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height, g: !!g };
});
await page.mouse.click(p.x, p.y);
await page.waitForFunction(() => window.__reverie.world.game.state === 'shown', null, { timeout: 5000 }).catch(() => fail('tapping a buzzer did not answer'));
await page.waitForTimeout(400);
await shot('4-answered');
await page.waitForFunction(() => /Question 2 of/.test(window.__reverie.world.game.context()), null, { timeout: 20000 }).catch(() => fail('no second question'));
await quiet();
// a bar button
await page.waitForSelector('#gamebar button[data-id="pick1"]', { timeout: 10000 });
await page.click('#gamebar button[data-id="pick1"]');
await page.waitForFunction(() => /Question 3 of/.test(window.__reverie.world.game.context()), null, { timeout: 20000 }).catch(() => fail('the bar button did not answer'));
await quiet();
// out loud
await say('answer a');
await page.waitForFunction(() => /Question 4 of/.test(window.__reverie.world.game.context()), null, { timeout: 30000 }).catch(() => fail('saying the answer did not answer'));
await quiet();
h = await history();
if (!h.some(x => /^\[quiz\] They answered question 1/m.test(x))) fail('Claude never heard how the answer went');
if (!h.some(x => /tool_result:Answered A/.test(x))) { fail('no game_move result for the spoken answer'); console.log(h.slice(-8).map(x => x.slice(0, 200)).join('\n')); }
if (!h.some(x => /quiz table was set up straight away/.test(x))) fail('asking for a quiz did not set it up straight away');
await page.click('#gamebar button[data-id="leave"]');
await page.waitForTimeout(1500);
if (await page.evaluate(() => !!window.__reverie.world.game)) fail('Done did not put the quiz away');

// ---- the drawing pad
await say('draw me something');
await page.waitForSelector('#pad:not([hidden])', { timeout: 30000 }).catch(() => fail('the doodle tool did not open the pad'));
const box = await page.locator('#pad canvas').boundingBox();
const line = async pts => { await page.mouse.move(box.x + pts[0][0] * box.width, box.y + pts[0][1] * box.height); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 8 }); await page.mouse.up(); };
// a house: a square and a roof
await line([[.3, .45], [.7, .45], [.7, .8], [.3, .8], [.3, .45]]);
await line([[.25, .47], [.5, .2], [.75, .47]]);
await line([[.45, .8], [.45, .65], [.55, .65], [.55, .8]]);
await shot('5-drawing');
const before = await page.evaluate(() => window.__reverie.world.props);
await page.click('#pad button[data-id="done"]');
await page.waitForFunction(() => window.__reverie.brain.history.some(m => typeof m.content === 'string' && /\[doodle\]/.test(m.content)), null, { timeout: 90000 }).catch(() => fail('Claude never heard about the drawing'));
await quiet();
await page.waitForTimeout(800);
await shot('6-made');
const after = await page.evaluate(() => window.__reverie.world.props);
h = await history();
const d = h.find(x => /\[doodle\]/.test(x)) || '';
console.log('doodle:', d.slice(d.indexOf('[doodle]'), d.indexOf('[doodle]') + 260));
if (/magicked/.test(d) && after <= before) fail('the drawing was named but nothing was made');

await say('clear');
await quiet();
if (errors.length) fail('page errors: ' + errors.join(' | '));
await browser.close();
if (!process.exitCode) console.log('kits test passed');
