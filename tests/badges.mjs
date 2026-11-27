// Badges test: the tracker alone (counts, bests, sets, later features, kept in the store, what Claude hears), then the
// page: making a teapot earns the first badge (a card drops in, a trophy pops up and flies to the shelf, Claude hears
// it), the badges tool, the badges in the diary, a tap on the trophy, and the shelf as it was after a reload.
// Pictures in tests/out/.
//   node tests/badges.mjs            the tracker alone
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/badges.mjs --page [url]
import { makeAchievements, ACHIEVEMENTS, FAMILIES } from '../src/achievements.js';

const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (cond, msg) => { if (!cond) fail(msg); };

// ---- the tracker alone
{
  const data = new Map(), store = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  const ids = new Set(); for (const a of ACHIEVEMENTS) { ok(!ids.has(a.id), 'ids are unique: ' + a.id); ids.add(a.id); ok(FAMILIES[a.family], 'a known family: ' + a.id); }
  let a = makeAchievements({ store });
  const got = []; a.onUnlock(b => got.push(b.id));
  ok(a.summary() === '', 'nothing earned says nothing');
  ok(!a.list().some(x => x.family === 'garden'), 'the garden badges wait until the garden is used');
  ok(a.track('make').map(b => b.id).join() === 'make_1', 'the first thing made earns Abracadabra');
  ok(a.track('make').length === 0, 'the second earns nothing');
  a.track('quiz', { best: 6, count: true }); ok(a.has('quiz_round') && !a.has('quiz_7'), 'a quiz of 6: a round, not Brain box');
  a.track('quiz', { best: 7, count: true }); ok(a.has('quiz_7'), 'a quiz of 7: Brain box');
  for (const v of ['pirate', 'pirate', 'robot']) a.track('voices', { add: v });
  ok(!a.has('voices_3'), 'the same voice twice counts once');
  a.track('voices', { add: 'ghost' }); ok(a.has('voices_3'), 'three different voices');
  a.track('streak', { at: 3 }); a.track('streak', { at: 1 }); ok(a.has('streak_3') && a.stat('streak') === 3, 'a streak keeps its best');
  a.track('garden:plant'); ok(a.has('garden_plant') && a.list().some(x => x.family === 'garden'), 'a later feature tracks its own and its badges show');
  ok(got.length === 6, `each new one heard once (${got})`);
  a = makeAchievements({ store });
  ok(a.has('make_1') && a.earned().length === 6 && a.earned()[0].id === 'make_1', 'kept in the store, in order');
  const line = a.line(a.earned()[0]);
  ok(/Abracadabra/.test(line) && !/\bReverie\b/.test(line) && /they had you/.test(line), 'Claude hears it as itself: ' + line);
  ok(/Nearly there/.test(a.summary()), 'the summary says what is close: ' + a.summary());
  a.wipe(); ok(!a.earned().length && !data.has('reverie.achievements.v1'), 'wiped');
  console.log('tracker: ok');
}

if (process.argv.includes('--page')) {
  const { createRequire } = await import('node:module');
  const { mkdirSync } = await import('node:fs');
  const { chromium } = createRequire(import.meta.url)('playwright');
  const url = process.argv.slice(2).find(a => !a.startsWith('--')) || 'http://localhost:5179/';
  mkdirSync('tests/out', { recursive: true });
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
  await page.route('**/api.bigdatacloud.net/**', r => r.fulfill({ json: {} }));
  await page.route('**/api.open-meteo.com/**', r => r.fulfill({ json: {} }));
  const errors = [], heard = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { const t = m.text(); if (/\[reverie\] badge/.test(t)) heard.push(t); if (m.type() === 'error') console.log('  ' + t.slice(0, 300)); });
  const R = (fn, arg) => page.evaluate(fn, arg);
  const shot = name => page.screenshot({ path: `tests/out/${name}.png` });
  const quiet = () => page.waitForFunction(() => !window.__reverie.brain.busy && !window.__reverie.brain.speaking && !window.__reverie.world.walking, null, { timeout: 90000 });
  async function say(text) { await page.fill('#say', text); await page.press('#say', 'Enter'); await page.waitForTimeout(400); await quiet(); }
  async function open() {
    await page.goto(url);
    await page.waitForFunction(() => window.__reverie?.trophies, null, { timeout: 180000 });
    await page.waitForSelector('#wake:not([hidden])', { timeout: 120000 });
  }
  await open();
  await R(() => { localStorage.removeItem('reverie.achievements.v1'); });
  await page.reload(); await page.waitForFunction(() => window.__reverie?.trophies, null, { timeout: 180000 });
  await page.waitForSelector('#wake:not([hidden])', { timeout: 120000 });
  await page.click('#wake'); await quiet();
  const before = await R(() => window.__reverie.achievements.earned().map(a => a.id));
  console.log('earned on waking:', before.join(', ') || 'none');

  // 1. make something: the first badge
  await page.fill('#say', 'make me a teapot'); await page.press('#say', 'Enter');
  await page.waitForFunction(() => window.__reverie.achievements.has('make_1'), null, { timeout: 90000 });
  await page.waitForTimeout(700);
  ok(await R(() => document.querySelector('#badge-toast.show')?.textContent.includes('Abracadabra')), 'the badge card drops in');
  await shot('badge-1-card');
  await page.waitForTimeout(1200); await shot('badge-2-trophy');
  await page.waitForFunction(() => !window.__reverie.trophies.busy, null, { timeout: 20000 });
  await quiet();
  ok(await R(() => window.__reverie.trophies.count) === before.length + 1, 'a trophy on the shelf');
  const told = await R(() => window.__reverie.brain.history.map(m => typeof m.content === 'string' ? m.content : m.content.map(b => b.text || b.content || '').join(' ')).join('\n'));
  ok(/\[achievement\][^\n]*Abracadabra/.test(told), 'Claude heard about it');

  // 2. more: a pet, a sky, the room painted, the dice
  await say('roll a d6');
  await say('paint the walls blue');
  await page.waitForTimeout(4000);
  const now = await R(() => window.__reverie.achievements.earned().map(a => a.id));
  console.log('earned now:', now.join(', '));
  ok(now.includes('dice_1') && now.includes('paint_1'), 'dice and paint badges');
  await page.waitForFunction(() => !window.__reverie.trophies.busy, null, { timeout: 30000 });

  // 3. the badges tool
  // (news of a badge still waiting goes first, and the stand-in Claude answers only that: ask again)
  let told2 = '';
  for (let i = 0; i < 3 && !/They have \d+ of \d+ badges/.test(told2); i++) { await say('what badges have I got?'); await page.waitForTimeout(1500); told2 = await R(() => JSON.stringify(window.__reverie.brain.history)); }
  ok(/They have \d+ of \d+ badges/.test(told2), 'the badges tool answers');

  // 4. the shelf, seen from close by; a tap on a trophy
  const seat = [[.4, 1.35, .6], [.9, 1.55, -1.5]];
  await R(seat => { const w = window.__reverie.world, v = w.view; w.__draw ||= w.draw; w.draw = c => { v.cam.position.set(...seat[0]); v.cam.lookAt(...seat[1]); w.__draw(c); }; }, seat);
  await page.waitForTimeout(2500); await shot('badge-3-shelf');
  await R(() => { const w = window.__reverie.world; w.draw = w.__draw; });
  await page.waitForTimeout(1500); await shot('badge-4-room');
  const xy = await R(() => {
    const { trophies, world } = window.__reverie, o = trophies.root.children.at(-1), p = o.getWorldPosition(new (o.position.constructor)()); p.y += .05;
    p.project(world.view.cam); const r = document.querySelector('#view').getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height, inView: Math.abs(p.x) < 1 && Math.abs(p.y) < 1 };
  });
  console.log('last trophy on screen at', JSON.stringify(xy));
  if (xy.inView) {
    await page.mouse.click(xy.x, xy.y); await page.waitForTimeout(300);
    const cap = await R(() => document.querySelector('#caption').textContent);
    ok(/: you /.test(cap), 'a tap on a trophy says what it was for: ' + cap);
  }

  // 5. the diary's badges
  await page.click('#book'); await page.waitForTimeout(500);
  await R(() => document.querySelector('#diary .badges')?.scrollIntoView());
  ok(await R(() => document.querySelectorAll('#diary .badges li.got').length) === now.length, 'the diary shows the badges earned');
  await shot('badge-5-diary');
  await page.click('#diary [data-id="close"]');

  // 6. a reload: the trophies are still there
  await open();
  ok(await R(() => window.__reverie.trophies.count) === now.length, 'the trophies are back after a reload');
  // 7. a shelf full of every shape and metal, for the picture
  await R(() => {
    const ids = ['first_game', 'chess_win', 'quiz_7', 'make_1', 'make_10', 'doodle_10', 'name', 'streak_7', 'pet_1', 'place_1', 'paint_1', 'garden_bloom', 'learn_1', 'sing_1', 'escape_1', 'noughts_win', 'overjoyed'];
    localStorage.setItem('reverie.achievements.v1', JSON.stringify({ v: 1, got: Object.fromEntries(ids.map((id, n) => [id, { day: '2026-11-27', n }])), counts: {}, best: {}, sets: {}, seen: { garden: true, learn: true, music: true, escape: true } }));
  });
  await open();
  await R(seat => { const w = window.__reverie.world, v = w.view; w.__draw ||= w.draw; w.draw = c => { v.cam.position.set(...seat[0]); v.cam.lookAt(...seat[1]); w.__draw(c); }; }, [[.5, 1.5, .1], [.9, 1.55, -1.5]]);
  await page.waitForTimeout(3000); await shot('badge-6-full-shelf');
  await R(() => localStorage.removeItem('reverie.achievements.v1'));
  console.log('heard:', heard.join(' | '));
  ok(!errors.length, 'no page errors: ' + errors.join(' / '));
  await browser.close();
  console.log(process.exitCode ? 'badges: FAILED' : 'badges: ok');
}
