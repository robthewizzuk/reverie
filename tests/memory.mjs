// The diary on its own (no browser): visits and streaks across days, remember and forget, the records, and the summary
// Claude reads. Then, with a browser (start the dev server with REVERIE_FAKE=1), a second day's visit: the overnight
// surprise in its hands, the briefing, the diary reaching Claude, remembering a name, the diary sheet, and a reload.
//   node tests/memory.mjs            the diary alone
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/memory.mjs --page [url]
import { makeMemory, parseBirthday, dayOf, parseWhen, guessKind, BUDGET } from '../src/memory.js';
import { checkRecap, recapRequest } from '../server/recap.js';
import { fakeRecap } from './fake.js';

const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (cond, msg) => { if (!cond) fail(msg); };

// ---- the diary alone, with a clock that moves day by day
{
  const data = new Map(), store = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  let now = new Date('2026-11-20T09:00');
  const clock = () => now, next = (days, h = 9) => { now = new Date(now.getTime() + days * 864e5); now.setHours(h); };
  let m = makeMemory({ store, clock });
  ok(m.summary() === '', 'an empty diary says nothing');
  let v = m.visit(); ok(v.first && v.newDay, 'first visit');
  ok(!m.visit().newDay, 'a second visit the same day is not a new day');
  next(1); v = m.visit(); ok(v.newDay && v.away === 1 && m.visits.streak === 2, `next day: streak 2 (got ${m.visits.streak})`);
  next(1); m.visit(); ok(m.visits.streak === 3 && m.visits.days === 3, 'three days in a row');
  ok(typeof m.remember({ name: 'Rob', birthday: '21/3' }) === 'string' && m.name === 'Rob' && m.birthday === '03-21', 'name and a British birthday kept');
  m.remember({ fact: 'has a dog called Biscuit' }); m.remember({ fact: 'loves dinosaurs' });
  m.remember({ fact: 'has a dog called Biscuit now' });
  ok(m.all().facts.length === 2, `the same fact again replaces it (${m.all().facts.map(f => f.text)})`);
  ok(m.remember({ birthday: 'soonish' }).error, 'an unreadable birthday is refused');
  m.note('made', { what: 'a gold teapot' }); m.note('chess', { result: 'won' }); m.note('quiz', { score: 7, of: 10 });
  m.said('you', 'my dog is called Biscuit'); m.said('me', 'What a great name!');
  // a new object reads the same store: kept
  m = makeMemory({ store, clock });
  ok(m.name === 'Rob' && m.records.chess.won === 1 && m.records.quiz.best === 7, 'kept in the store');
  next(1); m.visit();
  const s = m.summary();
  console.log('summary:', s);
  for (const want of ['Rob', 'Biscuit', 'dinosaurs', 'they won 1', 'best 7', 'gold teapot', 'Last time (yesterday)', 'my dog is called Biscuit']) ok(s.includes(want), `summary has "${want}"`);
  ok(!/Earlier today/.test(s), 'nothing yet today');
  // a week later: "a week ago today"
  m.note('made', { what: 'a rocket' }); next(3); m.visit(); m.note('roll'); m.note('day', { line: 'rolled dice' }); next(4); m.visit();
  ok(m.visits.streak === 1, 'a gap breaks the streak');
  ok(/A week ago today: made a rocket/.test(m.summary()), 'a week ago today: ' + m.summary());
  // forgetting
  ok(/Forgot "has a dog/.test(m.forget({ what: 'the dog' })), 'forget the dog');
  ok(m.all().facts.length === 1, 'one fact left');
  ok(m.forget({ what: 'pizza' }).error, 'forgetting something not there says so');
  m.forget({ what: 'my name' }); ok(!m.name, 'name forgotten');
  m.forget({ what: 'everything' }); ok(!m.all().facts.length && !m.visits.first && m.summary() === '', 'everything forgotten');
  ok(!data.size || !JSON.parse(data.get('reverie.memory.v1')).facts.length, 'the store is empty too');
  // once a day
  ok(m.once('surprise') && !m.once('surprise'), 'once a day'); next(1); ok(m.once('surprise'), 'again the next day');
  ok(parseBirthday('March 21st') === '03-21' && parseBirthday('03-21') === '03-21' && parseBirthday('2001-12-05') === '12-05' && !parseBirthday('13-13'), 'birthdays read');
  ok(dayOf(new Date('2026-01-05T23:30')) === '2026-01-05', 'dayOf is the local day');
  console.log(process.exitCode ? 'memory: FAILED' : 'memory: ok');
}

// ---- knowing them: kinds, plans to ask about, recall, recaps, edits, the budget, an old diary, learning off
{
  const data = new Map(), store = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  let now = new Date('2026-11-25T18:30');   // a Wednesday evening
  const clock = () => now, next = (days, h = 18) => { now = new Date(now.getTime() + days * 864e5); now.setHours(h); };
  // dates and kinds
  ok(parseWhen('friday', '2026-11-25') === '2026-11-27' && parseWhen('tomorrow', '2026-11-25') === '2026-11-26' && parseWhen('next wednesday', '2026-11-25') === '2026-12-02'
    && parseWhen('wednesday', '2026-11-25') === '2026-11-25' && parseWhen('this weekend', '2026-11-25') === '2026-11-28' && parseWhen('3 december', '2026-11-25') === '2026-12-03'
    && parseWhen('in 3 days', '2026-11-25') === '2026-11-28' && parseWhen('soon', '2026-11-25') === null, 'plans are dated');
  const kinds = { 'has a dog called Biscuit': 'people', 'loves strawberry ice cream': 'likes', 'is learning the guitar': 'interests', 'walks the dog every morning': 'routine',
    'has a maths test on Friday': 'plan', "can't stand mushrooms": 'dislikes', 'is nervous about the move': 'feeling', 'is 9 years old': 'about', 'loves playing football': 'interests' };
  for (const [t, k] of Object.entries(kinds)) ok(guessKind(t) === k, `"${t}" is ${k} (got ${guessKind(t)})`);
  let m = makeMemory({ store, clock });
  m.visit();
  m.remember({ name: 'Rob' });
  m.remember({ fact: 'has a maths test', kind: 'plan', when: 'friday' });
  m.remember({ fact: 'has a sister called Mia' });
  m.remember({ fact: 'loves dinosaurs' });
  ok(m.all().facts.find(f => /maths/.test(f.text))?.when === '2026-11-27', 'the test is on Friday');
  ok(m.followUps().length === 1 && m.followUps()[0].said === 'on Friday', 'a plan to ask about: ' + JSON.stringify(m.followUps()));
  ok(/To ask about: has a maths test \(on Friday\)/.test(m.summary()), 'the summary asks about it: ' + m.summary());
  // the chat, boiled down by the (fake) recap
  m.said('you', 'i really love strawberry ice cream'); m.said('me', 'Yum!'); m.said('you', 'my dog is called pip');
  const p = m.pending(); ok(p.theirs === 2 && p.lines.length === 3, 'three lines waiting for a recap');
  const body = { ...m.forRecap(), lines: p.lines };
  ok(!checkRecap(body) && checkRecap({ lines: [] }), 'the recap body is checked');
  const req = recapRequest(body); ok(req.model === 'claude-haiku-5-5' && req.output_config.format.type === 'json_schema' && /has a maths test/.test(req.messages[0].content) && /Them: my dog is called pip/.test(req.messages[0].content), 'the recap request');
  const r = await (await fakeRecap(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))).json();
  // (and what a real one might send: a change, a drop, junk that must be skipped)
  const mia = m.all().facts.find(f => /Mia/.test(f.text)).id;
  r.update = [{ id: mia, text: 'has a big sister called Mia', kind: 'people', when: '' }, { id: 'nope', text: 'x' }]; r.drop = ['nope'];
  r.add.push({ kind: 'weird', text: '   ' });
  console.log('recap:', m.applyRecap(r, p.upTo));
  const facts = m.all().facts.map(f => `${f.kind}:${f.text}`);
  ok(facts.includes('likes:loves strawberry ice cream') && facts.includes('people:has a dog called Pip') && facts.includes('people:has a big sister called Mia') && facts.length === 5, 'the recap wrote in: ' + facts);
  ok(m.pending().lines.length === 0 && m.all().talks.length === 1, 'recapped: nothing waiting, one recap');
  m.said('you', 'what about you'); ok(m.pending().lines.length === 1, 'a new line waits for the next recap');
  // the next days: habits, follow-ups after the day, recall
  for (let i = 0; i < 4; i++) { next(1); m.visit(); }
  ok(/usually come in the evening/.test(m.habitLine()), 'habits: ' + m.habitLine());
  ok(m.followUps()[0]?.past && /ask how it went/.test(m.summary()), 'after Friday: ask how the test went');
  m.note('chess', { result: 'won', level: 2 }); m.note('chess', { result: 'won', level: 3 });
  for (let i = 0; i < 3; i++) m.note('play', { game: 'chess' });
  const s = m.summary(); console.log('summary 2:', s);
  for (const want of ['Rob', 'People and pets: has a dog called Pip', 'Likes:', 'What you talked about', 'beaten you 2 in a row', 'favourite game is chess']) ok(s.includes(want), `summary 2 has "${want}"`);
  ok(/sister called Mia/.test(m.recall({ about: 'my sister' })), 'recall a person: ' + m.recall({ about: 'my sister' }));
  ok(/ice cream/.test(m.recall({ about: 'what was the last week like' })) || /chatted/.test(m.recall({ about: 'last week' })), 'recall last week: ' + m.recall({ about: 'last week' }));
  ok(/they won 2/.test(m.recall({ about: 'chess' })), 'recall chess');
  ok(/Nothing in the diary/.test(m.recall({ about: 'volcanoes' })), 'recall something unknown');
  // the budget: lots of facts still fit in a small summary, and recall has the rest
  const THINGS = 'apples kites robots pirates owls rockets volcanoes jigsaws trains comets puffins tacos origami lanterns castles dragons marbles yoyos penguins planets crayons pancakes otters igloos geysers mazes banjos lemurs meteors quilts sloths tulips vikings walruses zebras badgers cactuses dominoes fireflies gnomes'.split(' ');
  for (let i = 0; i < 40; i++) m.remember({ fact: `${i % 2 ? 'adores' : 'collects'} ${THINGS[i]}`, kind: i % 2 ? 'likes' : 'interests' });
  ok(m.all().facts.length <= 48, 'the facts are capped: ' + m.all().facts.length);
  const big = m.summary(); ok(big.length < BUDGET + 400 && /use recall/.test(big), `the summary stays small (${big.length})`);
  ok(m.summary({ all: true }).length > big.length, 'recall everything is longer');
  // the sheet's edits
  ok(m.edit(mia, 'has a sister called Mia who is 12') && m.all().facts.some(f => f.text === 'has a sister called Mia who is 12'), 'a fact changed');
  ok(m.edit('name', 'Robert') && m.name === 'Robert', 'the name changed'); ok(!m.edit('birthday', 'whenever'), 'a bad birthday is refused');
  m.edit(mia, ''); ok(!m.all().facts.some(f => f.id === mia), 'an emptied fact is forgotten');
  ok(/Forgot/.test(m.forget({ what: 'the dog' })) && !m.all().talks.some(t => /dog/.test(t.text)) && !m.all().facts.some(f => /dog/.test(f.text)), 'forgetting the dog forgets the recap about it too');
  // learning off: no chat kept, no recaps
  m.learn = false; m.said('you', 'secret stuff'); ok(!m.pending().lines.length && m.applyRecap({ recap: 'x' }) === 'learning is off', 'learning off keeps nothing');
  m.learn = true;
  // an old (v1) diary is read and brought up to date
  data.set('reverie.memory.v1', JSON.stringify({ v: 1, name: 'Ann', facts: [{ id: 'f1', text: 'has a cat called Tom', day: '2026-11-01' }], chat: [{ who: 'you', text: 'hello', day: '2026-11-01' }], visits: { first: '2026-11-01', last: '2026-11-01', days: 1 }, records: { chess: { won: 1 } } }));
  m = makeMemory({ store, clock });
  ok(m.name === 'Ann' && m.all().facts[0].kind === 'people' && m.pending().theirs === 1 && m.records.chess.won === 1 && m.records.chess.run === 0, 'a v1 diary is read: ' + JSON.stringify(m.all().facts));
  m.applyRecap({ recap: 'We said hello.' }); ok(!m.pending().lines.length && m.all().talks[0].day === '2026-11-01', 'its old chat recapped on its own day');
  console.log(process.exitCode ? 'memory knowing: FAILED' : 'memory knowing: ok');
}

// ---- in the page: a second day
if (process.argv.includes('--page')) {
  const { createRequire } = await import('node:module');
  const { chromium } = createRequire(import.meta.url)('playwright');
  const { mkdirSync } = await import('node:fs');
  const url = process.argv.find(a => a.startsWith('http')) || 'http://localhost:5179/?debug';
  mkdirSync('tests/out', { recursive: true });
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 820 }, deviceScaleFactor: 1, permissions: ['geolocation'], geolocation: { latitude: 53.8, longitude: -1.55 } });
  const page = await ctx.newPage();
  await page.route('**/api.bigdatacloud.net/**', r => r.fulfill({ json: { city: 'Leeds', principalSubdivision: 'England', countryName: 'United Kingdom', countryCode: 'GB' } }));
  await page.route('**/api.open-meteo.com/**', r => r.fulfill({ json: { current: { temperature_2m: 6.4, apparent_temperature: 3.1, weather_code: 61, wind_speed_10m: 19.6, is_day: 1 },
    daily: { time: ['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'], weather_code: [61, 3, 0, 71], temperature_2m_max: [8, 7, 6, 2], temperature_2m_min: [4, 3, 1, -1], precipitation_probability_max: [80, 20, 0, 60], sunrise: ['2026-11-26T07:52'], sunset: ['2026-11-26T15:47'] } } }));
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', msg => { if (msg.type() === 'error' || /\[reverie\]/.test(msg.text())) console.log('  page:', msg.text().slice(0, 240)); });
  const shot = name => page.screenshot({ path: `tests/out/${name}.png` });
  // yesterday's diary, as if they came yesterday
  const y = new Date(Date.now() - 864e5), yd = dayOf(y);
  const kept = { v: 1, name: null, birthday: null, facts: [{ id: 'f1', text: 'loves dinosaurs', day: yd }],
    visits: { first: yd, last: yd, days: 1, streak: 1, best: 1, count: 2 },
    records: { chess: { won: 0, lost: 1, drawn: 0 }, quiz: { rounds: 1, best: 6, right: 6, asked: 10 }, made: 1, rolls: 0, doodles: 0 },
    made: [{ what: 'a blue rocket', day: yd }], days: { [yd]: ['made a blue rocket', 'Reverie won at chess'] }, chat: [{ who: 'you', text: 'tell me about dinosaurs', day: yd }], seen: {} };
  await page.addInitScript(k => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('reverie.memory.v1', k); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(kept));
  await page.goto(url);
  await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
  await page.waitForSelector('#wake:not([hidden])', { timeout: 90000 });
  await page.waitForFunction(() => window.__reverie.today.surprise, null, { timeout: 60000 }).catch(() => fail('no surprise'));
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => ({ held: window.__reverie.world.held?.short, today: window.__reverie.today }));
  console.log('waiting for them:', JSON.stringify(before));
  ok(before.held, 'something made overnight is in its hands');
  await shot('memory-1-surprise');
  await page.click('#wake');
  await page.waitForFunction(() => window.__reverie.brain.history.length >= 2 && !window.__reverie.brain.busy, null, { timeout: 60000 }).catch(() => fail('no briefing'));
  const first = await page.evaluate(() => window.__reverie.brain.history[0].content);
  console.log('briefing asked for:', first.slice(0, 600));
  ok(/^\[A new day/m.test(first.split('\n').slice(-1)[0]) || /\[A new day/.test(first), 'the briefing was asked for');
  ok(/in your hands now/.test(first) && /Today's (puzzle|surprise)/.test(first), 'the surprise is in it');
  ok(/The weather: Weather in Leeds/.test(first), 'the weather is in it');
  await page.waitForTimeout(1200);
  await shot('memory-2-briefing');
  // the diary reached Claude (it rides on the first message of what's sent)
  const sent = [];
  page.on('request', r => { if (r.url().includes('/api/turn')) sent.push(r.postDataJSON()); });
  await page.fill('#say', 'my name is rob'); await page.press('#say', 'Enter');
  await page.waitForFunction(() => window.__reverie.memory.name === 'Rob' && !window.__reverie.brain.busy, null, { timeout: 30000 }).catch(() => fail('the name was not kept'));
  const firstSent = sent[0]?.messages?.[0]?.content || '';
  ok(/^\[Your diary[^\]]*loves dinosaurs[^\]]*Reverie won|you won 1/.test(firstSent) || /\[Your diary[^\]]*loves dinosaurs/.test(firstSent), 'the diary reached Claude: ' + firstSent.slice(0, 200));
  ok(!(await page.evaluate(() => window.__reverie.brain.history[0].content)).startsWith('[Your diary'), 'the diary is not kept in the history');
  await page.fill('#say', 'remember that i have a dog called biscuit'); await page.press('#say', 'Enter');
  await page.waitForFunction(() => window.__reverie.memory.all().facts.length === 2 && !window.__reverie.brain.busy, null, { timeout: 30000 }).catch(() => fail('the fact was not kept'));
  // a chat boiled down into the diary (the fake recap): something they never asked it to remember
  await page.fill('#say', 'i really love pancakes'); await page.press('#say', 'Enter');
  await page.waitForFunction(() => !window.__reverie.brain.busy, null, { timeout: 30000 });
  await page.evaluate(() => window.__reverie.recapper.now('test'));
  const learned = await page.evaluate(() => ({ facts: window.__reverie.memory.all().facts.map(f => f.text), talks: window.__reverie.memory.all().talks.length }));
  ok(learned.facts.includes('loves pancakes') && learned.talks >= 1, 'learned from the chat: ' + JSON.stringify(learned));
  // the diary sheet
  await page.click('#book'); await page.waitForTimeout(400);
  for (const want of ['Things you love', 'What we talked about', 'Learn about me from our chats']) ok((await page.textContent('#diary')).includes(want), `the diary shows "${want}"`);
  // written in by hand, and changed
  await page.fill('#diary .add input', 'has a sister called Mia'); await page.click('#diary .add button');
  const mia = await page.evaluate(() => window.__reverie.memory.all().facts.find(f => f.text === 'has a sister called Mia'));
  ok(mia?.kind === 'people', 'a fact added from the sheet: ' + JSON.stringify(mia));
  await page.click(`#diary [data-edit="${mia.id}"]`); await page.fill(`#diary [data-input="${mia.id}"]`, 'has a big sister called Mia'); await page.press(`#diary [data-input="${mia.id}"]`, 'Enter');
  ok((await page.textContent('#diary')).includes('has a big sister called Mia'), 'a fact changed from the sheet');
  await page.click(`#diary [data-drop="${mia.id}"]`);
  const sheet = await page.textContent('#diary');
  for (const want of ['About Rob', 'loves dinosaurs', 'biscuit', 'Chess: you 0, me 1', 'Today', 'Yesterday']) ok(sheet.toLowerCase().includes(want.toLowerCase()), `the diary shows "${want}"`);
  await shot('memory-3-diary');
  await page.click('#diary [data-drop="f1"]'); await page.waitForTimeout(200);
  ok(!(await page.textContent('#diary')).includes('loves dinosaurs'), 'a fact forgotten from the sheet');
  await page.click('#diary [data-id="close"]');
  // a reload the same day: remembered, no second surprise
  await page.reload();
  await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
  await page.waitForSelector('#wake:not([hidden])', { timeout: 90000 });
  await page.waitForTimeout(1500);
  const again = await page.evaluate(() => ({ name: window.__reverie.memory.name, facts: window.__reverie.memory.all().facts.length, held: !!window.__reverie.world.held }));
  ok(again.name === 'Rob' && again.facts === 2 && !again.held, 'after a reload: remembered, and no second surprise ' + JSON.stringify(again));
  await page.click('#wake'); await page.waitForTimeout(1500);
  ok(/Welcome back, Rob|back, Rob|again, Rob/.test(await page.textContent('#caption')), 'welcomed back by name: ' + await page.textContent('#caption'));
  // forget everything, from the sheet (pressed twice)
  await page.click('#book'); await page.click('#diary [data-id="wipe"]'); await page.click('#diary [data-id="wipe"]');
  ok(!(await page.evaluate(() => window.__reverie.memory.name)), 'everything forgotten');
  if (errors.length) fail('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log(process.exitCode ? 'memory page: FAILED' : 'memory page: ok');
}
