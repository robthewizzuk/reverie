// Games start and stop cleanly, against the scripted Claude (REVERIE_FAKE=1): every game set up and put away leaves
// nothing behind (no table in the scene, no physics body, no dice, the bar gone, its hands and thinking back to normal);
// a game put away or swapped while it is still loading never turns up later; a new round mid-move drops the old move;
// a spoken move Claude is waiting on finishes when the game goes away; Again and Done are told to Claude; a quiet
// "offer another round" in the news doesn't start a game when they answer; and props on the floor make way for a table.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/clean.mjs [url]
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
let failed = 0;
const fail = msg => { console.error('FAIL:', msg); failed++; process.exitCode = 1; };
const ok = (cond, msg) => { if (!cond) fail(msg); return !!cond; };
const say = async text => { await page.fill('#say', text); await page.press('#say', 'Enter'); };
const quiet = () => page.waitForFunction(() => { const r = window.__reverie; return !r.brain.busy && !r.brain.speaking; }, null, { timeout: 90000 }).catch(() => fail('did not go quiet'));
const until = (fn, arg, what, timeout = 90000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => { fail(what); return false; });

// what is on the stage now: game tables in the scene, physics bodies, dice, the game bar, its hands
const look = () => page.evaluate(() => {
  const { world } = window.__reverie;
  return {
    game: world.game?.id || null, state: world.game?.state || null,
    tables: world.view.scene.children.filter(o => /^game:/.test(o.name)).map(o => o.name.slice(5)),
    bodies: world.physics.world.bodies.len(),
    dice: world.scene().includes('die showing') || world.scene().includes('dice showing'),
    bar: !document.querySelector('#gamebar').hidden, pad: !document.querySelector('#pad').hidden,
    thinking: world.creature.state.thinking, props: world.props,
  };
});
const lastUserText = () => page.evaluate(() => [...window.__reverie.brain.history].reverse().filter(m => m.role === 'user' && typeof m.content === 'string').slice(0, 3).map(m => m.content).join('\n---\n'));

await page.goto(url);
await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 90000 });
await page.click('#wake');
await page.waitForTimeout(800);
await quiet();
const base = await look();
console.log('before any game:', JSON.stringify(base));

// ---- put away while it is still loading (the first chess board waits for the rules to load): it never turns up
await page.evaluate(() => { const { world } = window.__reverie; window.__p = world.play('chess'); world.stopGame(); });
const early = await page.evaluate(() => window.__p);
await page.waitForTimeout(500);
let s = await look();
console.log('chess put away while loading:', early, JSON.stringify(s));
ok(!s.game && !s.tables.length, 'a chess board put away while loading turned up anyway');
ok(s.bodies === base.bodies, `a physics body was left behind (${s.bodies} vs ${base.bodies})`);

// ---- swapped for another game while loading (the quiz's questions load the first time): only the new one is out
await page.evaluate(() => { const { world } = window.__reverie; window.__p = Promise.all([world.play('quiz'), world.play('noughts')]); });
const both = await page.evaluate(() => window.__p);
s = await look();
console.log('quiz swapped for noughts while loading:', both[0], '|', JSON.stringify(s));
ok(s.game === 'noughts' && s.tables.join() === 'noughts', 'swapping games while one loaded left two tables out: ' + s.tables.join());
await page.evaluate(() => window.__reverie.world.stopGame());

// ---- every game, set up and put away: nothing left behind
const GAMES = { chess: 'you', quiz: 'you', noughts: 'you', twenty: 'asking', draw_and_guess: 'drawing', quest: 'ready' };
for (const [id, ready] of Object.entries(GAMES)) {
  const r = await page.evaluate(id => window.__reverie.world.play(id), id);
  await until(([id, ready]) => window.__reverie.world.game?.id === id && window.__reverie.world.game.state === ready, [id, ready], `${id} never got ready`);
  await page.waitForTimeout(300);
  const on = await look();
  ok(on.bar || id === 'draw_and_guess', `${id}: no game bar`);
  ok(id === 'draw_and_guess' ? on.pad : on.tables.join() === id, `${id}: its table is not out (${on.tables.join()})`);
  await page.evaluate(() => window.__reverie.world.stopGame());
  await page.waitForTimeout(400);
  s = await look();
  console.log(`${id}: ${r.slice(0, 60)}… | on: ${on.tables.join() || (on.pad ? 'pad' : '-')}, ${on.bodies} bodies | off: ${JSON.stringify(s)}`);
  ok(!s.game && !s.tables.length, `${id}: something stayed on the stage`);
  ok(s.bodies === base.bodies + (s.props - base.props), `${id}: a physics body was left behind (${s.bodies} vs ${base.bodies})`);
  ok(!s.bar && !s.pad, `${id}: the game bar or the pad stayed up`);
  ok(!s.dice, `${id}: dice left on the rug`);
}
await quiet();

// ---- a new round in the middle of Reverie's move: the old move is dropped, its hand comes back, it stops thinking
await page.evaluate(() => window.__reverie.world.play('chess'));
await until(() => window.__reverie.world.game?.state === 'you', null, 'no chess');
await page.evaluate(() => window.__reverie.world.game.command('e4'));
await until(() => window.__reverie.world.game.state === 'busy', null, 'e4 did not start a move', 10000);
await page.evaluate(() => window.__reverie.world.play('chess'));
await page.waitForTimeout(2500);
s = await look();
const ctx = await page.evaluate(() => window.__reverie.world.game.context());
console.log('chess restarted mid-move:', s.state, s.thinking, ctx.slice(0, 120));
ok(s.state === 'you' && /Moves so far: none/.test(ctx), 'the old move carried on into the new chess game');
ok(!s.thinking || await page.evaluate(() => window.__reverie.brain.busy), 'it was left thinking after a new chess game mid-move');

// ---- a spoken answer Claude waits on finishes when the quiz goes away (the brain is not left hanging)
await page.evaluate(() => window.__reverie.world.play('quiz'));
await until(() => window.__reverie.world.game?.id === 'quiz' && window.__reverie.world.game.state === 'you', null, 'no quiz');
const answered = await page.evaluate(async () => {
  const { world } = window.__reverie, p = world.game.command('a');
  await new Promise(r => setTimeout(r, 200)); world.stopGame();
  return Promise.race([p.then(() => 'finished'), new Promise(r => setTimeout(() => r('hung'), 8000))]);
});
console.log('quiz answer, then put away:', answered);
ok(answered === 'finished', 'a spoken quiz answer hung when the quiz was put away');

// ---- the same in Dice Quest: a spoken roll, then put away mid-throw; no die is left on the rug
await page.evaluate(() => window.__reverie.world.play('quest'));
await until(() => window.__reverie.world.game?.state === 'ready', null, 'no quest');
const rolled = await page.evaluate(async () => {
  const { world } = window.__reverie, p = world.game.command('roll');
  await new Promise(r => setTimeout(r, 300)); world.stopGame();
  return Promise.race([p.then(() => 'finished'), new Promise(r => setTimeout(() => r('hung'), 8000))]);
});
await page.waitForTimeout(1500);
s = await look();
console.log('quest roll, then put away:', rolled, JSON.stringify(s));
ok(rolled === 'finished', 'a spoken roll hung when the quest was put away');
ok(!s.dice && !s.tables.length, 'the quest left a die or its table behind');
await quiet();

// ---- Again is told to Claude out loud (it reads the new round's first question), Done with the next thing said
await say("let's do a quiz");
await until(() => window.__reverie.world.game?.id === 'quiz' && window.__reverie.world.game.state === 'you', null, 'no quiz from asking');
await quiet();
await page.evaluate(() => window.__reverie.world.again());
await until(() => window.__reverie.brain.history.some(m => typeof m.content === 'string' && /\[quiz\] They asked for another round\. The quiz table is set up/.test(m.content)), null, 'Claude never heard about Again');
await quiet();
await page.click('#gamebar button[data-id="leave"]');
await page.waitForTimeout(300);
await say('that was fun');
await quiet();
const told = await lastUserText();
ok(/\[game\] They pressed Done: Quiz is put away/.test(told), 'Claude was not told the quiz was put away');

// ---- "offer another round" in quiet news, then "no thanks": no new game
await page.evaluate(() => window.__reverie.brain.notice('[quiz] That was the last question: they scored 7 out of 10 (best streak 3). Cheer them on, say how they did, and offer another round.'));
await say('no thanks');
await quiet();
s = await look();
console.log('after "no thanks" to another round:', s.game);
ok(!s.game, 'quiet quiz news set a new quiz up when they said "no thanks"');

// ---- a prop in its hands when a game starts: put down to one side, not on the game's table
await page.evaluate(() => window.__reverie.world.make('a teddy bear'));
const placedAt = await page.evaluate(async () => {
  const { world } = window.__reverie;
  await world.play('noughts');
  await new Promise(r => setTimeout(r, 4000));
  return world.floor;
});
console.log('props after the table went up:', JSON.stringify(placedAt));
ok(placedAt.length === 1, 'the teddy bear it held was not put down beside the table');
ok(placedAt.every(p => !(Math.abs(p.at.x) < .4 && p.at.z > .3 && p.at.z < .9 && p.at.y > .25)), 'a prop ended up on the game table');
await page.screenshot({ path: 'tests/out/clean-props.png' });
await page.evaluate(() => window.__reverie.world.stopGame());

if (errors.length) fail(errors.length + ' page errors');
console.log(failed ? `clean: FAILED (${failed})` : 'clean: ok');
await browser.close();
