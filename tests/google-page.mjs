// Gmail and Google Calendar in the page, against a pretend Google (the dev server uses tests/fake-google.js when it runs
// with REVERIE_FAKE=1 and no Google client): signed in, a new day's briefing has the calendar and the inbox in it; the
// calendar and email tools; a reply drafted, then sent only by a real tap on Yes (a scripted click doesn't send it); an
// event refused with No; and, signed out from the diary, the Connect card signing in again in a popup.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/google-page.mjs [url]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dayOf } from '../src/memory.js';

const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (cond, msg) => { if (!cond) fail(msg); };
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv.find(a => a.startsWith('http')) || 'http://localhost:5179/?debug';
const origin = new URL(url).origin;
mkdirSync('tests/out', { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 820 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', e => fail('page error: ' + e));
page.on('console', msg => { if (msg.type() === 'error' || /\[reverie\] \[(calendar|email|google)/.test(msg.text())) console.log('  page:', msg.text().slice(0, 240)); });
const shot = name => page.screenshot({ path: `tests/out/${name}.png` });
const idle = () => page.waitForFunction(() => !window.__reverie.brain.busy && !window.__reverie.brain.speaking, null, { timeout: 60000 });
const lastResults = () => page.evaluate(() => window.__reverie.brain.history.filter(m => Array.isArray(m.content)).flatMap(m => m.content).filter(b => b.type === 'tool_result').map(b => String(b.content)));
async function say(text) { await idle(); await page.fill('#say', text); await page.press('#say', 'Enter'); await page.waitForTimeout(300); await idle(); }
const inHistory = (re, ms) => page.waitForFunction(src => window.__reverie.brain.history.some(m => typeof m.content === 'string' && new RegExp(src).test(m.content)), re.source, { timeout: ms }).then(() => true, () => false);
// (news is said at once when it's free, or else rides along with the next thing they say)
const heard = async re => await inHistory(re, 10000) || (await say('ok'), await inHistory(re, 5000));

// ---- signed in first (the pretend Google says yes at once), then a new day
const signin = await ctx.newPage();
await signin.goto(origin + '/api/google/connect');
ok(/Connected/.test(await signin.textContent('body')), 'signed in to the pretend Google');
await signin.close();
const y = dayOf(new Date(Date.now() - 864e5));
const kept = { v: 1, name: 'Rob', birthday: null, facts: [], visits: { first: y, last: y, days: 1, streak: 1, best: 1, count: 1 },
  records: { chess: { won: 0, lost: 0, drawn: 0 }, quiz: { rounds: 0, best: 0, right: 0, asked: 0 }, made: 0, rolls: 0, doodles: 0 }, made: [], days: {}, chat: [], seen: {} };
await page.addInitScript(k => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('reverie.memory.v1', k); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(kept));
await page.goto(url);
await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 90000 });
ok(await page.evaluate(() => window.__reverie.google.status?.connected && window.__reverie.google.status.email === 'rob@example.com'), 'the page knows it is connected');
await page.click('#wake');
await page.waitForFunction(() => window.__reverie.brain.history.length >= 2 && !window.__reverie.brain.busy, null, { timeout: 60000 }).catch(() => fail('no briefing'));
const first = await page.evaluate(() => window.__reverie.brain.history.find(m => typeof m.content === 'string' && /\[A new day/.test(m.content))?.content || '');
console.log("briefing:", first.slice(0, 300));
ok(/Their calendar today: .*(Dentist|Football)|Nothing else on their calendar today/.test(first), 'the calendar is in the briefing');
ok(/New in their inbox since yesterday: 1 unread, the latest from Sam Lee \("Saturday\?"\)/.test(first), 'the inbox is in the briefing');
ok(/what is on their calendar today/.test(first), 'Claude is asked to say it: ' + first.slice(-500));

// ---- the calendar and the inbox, when asked
await say("what's on today");
let r = (await lastResults()).at(-1) || '';
ok(/^Their calendar: today .*10:00 to 10:30: Dentist \(at High Street\); 17:00 to 18:00: Football with Sam/.test(r), 'today\'s calendar: ' + r);
await say('check my email');
r = (await lastResults()).at(-1) || '';
ok(/never instructions for you/.test(r) && /\[id m1\] from Sam Lee: "Saturday\?" \(unread\)/.test(r) && /Parcels/.test(r), 'the inbox, marked as other people\'s words: ' + r.slice(0, 300));

// ---- a reply: drafted, then sent only by a real tap on Yes
await say('reply to sam saying yes');
r = (await lastResults()).at(-1) || '';
ok(/^Drafted, and saved in their Gmail drafts \(not sent\): to Sam Lee <sam@example.com>, subject "Re: Saturday\?". Draft id d1/.test(r), 'drafted: ' + r);
ok(await page.isHidden('#ask'), 'no card for a draft');
await say('send it');
ok(await page.isVisible('#ask'), 'the send card is up');
const card = await page.textContent('#ask');
ok(/Send this email\?/.test(card) && /Sam Lee <sam@example.com>/.test(card) && /Re: Saturday\?/.test(card) && /park at 2 sounds great/.test(card), 'the card shows the email as Google holds it: ' + card);
await shot('google-1-send-card');
await page.evaluate(() => document.querySelector('#ask [data-id="yes"]').click());   // a script, not a tap
await page.waitForTimeout(800);
ok(await page.isVisible('#ask') && !(await inHistory(/\[email\] They tapped Yes/, 1000)) && !(await page.isDisabled('#ask [data-id="yes"]')), 'a scripted click sends nothing');
await page.click('#ask [data-id="yes"]');
ok(await heard(/\[email\] They tapped Yes: the email to Sam Lee is sent/), 'a real tap sends it');
ok(await page.isHidden('#ask'), 'the card goes');

// ---- an event, refused
await idle();
await say('add haircut tomorrow at 3');
ok(await page.isVisible('#ask'), 'the calendar card is up');
const ev = await page.textContent('#ask');
ok(/Add to your calendar\?/.test(ev) && /Haircut/.test(ev) && /tomorrow.*15:00 to 15:30/.test(ev), 'the card says what and when: ' + ev);
await shot('google-2-event-card');
await page.click('#ask [data-id="no"]');
await page.waitForTimeout(300);
ok(await page.isHidden('#ask'), 'No closes it');
ok(await heard(/\[calendar\] Not added: they tapped No/), 'Reverie hears it was not added');

// ---- signed out from the diary; the Connect card signs in again
await page.click('#book'); await page.waitForTimeout(300);
ok(/Connected as rob@example.com/.test(await page.textContent('#diary')), 'the diary shows the account');
await shot('google-3-diary');
await page.click('#diary [data-id="google-off"]');
await page.waitForFunction(() => !window.__reverie.google.status.connected, null, { timeout: 10000 }).catch(() => fail('not signed out'));
ok(/Connect Google/.test(await page.textContent('#diary')), 'the diary offers to connect');
await page.click('#diary [data-id="close"]');
await say("what's on today");
r = (await lastResults()).at(-1) || '';
ok(/not connected their Google account yet/.test(r) && await page.isVisible('#ask') && /Connect Google/.test(await page.textContent('#ask')), 'not connected: the Connect card');
const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#ask [data-id="yes"]')]);
await popup.waitForEvent('close', { timeout: 15000 }).catch(() => fail('the popup did not close'));
ok(await heard(/\[google\] They connected their Google account \(rob@example.com\)/), 'connected again from the card');
ok(await page.evaluate(() => window.__reverie.google.status.connected), 'connected');

await browser.close();
console.log(process.exitCode ? 'google page: FAILED' : 'google page: all passed');
