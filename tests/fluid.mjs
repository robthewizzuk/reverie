// Talking to it feels fluid: checks the turn-taking with a stand-in speech recogniser (the page's own Listener, fed
// words as a browser's recogniser would give them) and the scripted Claude.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/fluid.mjs [url]
// What it checks:
//   1. words that stop are answered after the pause (SETTLE_MS), not when the recogniser is sure (here 2.5 s later),
//      and the recogniser's final for the same words is not asked again
//   2. a pause mid-sentence ("can you make me" ... "a blue teapot") is one question, not two
//   3. the recogniser ending a session with words still unfinished doesn't lose them
//   4. the first thing said after a quiet spell starts on its first clause; later sentences go whole
//   5. a dropped connection before any reply is tried again unseen (no "Oops")
//   6. the voice and the prompt cache are warmed while it wakes
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const url = process.argv[2] || 'http://localhost:5179/?debug';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1, permissions: ['microphone'] });
await page.route('**/api.bigdatacloud.net/**', r => r.fulfill({ json: { city: 'Leeds', countryName: 'United Kingdom', countryCode: 'GB' } }));
await page.route('**/api.open-meteo.com/**', r => r.abort());
let warmed = 0, failNext = 0, turns = 0;
await page.route('**/api/warm', r => { warmed++; r.continue(); });
await page.route('**/api/turn', r => { turns++; if (failNext > 0) { failNext--; return r.abort('connectionreset'); } r.continue(); });

// a recogniser that says what the test tells it to: window.__heard(text, final) and window.__end()
await page.addInitScript(() => {
  Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
  window.__gsOwnVoice = false;   // (the built-in voice can't download here: the browser's own, or the bubble alone)
  class FakeRec {
    start() { window.__rec = this; this.results = []; setTimeout(() => { this.onstart?.(); this.onaudiostart?.(); }, 10); }
    stop() { this.abort(); }
    abort() { if (window.__rec === this) window.__rec = null; setTimeout(() => this.onend?.(), 5); }
  }
  window.SpeechRecognition = FakeRec;
  const ev = rec => { const results = rec.results.map(r => Object.assign([{ transcript: r.t }], { isFinal: r.final })); return { resultIndex: rec.from, results }; };
  window.__heard = (t, final = false) => {
    const rec = window.__rec; if (!rec) return false;
    rec.from ??= 0;
    if (rec.results.length && !rec.results.at(-1).final) rec.results.at(-1).t = t, rec.results.at(-1).final = final;
    else rec.results.push({ t, final });
    rec.onresult?.(ev(rec));
    if (final) rec.from = rec.results.length;
    return true;
  };
  window.__end = () => { const rec = window.__rec; if (!rec) return; window.__rec = null; rec.onend?.(); };
});

const errors = [], logs = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { const t = m.text(); if (/\[reverie\]/.test(t)) { logs.push(t); if (!/mic: (sound|audio|speech|start)/.test(t)) console.log('  page:', t.slice(0, 200)); } });
let failed = 0;
const fail = msg => { console.error('FAIL:', msg); failed++; process.exitCode = 1; };
const ok = msg => console.log('ok:', msg);
const wait = ms => page.waitForTimeout(ms);
const said = () => page.evaluate(() => window.__reverie.brain.history.filter(m => m.role === 'user' && typeof m.content === 'string').map(m => m.content.split('\n').slice(1).join(' ')));
const quiet = () => page.waitForFunction(() => !window.__reverie.brain.busy && !window.__reverie.brain.speaking, null, { timeout: 60000 });

await page.goto(url);
await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 120000 });
if (warmed) ok('the prompt cache is warmed while it wakes'); else fail('no /api/warm before the first tap');
await page.click('#wake');
await page.waitForFunction(() => window.__rec, null, { timeout: 20000 }).catch(() => fail('the recogniser never started'));
await quiet(); await wait(300);

// 1. answered at the pause
let n0 = (await said()).length;
const t0 = Date.now();
await page.evaluate(() => window.__heard('make me a red dragon'));
await page.waitForFunction(n => window.__reverie.brain.history.filter(m => m.role === 'user' && typeof m.content === 'string').length > n, n0, { timeout: 5000 }).catch(() => {});
const took = Date.now() - t0;
if (took < 1500) ok(`answered ${took} ms after the words stopped (the recogniser's final came 2500 ms after)`); else fail(`took ${took} ms to answer`);
await wait(2500 - took);
await page.evaluate(() => window.__heard('make me a red dragon', true));
await quiet(); await wait(500);
let s = await said();
if (s.filter(x => /red dragon/.test(x)).length === 1) ok('the final for the same words was not asked again'); else fail('asked twice: ' + JSON.stringify(s.slice(n0)));

// 2. a pause mid-sentence is one question
n0 = s.length;
await page.evaluate(() => window.__heard('can you make me'));
await wait(900);                        // (settled: a turn has started)
await page.evaluate(() => window.__heard('can you make me a blue teapot'));
await wait(300);
await page.evaluate(() => window.__heard('can you make me a blue teapot', true));
await quiet(); await wait(500);
s = (await said()).slice(n0);
if (s.length === 1 && /can you make me a blue teapot/.test(s[0])) ok('a pause mid-sentence is one question: ' + JSON.stringify(s[0].slice(0, 60)));
else fail('a pause split the question: ' + JSON.stringify(s));
const hist = await page.evaluate(() => window.__reverie.brain.history.map(m => m.role + ':' + (typeof m.content === 'string' ? 'text' : m.content.map(b => b.type).join(','))).join(' '));
if (/user:text user:text/.test(hist)) fail('two of their messages in a row: ' + JSON.stringify(await page.evaluate(() => window.__reverie.brain.history.map(m => m.role + ': ' + JSON.stringify(m.content).slice(0, 140)))));

// 3. a session that ends with words unfinished
n0 = (await said()).length;
await page.evaluate(() => window.__heard('throw it'));
await wait(150);
await page.evaluate(() => window.__end());
await page.waitForFunction(n => window.__reverie.brain.history.filter(m => m.role === 'user' && typeof m.content === 'string').length > n, n0, { timeout: 3000 })
  .then(() => ok('words still being heard when the session ended were answered'), () => fail('words lost when the recogniser session ended'));
await quiet(); await wait(400);
await page.waitForFunction(() => window.__rec, null, { timeout: 5000 }).catch(() => fail('the recogniser did not start again'));

// 4. the first clause goes first, on its own, only after a quiet spell
const lines = await page.evaluate(async () => {
  const { makeSpeaker } = await import('/src/brain.js');
  const out = [];
  const creature = { state: {}, face: { hush() {} }, say: line => { out.push(line); return new Promise(r => setTimeout(() => r(true), 700)); } };
  const sp = makeSpeaker(creature, () => {});
  for (const w of 'Ooh, a dragon is a wonderful thing to make, let me see what I can do. Here it comes, nice and big, with wings and a tail. '.split(/(?<= )/)) sp.feed(w);   // (all at once: on this slow test machine a pause between words outlasts a line)
  sp.flush(); await sp.done(); return out;
});
if (lines[0] === 'Ooh, a dragon is a wonderful thing to make,' && lines[1] === 'let me see what I can do.' && lines.includes('Here it comes, nice and big, with wings and a tail.')) ok('first clause first: ' + JSON.stringify(lines));
else fail('lines were ' + JSON.stringify(lines));

// 5. a dropped connection before any reply is tried again
n0 = (await said()).length;
failNext = 1;
await page.evaluate(() => window.__heard('hello little friend', true));
await quiet(); await wait(300);
const last = await page.evaluate(() => JSON.stringify(window.__reverie.brain.history.at(-1)));
if (/fuzzy/.test(last) || !/assistant/.test(last)) fail('the dropped connection showed: ' + last.slice(0, 200)); else ok('a dropped connection was tried again, unseen');

if (errors.length) fail('page errors: ' + errors.join(' | '));
const timing = logs.filter(l => /taken .* first words/.test(l));
console.log(timing.slice(-4).map(l => '  ' + l).join('\n'));
console.log(failed ? `${failed} failed` : 'all passed');
await browser.close();
