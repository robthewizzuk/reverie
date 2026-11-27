// Karaoke: the songs' tunes and words (here, no page), then the page against the scripted Claude:
//   node tests/karaoke.mjs --unit                      the tunes, the syllables and the LRC reader only
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/karaoke.mjs [url]
// It asks for a song, checks the words show and light up in time with the band, the mirror ball comes down and the
// lights come up, that a song Claude writes plays too, and that stop puts everything away.
import assert from 'node:assert/strict';
import { written, fixed, rhythm, lengthOf } from '../src/tune.js';
import { OWN, FIXED, songNamed } from '../src/songs.js';
import { parseLrc, lineAt } from '../src/lyrics.js';
import { syllables } from '../engine/src/kit/sing.js';

// ---- the tunes: every own song planned, a note for every syllable, in time and in range
for (const [id, s] of Object.entries(OWN)) {
  const p = written(s);
  assert.ok(p && p.lines.length >= 12, `${id}: ${p?.lines.length} lines`);
  let last = -1;
  for (const l of p.lines) {
    assert.equal(l.notes.length, syllables(l.text).length, `${id}: a note a syllable in "${l.text}"`);
    assert.ok(l.start > last, `${id}: lines in order`); last = l.start;
    for (const [m, at, len] of l.notes) { assert.ok(m >= 50 && m <= 84, `${id}: note ${m} in a singing range`); assert.ok(at >= 0 && len > .05, `${id}: note timing`); }
    assert.ok(l.start + l.notes.at(-1)[1] + l.notes.at(-1)[2] <= lengthOf(p) + .01, `${id}: inside the song`);
  }
  // a chorus comes back with the same tune
  const ch = p.lines.filter(l => l.kind === 'chorus' || l.kind === 'last'), steps = l => l.notes.slice(1).map((n, i) => n[0] - l.notes[i][0]);
  if (ch.length >= 8) assert.deepEqual(steps(ch[0]), steps(ch[4]), `${id}: the chorus is the same tune each time`);
  assert.equal(p.music.lead.split(' ').length, p.steps, `${id}: the band is as long as the song`);
  assert.ok(lengthOf(p) > 60 && lengthOf(p) < 200, `${id}: ${lengthOf(p).toFixed(0)} s long`);
}
// long and short lines still fit their two bars
for (const S of [1, 3, 7, 12, 16]) { const b = rhythm(S, 16); assert.equal(b.length, S); assert.ok(b.at(-1).at + b.at(-1).len <= 16, `${S} syllables fit`); for (let i = 1; i < S; i++) assert.ok(b[i].at >= b[i - 1].at + b[i - 1].len - 1e-9, 'no overlaps'); }
// the old songs: their own tunes, the birthday one with a name
const hb = fixed(FIXED['happy birthday'], { name: 'Rob' });
assert.equal(hb.lines[2].text, 'Happy birthday dear Rob');
assert.equal(hb.lines.length, 4);
const tw = fixed(FIXED['twinkle twinkle']);
assert.deepEqual(tw.lines[0].notes.map(n => n[0]), [60, 60, 67, 67, 69, 69, 67]);
for (const l of tw.lines) assert.equal(l.notes.length, syllables(l.text).length, `a note a syllable in "${l.text}"`);
assert.equal(songNamed('happy birthday to you')?.id, 'happy birthday');
assert.equal(songNamed('Robot Disco')?.id, 'robot disco');
assert.equal(songNamed('bohemian rhapsody'), null);
// Claude's own words: planned, odd punctuation and all
const mine = written({ title: 'Biscuit', verse: ['My dog is called Biscuit.', 'He sleeps on the stairs!'], chorus: ['Biscuit, Biscuit', 'Wag your tail for me'], mood: 'silly' });
assert.ok(mine.lines.length >= 8 && !/[.!]/.test(mine.lines[0].text));
// ---- LRC: lines, word times, several times on a line, the offset
const L = parseLrc('[ti:Test]\n[ar:Someone]\n[offset:500]\n[00:10.00]First line\n[00:12.50][00:20.00]Again\n[00:15.00]<00:15.00>Word <00:15.40>by <00:15.80>word\nno time here');
assert.equal(L.title, 'Test'); assert.equal(L.lines.length, 4);
assert.equal(L.lines[0].at, 9.5); assert.equal(L.lines[1].text, 'Again'); assert.equal(L.lines[3].text, 'Again');
assert.equal(L.lines[2].words.length, 3); assert.equal(L.lines[2].words[1].at, 14.9);
assert.equal(lineAt(L, 13).line.text, 'Again'); assert.equal(lineAt(L, 5).line, null);
assert.equal(parseLrc('just words\nno times'), null);
console.log('karaoke: tunes, songs and lyrics ok');
if (process.argv.includes('--unit')) process.exit(0);

// ---- the page
const { createRequire } = await import('node:module'), { mkdirSync } = await import('node:fs');
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv.slice(2).find(a => !a.startsWith('--')) || 'http://localhost:5179/?debug';
mkdirSync('tests/out', { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
await page.route('**/api.bigdatacloud.net/**', r => r.abort());
await page.route('**/api.open-meteo.com/**', r => r.abort());
const errors = []; page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') console.log('  page:', m.text().slice(0, 300)); });
let fails = 0; const fail = msg => { console.error('FAIL:', msg); fails++; };
const say = async t => { await page.fill('#say', t); await page.press('#say', 'Enter'); };

await page.goto(url);
await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 120000 });
await page.click('#wake');
await page.waitForTimeout(800);
await say('sing robot disco');
await page.waitForFunction(() => window.__reverie.karaoke.playing, null, { timeout: 30000 }).catch(() => fail('the song never started'));
await page.waitForFunction(() => !document.querySelector('#karaoke').hidden, null, { timeout: 15000 }).catch(() => fail('no words on screen'));
// the band reaches the first line (about 4 s of intro), its words light up
await page.waitForFunction(() => [...document.querySelectorAll('#karaoke .now span')].some(s => +s.style.getPropertyValue('--k') > .5), null, { timeout: 20000 }).catch(() => fail('the words never lit up'));
const s1 = await page.evaluate(() => ({ title: document.querySelector('#karaoke .title').textContent, now: document.querySelector('#karaoke .now').textContent, next: document.querySelector('#karaoke .next').textContent,
  party: window.__reverie.world.party.on, dim: window.__reverie.world.party.dim, dancing: window.__reverie.world.creature.dancing, line: window.__reverie.karaoke.line() }));
console.log('singing:', s1);
if (s1.title !== 'Robot Disco') fail('wrong title ' + s1.title);
if (!/Beep beep|Whirr/.test(s1.now)) fail('not the first lines: ' + s1.now);
if (!s1.party || !(s1.dim < .95)) fail('the party lights are not up');
if (!s1.dancing) fail('Reverie is not bopping to it');
if (!/karaoke/.test(s1.line)) fail('Claude is not told a song is on');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'tests/out/karaoke.png' });
// heard words while it sings are not taken as talk, unless they have its name or a stop
const heard = await page.evaluate(() => [window.__reverie.karaoke.heardOk('beep beep goes the toaster'), window.__reverie.karaoke.heardOk('Reverie, that was great'), window.__reverie.karaoke.heardOk('stop the song')]);
if (heard.join() !== 'false,true,true') fail('the mic filter: ' + heard);
await say('stop the song');
await page.waitForFunction(() => !window.__reverie.karaoke.playing, null, { timeout: 15000 }).catch(() => fail('stop did not stop it'));
await page.waitForFunction(() => window.__reverie.world.party.dim > .99, null, { timeout: 20000 }).catch(() => {});
const s2 = await page.evaluate(() => ({ hidden: document.querySelector('#karaoke').hidden, party: window.__reverie.world.party.on, dim: window.__reverie.world.party.dim }));
if (!s2.hidden || s2.party || s2.dim < .99) fail('not put away after stop: ' + JSON.stringify(s2));
// a song Claude writes
await say('write a song');
await page.waitForFunction(() => window.__reverie.karaoke.playing && document.querySelector('#karaoke .title').textContent === 'Biscuit Blues', null, { timeout: 30000 }).catch(() => fail('a new song did not start'));
await page.waitForTimeout(6000);
const now3 = await page.evaluate(() => document.querySelector('#karaoke .now').textContent);
if (!/Biscuit|stairs|postman|scared/.test(now3)) fail('its own words are not shown: ' + now3);
await page.screenshot({ path: 'tests/out/karaoke-new.png' });
await say('stop the song');
if (errors.length) fail('page errors: ' + errors.join(' | '));
await browser.close();
console.log(fails ? `karaoke: ${fails} failed` : 'karaoke: all passed');
process.exit(fails ? 1 : 0);
