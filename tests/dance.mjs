// Dancing: the page hears a drum loop at 120 a minute through a pretend microphone (Chromium plays a made-up WAV as
// the mic), is asked to dance, and should find the beat and dance on it, with its lamp pulsing. Then the music tool
// with no Spotify sign-in shows the Connect Spotify button. Uses the scripted Claude:
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/dance.mjs [url]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const url = process.argv[2] || 'http://localhost:5179/?debug';
const BPM = 120;
mkdirSync('tests/out', { recursive: true });

// a drum loop: a kick on every beat, a hi-hat between, a snare on 2 and 4, at 48 kHz, 40 s
function drums(path) {
  const rate = 48000, secs = 40, n = rate * secs, data = new Int16Array(n), spb = 60 / BPM;
  let seed = 3; const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / rate, b = t / spb, ph = (b % 1) * spb, beat = Math.floor(b), hp = ((b + .5) % 1) * spb;
    let x = Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-ph * 30)) * ph) * Math.exp(-ph * 9) * .8;    // kick
    if (beat % 2 === 1) x += noise() * Math.exp(-ph * 22) * .35;                                      // snare
    x += noise() * Math.exp(-hp * 60) * .18 + noise() * .01;                                         // hat, hiss
    data[i] = Math.max(-1, Math.min(1, x)) * 30000;
  }
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n * 2, 40);
  writeFileSync(path, Buffer.concat([h, Buffer.from(data.buffer)]));
}
const wav = resolve('tests/out/drums.wav'); drums(wav);

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1, permissions: ['microphone'] });
await page.route('**/api.bigdatacloud.net/**', r => r.abort());
await page.route('**/api.open-meteo.com/**', r => r.abort());
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' || /\[reverie\] (groove|spotify|music)/.test(m.text())) console.log('  page:', m.text().slice(0, 300)); });
let fails = 0; const fail = msg => { console.error('FAIL:', msg); fails++; };

await page.goto(url);
await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 90000 });
await page.click('#wake');
await page.waitForTimeout(500);
await page.fill('#say', 'dance with me'); await page.press('#say', 'Enter');
await page.waitForFunction(() => window.__reverie.music.groove.on, null, { timeout: 30000 }).catch(() => fail('the groove never started listening'));
// the beat is found within a few seconds
await page.waitForFunction(() => window.__reverie.music.groove.sure > .3, null, { timeout: 20000 }).catch(() => fail('no beat found'));
await page.waitForTimeout(3000);
const g = await page.evaluate(() => { const m = window.__reverie.music; return { bpm: m.groove.bpm, sure: m.groove.sure, raw: m.groove.raw, dancing: window.__reverie.world.creature.dancing, line: m.line() }; });
console.log('groove:', g);
if (!(Math.abs(g.bpm - BPM) < 2 || Math.abs(g.bpm - 2 * BPM) < 3)) fail(`heard ${g.bpm?.toFixed(1)} a minute, not ${BPM}`);
if (!g.dancing) fail('not dancing');
if (!/dancing/.test(g.line)) fail('Claude is not told it is dancing');
// the lamp pulses: sampled over a second, the pulse goes up and down
const pulses = await page.evaluate(async () => { const out = []; for (let i = 0; i < 30; i++) { out.push(window.__reverie.world.light.pulse); await new Promise(r => setTimeout(r, 33)); } return out; });
if (Math.max(...pulses) - Math.min(...pulses) < .3) fail('the light does not pulse: ' + pulses.map(x => x.toFixed(2)).join(' '));
await page.screenshot({ path: 'tests/out/dance.png' });
// with no Spotify sign-in, asking for music shows the Connect Spotify button
await page.evaluate(() => localStorage.removeItem('reverie.spotify'));
await page.fill('#say', 'play music taylor swift'); await page.press('#say', 'Enter');
await page.waitForSelector('#music:not([hidden]) [data-id="connect"]:not([hidden])', { timeout: 30000 }).catch(() => fail('no Connect Spotify button'));
await page.screenshot({ path: 'tests/out/connect.png' });
await page.fill('#say', 'stop dancing'); await page.press('#say', 'Enter');
await page.waitForFunction(() => !window.__reverie.music.groove.on, null, { timeout: 30000 }).catch(() => fail('did not stop'));
if (errors.length) fail('page errors: ' + errors.join(' | '));
await browser.close();
console.log(fails ? `${fails} failed` : 'dance: all passed');
process.exit(fails ? 1 : 0);
