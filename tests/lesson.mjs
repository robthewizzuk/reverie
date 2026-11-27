// Learning together. On its own (no browser): the learning book (src/learn.js) across days: lessons counted, points
// kept, words in review boxes coming due, the recap and the summary Claude reads, and forgetting. Then, with a browser
// against the scripted Claude: a lesson on volcanoes (the chalkboard, a board with a picture prop, a quiz answered by a
// tap, the end), and a Spanish lesson (a word, a quiz on it said out loud), kept in the diary and its sheet.
// Pictures in tests/out/lesson-*.png.
//   node tests/lesson.mjs            the book alone
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/lesson.mjs --page [url]
import { makeLearning, GAP } from '../src/learn.js';

const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (cond, msg) => { if (!cond) fail(msg); };

{
  const data = new Map(), store = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  let now = new Date('2026-11-20T09:00');
  const clock = () => now, next = days => { now = new Date(now.getTime() + days * 864e5); };
  let b = makeLearning({ store, clock });
  ok(b.summary() === '', 'nothing learned says nothing');
  ok(b.begin({ topic: 'Volcanoes' }) === null, 'a first lesson has no before');
  b.covered('volcanoes', ['Magma rises', 'magma rises', 'Pressure builds']);
  ok(b.get('VOLCANOES').points.length === 2, 'the same point is kept once');
  b.answered('Volcanoes', true); b.answered('Volcanoes', false);
  b.end('Volcanoes', { learned: ['lava is magma outside'], next: 'kinds of volcano' });
  ok(b.recap('Volcanoes') === '', 'no recap on the first lesson');
  next(2);
  b.begin({ topic: 'volcanoes' });
  const r = b.recap('volcanoes');
  console.log('recap:', r);
  ok(/lesson 2 of Volcanoes/.test(r) && /2 days ago/.test(r) && /kinds of volcano/.test(r) && /1 of 2 right/.test(r), 'the recap says what came before');

  // a language: words in boxes
  b.begin({ language: 'Spanish', topic: 'food', level: 'beginner' });
  ok(b.get('spanish').kind === 'language' && b.get('spanish').focus === 'food', 'a language with a theme');
  ok(b.word('Spanish', { word: 'la manzana', meaning: 'the apple', sounds: 'lah man-THAH-nah' }) === true, 'a new word');
  ok(b.word('Spanish', { word: 'La Manzana', meaning: 'the apple' }) === false, 'a word met again is not new');
  b.word('Spanish', { word: 'el pan', meaning: 'the bread' });
  ok(b.due('Spanish').length === 0, 'new words are not due the same day');
  next(1);
  ok(b.due('Spanish').length === 2, 'box 1 words are due the next day');
  b.answered('Spanish', true, 'la manzana'); b.answered('Spanish', false, 'el pan');
  ok(b.get('Spanish').words[0].box === 2 && b.get('Spanish').words[1].box === 1, 'right moves up a box, wrong back to 1');
  ok(b.due('Spanish').map(w => w.word).join() === '', 'just reviewed: nothing due today');
  next(GAP[1]);
  ok(b.due('Spanish').map(w => w.word).join() === 'el pan', `the missed word comes back first (got ${b.due('Spanish').map(w => w.word)})`);
  next(GAP[2]);
  ok(b.due('Spanish').length === 2, 'and the other after its longer gap');
  b.begin({ language: 'Spanish' });
  ok(/Due for review today: el pan \(the bread\), la manzana/.test(b.recap('Spanish')), 'a language recap lists the words due');
  const s = b.summary();
  console.log('summary:', s);
  ok(/^\[Learning together/.test(s) && /Spanish \(a language\): 2 lessons/.test(s) && /2 words \(2 due for review\)/.test(s) && /Volcanoes: 2 lessons/.test(s), 'the summary');
  // kept across a reload
  b = makeLearning({ store, clock });
  ok(b.list().length === 2 && b.list()[0].name === 'Spanish', 'kept, most recent first');
  ok(b.forget('my spanish lessons') === 'the Spanish lessons' && b.list().length === 1, 'forget one subject');
  ok(b.forget('the moon') === '', 'forgetting something not there');
  ok(b.forget('everything') === 'all of the lessons' && !b.list().length, 'forget them all');
  console.log(process.exitCode ? 'learning book: FAILED' : 'learning book: ok');
}

if (process.argv.includes('--page')) {
  const { createRequire } = await import('node:module');
  const { chromium } = createRequire(import.meta.url)('playwright');
  const { mkdirSync } = await import('node:fs');
  const url = process.argv.find(a => /^https?:/.test(a)) || 'http://localhost:5179/?debug';
  mkdirSync('tests/out', { recursive: true });
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => { fail('page error: ' + e); });
  page.on('console', m => { if (m.type() === 'error') console.log('  page:', m.text().slice(0, 300)); });
  const shot = name => page.screenshot({ path: `tests/out/lesson-${name}.png` });
  const say = async text => { await page.fill('#say', text); await page.press('#say', 'Enter'); };
  const quiet = () => page.waitForFunction(() => { const r = window.__reverie; return !r.brain.busy && !r.brain.speaking; }, null, { timeout: 90000 }).catch(() => fail('did not go quiet'));
  const game = () => page.evaluate(() => { const g = window.__reverie.world.game; return g && { id: g.id, state: g.state, bar: g.bar()?.text, ctx: g.context() }; });
  const settled = () => page.waitForFunction(() => { const { world } = window.__reverie, c = world.view.cam.position, g = world.game.camera.pos; return Math.hypot(c.x - g[0], c.y - g[1], c.z - g[2]) < .005; }, null, { timeout: 90000 });

  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
  await page.waitForSelector('#wake:not([hidden])', { timeout: 90000 });
  await page.click('#wake');
  await quiet();

  // ---- a lesson on volcanoes
  await say('teach me about volcanoes');
  await page.waitForFunction(() => window.__reverie.world.game?.id === 'lesson', null, { timeout: 60000 }).catch(() => fail('no lesson'));
  await quiet(); await settled().catch(() => fail('camera did not settle')); await page.waitForTimeout(300);
  await shot('1-title');
  await say('board please');
  await page.waitForFunction(() => /How a volcano erupts/.test(window.__reverie.world.game.context()), null, { timeout: 60000 }).catch(() => fail('nothing on the board'));
  await page.waitForFunction(() => window.__reverie.world.held, null, { timeout: 120000 }).catch(() => fail('no picture prop'));
  await quiet(); await page.waitForTimeout(800);
  await shot('2-board');
  await say('test me');
  await page.waitForFunction(() => window.__reverie.world.game.state === 'quiz', null, { timeout: 60000 }).catch(() => fail('no quiz'));
  await quiet(); await page.waitForTimeout(600);
  await shot('3-quiz');
  // "quiz me" during a lesson is not the trivia quiz
  // a tap on buzzer A, where it is on screen
  const at = await page.evaluate(() => {
    const { world, gs } = window.__reverie, THREE = gs.hd.THREE, cv = document.querySelector('#view');
    const g = world.game, b = new THREE.Vector3(); world.view.scene.traverse(o => { if (o.userData?.cap && o.userData.i === 0) o.getWorldPosition(b); });
    const q = b.project(world.view.cam), r = cv.getBoundingClientRect();
    return { x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height, g: !!g };
  });
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() => window.__reverie.world.game.state === 'shown', null, { timeout: 30000 }).catch(() => fail('a tap on the buzzer did not answer'));
  await page.waitForTimeout(700);
  await shot('4-answered');
  await page.waitForFunction(() => window.__reverie.brain.history.some(m => m.role === 'user' && typeof m.content === 'string' && /^\S*.*\[lesson\] They answered the quiz question right/m.test(m.content)), null, { timeout: 60000 }).catch(() => fail('Reverie never heard the answer'));
  await quiet();
  await say('end the lesson');
  await page.waitForFunction(() => window.__reverie.world.game.state === 'done', null, { timeout: 60000 }).catch(() => fail('the lesson did not end'));
  await quiet(); await page.waitForTimeout(600);
  await shot('5-done');
  let book = await page.evaluate(() => window.__reverie.learning.get('volcanoes'));
  console.log('volcanoes:', JSON.stringify(book));
  ok(book?.quiz.right === 1 && book.quiz.asked === 1 && book.points.includes('How a volcano erupts') && book.next === 'kinds of volcano', 'the lesson was kept');

  // ---- a Spanish lesson, after the volcano one
  await say('teach me spanish food');
  await page.waitForFunction(() => window.__reverie.world.game?.subject === 'Spanish', null, { timeout: 60000 }).catch(() => fail('no Spanish lesson'));
  await quiet();
  await say('new word');
  await page.waitForFunction(() => /la manzana/.test(window.__reverie.world.game.context()), null, { timeout: 60000 }).catch(() => fail('no word on the board'));
  await quiet(); await page.waitForTimeout(500);
  await shot('6-word');
  await say('test me on the word');
  await page.waitForFunction(() => window.__reverie.world.game.state === 'quiz', null, { timeout: 60000 }).catch(() => fail('no word quiz'));
  await quiet();
  // the trivia quiz must not take over a lesson
  const answered = await page.evaluate(async () => window.__reverie.world.game.command('the apple'));
  console.log('said answer:', answered);
  ok(/^Answered B/.test(answered), 'a spoken answer was played');
  await quiet();
  book = await page.evaluate(() => window.__reverie.learning.get('spanish'));
  ok(book?.words[0]?.box === 2 && book.kind === 'language', 'the word moved up a box');
  const g = await game(); console.log('lesson:', g.bar, '|', g.ctx);
  // the diary: its page today, the summary Claude reads, and the sheet
  const d = await page.evaluate(() => { const r = window.__reverie; r.diary.show(); return { days: Object.values(r.memory.all().days).flat(), memo: r.learning.summary(), sheet: document.querySelector('#diary .pages').textContent }; });
  console.log('diary days:', d.days.join(' | '));
  ok(d.days.some(l => /lesson on volcanoes/.test(l)) && d.days.some(l => /learned about volcanoes/i.test(l)) && d.days.some(l => /Spanish lesson on food/.test(l)), 'the lessons are in the diary\'s day');
  ok(/Learning together/.test(d.sheet) && /la manzana/.test(d.sheet), 'the diary sheet shows the lessons');
  await page.waitForTimeout(400);
  await shot('7-diary');
  await page.evaluate(() => window.__reverie.diary.hide());
  await page.click('#gamebar button[data-id="leave"]');
  ok(!(await game()), 'Done put the lesson away');
  await browser.close();
  console.log(process.exitCode ? 'lesson page: FAILED' : 'lesson page: ok');
}
