// The newer games, against the scripted Claude (REVERIE_FAKE=1): noughts and crosses (taps and spoken squares, the
// engine's replies, a full round), Twenty Questions (questions counted, a wrong guess, a right one opening the box
// and making the thing), and Draw and Guess (the pad taken over, a drawing read live, skips to the end of a round).
// Pictures in tests/out/games-*.png.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/games.mjs [url]
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
const shot = name => page.screenshot({ path: `tests/out/games-${name}.png` });
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const say = async text => { await page.fill('#say', text); await page.press('#say', 'Enter'); };
const quiet = () => page.waitForFunction(() => { const r = window.__reverie; return !r.brain.busy && !r.brain.speaking; }, null, { timeout: 60000 }).catch(() => fail('did not go quiet'));
const game = () => page.evaluate(() => { const g = window.__reverie.world.game; return g && { id: g.id, state: g.state, bar: g.bar()?.text, ctx: g.context() }; });
const settled = () => page.waitForFunction(() => { const { world } = window.__reverie, c = world.view.cam.position, g = world.game.camera.pos; return Math.hypot(c.x - g[0], c.y - g[1], c.z - g[2]) < .005; }, null, { timeout: 60000 });
const lastUser = () => page.evaluate(() => [...window.__reverie.brain.history].reverse().find(m => m.role === 'user' && typeof m.content === 'string')?.content || '');

await page.goto(url);
await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 60000 });
await page.click('#wake');
await page.waitForTimeout(500);

// ---- the parsers
const parsed = await page.evaluate(async () => {
  const n = await import('/src/games/noughts.js'), t = await import('/src/games/twenty.js'), d = await import('/src/games/draw.js');
  const rabbit = ['rabbit', 'an animal', 'bunny'];
  return {
    squares: ['top left', 'the middle', 'bottom right corner', '5', 'right', 'top', 'middle right', 'centre square please', 'banana'].map(n.squareOf),
    guesses: [t.guessed('is it a bunny?', rabbit), t.guessed('rabbits!', rabbit), t.guessed('does it like eating carrots with other rabbits in a field', rabbit), t.guessed('is it a dog', rabbit)],
    questions: [t.isQuestion('does it have legs'), t.isQuestion('is it bigger than a breadbox'), t.isQuestion('I like it'), t.isQuestion('can it fly?')],
    got: [d.gotIt([{ name: 'sun', sure: .5 }], 'sun'), d.gotIt([{ name: 'circle', sure: .5 }, { name: 'sun', sure: .35 }], 'sun'), d.gotIt([{ name: 'cloud', sure: .9 }], 'sun')],
  };
});
console.log('parsers:', JSON.stringify(parsed));
if (parsed.squares.join() !== '0,4,8,4,5,1,5,4,-1') fail('squares parsed wrong');
if (parsed.guesses.join() !== 'true,true,false,false') fail('guesses read wrong');
if (parsed.questions.join() !== 'true,true,false,true') fail('questions read wrong');
if (parsed.got.join() !== 'true,true,false') fail('drawings read wrong');

// ---- noughts and crosses
await say("let's play noughts and crosses");
await page.waitForFunction(() => window.__reverie.world.game?.id === 'noughts' && window.__reverie.world.game.state === 'you', null, { timeout: 60000 }).catch(() => fail('no noughts'));
await settled(); await page.waitForTimeout(400);
await shot('1-noughts');
await quiet();
// a tap on the middle square, where it is on screen
const mid = await page.evaluate(() => {
  const { world, gs } = window.__reverie, THREE = gs.hd.THREE, cv = document.querySelector('#view');
  const q = new THREE.Vector3(0, .3, .6).project(world.view.cam), r = cv.getBoundingClientRect();
  return { x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height };
});
await page.mouse.click(mid.x, mid.y);
await page.waitForFunction(() => /O/.test(window.__reverie.world.game.context().split('Board:')[1]) && window.__reverie.world.game.state === 'you', null, { timeout: 30000 }).catch(() => fail('Reverie did not reply to a tap'));
console.log('after a tap:', (await game()).ctx.slice(0, 200));
await quiet();
// then squares said out loud, until the round is over
for (let i = 0; i < 9; i++) {
  const g = await game(); if (g.state === 'done') break;
  const free = /Free squares: ([^.]+)\./.exec(g.ctx)?.[1].split(', ') || [];
  await say('square ' + free[0]);
  await page.waitForFunction(() => ['you', 'done'].includes(window.__reverie.world.game.state) && !window.__reverie.brain.busy, null, { timeout: 30000 }).catch(() => fail('a spoken square did not play'));
  await page.waitForTimeout(1200);
  await quiet();
}
let g = await game();
console.log('noughts:', g.bar, '|', g.ctx.slice(0, 160));
if (g.state !== 'done') fail('the round did not end');
await page.waitForTimeout(600);
await shot('2-noughts-done');
await page.click('#gamebar button[data-id="again"]');
await page.waitForFunction(() => window.__reverie.world.game.state === 'you', null, { timeout: 30000 }).catch(() => fail('round 2 never came to them'));
g = await game();
console.log('round 2:', g.ctx.slice(0, 200));
if (!/Round 2/.test(g.ctx) || !/O/.test(g.ctx.split('Board:')[1])) fail('round 2 did not start with Reverie moving first');
await quiet();

// ---- twenty questions
await say('can we play twenty questions');
await page.waitForFunction(() => window.__reverie.world.game?.id === 'twenty' && window.__reverie.world.game.state === 'asking', null, { timeout: 60000 }).catch(() => fail('no twenty questions'));
await settled(); await page.waitForTimeout(400);
await shot('3-twenty');
await quiet();
await say('does it have legs');
await quiet();
await say('is it bigger than a cat?');
await quiet();
await say('is it a xylophone');
await quiet();
g = await game();
console.log('twenty:', g.bar, '|', g.ctx.slice(0, 220));
if (!/3 of 20 asked/.test(g.bar)) fail('questions were not counted');
if (!/\(Question 3 of 20/.test(await lastUser())) fail('Claude was not told the count');
const secret = /thinking of an? ([a-z ]+) \(/.exec(g.ctx)?.[1];
await say(`is it a ${secret}?`);
await page.waitForFunction(() => window.__reverie.world.game.state === 'won' && window.__reverie.world.held, null, { timeout: 60000 }).catch(() => fail('a right guess did not open the box and make the thing'));
await page.waitForTimeout(800);
await shot('4-twenty-won');
console.log('won:', (await game()).bar, '| holding', await page.evaluate(() => window.__reverie.world.held?.short));
await quiet();

// ---- draw and guess
await say("let's play draw and guess");
await page.waitForFunction(() => window.__reverie.world.game?.id === 'draw_and_guess' && window.__reverie.world.game.state === 'drawing', null, { timeout: 60000 }).catch(() => fail('no draw and guess'));
await page.waitForTimeout(1500);
console.log('pad:', await page.textContent('#pad p'));
// a big circle with rays: a sun, or what it makes of it
const box = await page.locator('#pad canvas').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2, R = Math.min(box.width, box.height) * .2;
await page.mouse.move(cx + R, cy); await page.mouse.down();
for (let a = 0; a <= 40; a++) { await page.mouse.move(cx + R * Math.cos(a / 40 * Math.PI * 2), cy + R * Math.sin(a / 40 * Math.PI * 2)); await page.waitForTimeout(15); }
await page.mouse.up();
for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; await page.mouse.move(cx + R * 1.25 * Math.cos(a), cy + R * 1.25 * Math.sin(a)); await page.mouse.down(); await page.mouse.move(cx + R * 1.7 * Math.cos(a), cy + R * 1.7 * Math.sin(a), { steps: 5 }); await page.mouse.up(); }
await page.waitForTimeout(500);
console.log('reader:', JSON.stringify(await page.evaluate(() => window.__reverie.pad.guessNow().slice(0, 3))));
await shot('5-draw');
for (let i = 0; i < 6; i++) {
  if ((await game()).state === 'over') break;
  await page.waitForFunction(() => window.__reverie.world.game.state === 'drawing' || window.__reverie.world.game.state === 'over', null, { timeout: 10000 });
  if ((await game()).state === 'over') break;
  await page.click('#pad button[data-id="skip"]');
  await page.waitForTimeout(2200);
}
await page.waitForFunction(() => window.__reverie.world.game?.state === 'over', null, { timeout: 30000 }).catch(() => fail('the round did not end'));
await page.waitForFunction(() => window.__reverie.brain.history.some(m => typeof m.content === 'string' && /\[draw and guess\] The round is over/.test(m.content)), null, { timeout: 30000 }).catch(() => fail('Reverie did not hear the round end'));
console.log('draw:', (await game()).bar, '| pad hidden:', await page.evaluate(() => document.querySelector('#pad').hidden));
await shot('6-draw-over');
await quiet();
await page.click('#gamebar button[data-id="leave"]');

// ---- dice quest
await say("let's go on a dice quest");
await page.waitForFunction(() => window.__reverie.world.game?.id === 'quest' && window.__reverie.world.game.state === 'ready', null, { timeout: 60000 }).catch(() => fail('no quest'));
await settled(); await page.waitForTimeout(2500);
await shot('7-quest');
await quiet();
await say('roll');
await page.waitForFunction(() => window.__reverie.brain.history.some(m => typeof m.content === 'string' && /\[quest\] They rolled a \d/.test(m.content)) || ['won', 'lost'].includes(window.__reverie.world.game.state), null, { timeout: 60000 }).catch(() => fail('a spoken roll did not throw the die'));
await page.waitForTimeout(400);
await shot('8-quest-rolled');
for (let i = 0; i < 6; i++) {
  await quiet();
  const st = (await game()).state; if (st === 'won' || st === 'lost') break;
  await page.waitForFunction(() => ['ready', 'won', 'lost'].includes(window.__reverie.world.game.state), null, { timeout: 120000 }).catch(() => fail('the quest got stuck in ' + 'a roll'));
  if ((await game()).state !== 'ready') break;
  await page.click('#gamebar button[data-id="roll"]');
  await page.waitForFunction(() => window.__reverie.world.game.state !== 'rolling', null, { timeout: 120000 });
  await page.waitForTimeout(1500);
}
await page.waitForFunction(() => ['won', 'lost'].includes(window.__reverie.world.game.state), null, { timeout: 120000 }).catch(() => fail('the quest did not end'));
g = await game();
console.log('quest:', g.bar, '|', g.ctx);
await page.waitForTimeout(800);
await shot('9-quest-end');
await quiet();

if (errors.length) fail(errors.length + ' page errors');
console.log(process.exitCode ? 'games: FAILED' : 'games: ok');
await browser.close();
