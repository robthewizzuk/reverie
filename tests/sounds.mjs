// Sounds test: sound cues in its words ("[drumroll]") play in their place, between the sentences around them, and are
// never said or shown; the voice tool takes the new effects, pitch, speed and a room's echo, says them in its options
// and keeps them after a reload; every voice effect shapes a line cleanly (no silence, no blow-up, the words' timing
// kept), and the room's echo reaches the engine's mixer.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/sounds.mjs [url]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const url = process.argv[2] || 'http://localhost:5179/';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
await page.route('**/api.bigdatacloud.net/**', r => r.fulfill({ json: {} }));
await page.route('**/api.open-meteo.com/**', r => r.fulfill({ json: {} }));
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') console.log('  ' + m.text().slice(0, 300)); });
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const R = (fn, arg) => page.evaluate(fn, arg);
const quiet = () => page.waitForFunction(() => !window.__reverie.brain.busy && !window.__reverie.brain.speaking, null, { timeout: 90000 });
async function say(text) { await page.fill('#say', text); await page.press('#say', 'Enter'); await page.waitForTimeout(400); await quiet(); }
async function open() {
  await page.goto(url);
  await page.waitForFunction(() => window.__reverie?.brain, null, { timeout: 180000 });
  await page.waitForSelector('#wake:not([hidden])', { timeout: 90000 });
  await page.click('#wake');
  await quiet();
}

await open();

// ---- the cue parser, on its own
const split = await R(async () => {
  const { splitCues, cueOf } = await import('/src/cues.js');
  const { cueNames } = await import('/src/sounds.js');
  const { CUES } = await import('/src/cues.js');
  return { a: splitCues('And the winner is [drumroll] you! [Ta-da]'), b: splitCues('[laugh] Oh [ba dum tss]'), c: splitCues('no [cues] here'),
    d: [cueOf('Drum roll'), cueOf('sfx: boing'), cueOf('hmm')], missing: Object.keys(CUES).filter(k => !cueNames().includes(k)) };
});
console.log('split:', JSON.stringify(split));
if (JSON.stringify(split.a) !== JSON.stringify(['And the winner is', { cue: 'drumroll' }, 'you!', { cue: 'tada' }])) fail('drumroll line split wrong');
if (JSON.stringify(split.b) !== JSON.stringify(['[laugh] Oh', { cue: 'rimshot' }])) fail('[laugh] should stay for the voice, ba dum tss is a rimshot');
if (JSON.stringify(split.c) !== JSON.stringify(['no [cues] here'])) fail('an unknown bracket is not a cue');
if (JSON.stringify(split.d) !== JSON.stringify(['drumroll', 'boing', null])) fail('cue names: ' + split.d);
if (split.missing.length) fail('cues with no sound: ' + split.missing);

// ---- every voice effect shapes a line: a made-up voiced sound (a buzz with syllables), through each recipe
const shaped = await R(async () => {
  const { fxOf, shape, mouthTrack } = await import('/engine/src/kit/voice-fx.js');
  const { EFFECTS, fxFor } = await import('/src/voices.js');
  const rate = 24000, n = rate * 1.6, x = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / rate, syl = Math.max(0, Math.sin(Math.PI * t * 5)); x[i] = .3 * syl * (Math.sin(2 * Math.PI * 140 * t) + .5 * Math.sin(2 * Math.PI * 280 * t) + .25 * Math.sin(2 * Math.PI * 560 * t)); }
  const out = {};
  for (const e of EFFECTS) {
    const fx = fxOf(fxFor(e));
    try {
      const m = await shape(x, rate, { size: .92, fx, outRate: 48000 });
      const d = m.buffer.getChannelData(0); let peak = 0, sum = 0, bad = 0;
      for (const v of d) { if (!Number.isFinite(v)) bad++; else { peak = Math.max(peak, Math.abs(v)); sum += v * v; } }
      out[e] = { seconds: +m.seconds.toFixed(3), total: +m.total.toFixed(3), lead: +m.lead.toFixed(3), peak: +(peak * m.gain).toFixed(3), rms: +(Math.sqrt(sum / d.length) * m.gain).toFixed(4), bad };
    } catch (err) { out[e] = { error: String(err) }; }
  }
  return { out, mouth: mouthTrack(x, rate).open.length };
});
const base = shaped.out.none;
for (const [e, r] of Object.entries(shaped.out)) {
  if (r.error) { fail(`${e}: ${r.error}`); continue; }
  if (r.bad) fail(`${e}: ${r.bad} samples not numbers`);
  if (r.rms < .005) fail(`${e}: silent (rms ${r.rms})`);
  if (r.peak > 1.5) fail(`${e}: too loud (peak ${r.peak})`);
  // the words end at the same time through every effect (only a radio's squelch adds a lead), so the mouth keeps time
  if (Math.abs(r.seconds - r.lead - (base.seconds - base.lead)) > .02) fail(`${e}: its words take ${r.seconds - r.lead}s, not ${base.seconds - base.lead}s`);
}
console.log('effects:', Object.entries(shaped.out).map(([e, r]) => `${e} rms ${r.rms} peak ${r.peak} ${r.total}s`).join('; '));

await R(() => localStorage.removeItem('reverie.looks.v1'));

// ---- a joke with cues: each plays between the words around it, and none of it is said or shown
await R(async () => {
  const { played } = await import('/src/sounds.js');
  window.__order = []; played.length = 0;
  const cap = document.querySelector('#caption'); let seen = played.length;
  new MutationObserver(() => window.__order.push('say:' + cap.textContent)).observe(cap, { childList: true, characterData: true, subtree: true });
  (function tick() { while (seen < played.length) window.__order.push('cue:' + played[seen++]); requestAnimationFrame(tick); })();
});
await say('tell me a joke');
await page.waitForTimeout(800);
const order = (await R(() => window.__order)).filter((x, i, a) => x !== a[i - 1]);
console.log('order:', order);
const want = ['say:Why did the cookie go to the doctor?', 'say:It felt crumby.', 'cue:rimshot', 'say:And the winner of worst joke is', 'cue:drumroll', 'say:me!', 'cue:tada'];
if (JSON.stringify(order.slice(-want.length)) !== JSON.stringify(want)) fail('cues out of order: ' + JSON.stringify(order));
if (order.some(x => /\[|rimshot|drumroll/i.test(x) && x.startsWith('say:'))) fail('a cue was shown or said');

// ---- the voice: an effect and an echo, then pitch and speed, kept after a reload
await say('talk like a ghost in a cave');
let o = await R(async () => { const l = await import('/src/looks.js'); return { say: l.sayOptions(), echo: l.echoNow() }; });
console.log('ghost:', JSON.stringify(o));
if (!o.say.fx?.echo || o.echo?.delay !== .33) fail('ghost in a cave did not set the effect and echo');
await say('give me a helium voice');
o = await R(async () => { const l = await import('/src/looks.js'); return l.sayOptions(); });
console.log('helium:', JSON.stringify(o));
if (o.pitch !== 1.5 || o.rate !== 1.1 || o.fx?.like !== 'radio') fail('helium did not set pitch, speed and the walkie-talkie');
const told = await R(() => window.__reverie.brain.history.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_result').map(b => b.content).at(-1));
console.log('told:', told);
if (!/pitch 1\.50, speed 1\.10, with the echo of a cave/.test(told)) fail('Claude was not told the voice: ' + told);
await page.reload(); await page.waitForFunction(() => window.__reverie?.brain, null, { timeout: 180000 });
o = await R(async () => { const l = await import('/src/looks.js'); return { say: l.sayOptions(), echo: l.echoNow() }; });
if (o.say.pitch !== 1.5 || o.echo?.tail !== 3) fail('the voice was not kept: ' + JSON.stringify(o));
await page.waitForSelector('#wake:not([hidden])', { timeout: 90000 }); await page.click('#wake'); await quiet();
await say('back to your normal voice');
o = await R(async () => { const l = await import('/src/looks.js'); return { say: l.sayOptions(), echo: l.echoNow() }; });
if (o.say.pitch || o.say.rate || o.say.fx || o.echo) fail('normal voice did not clear it all: ' + JSON.stringify(o));

if (errors.length) fail('page errors: ' + errors.join(' | '));
await browser.close();
console.log(process.exitCode ? 'sounds: FAILED' : 'sounds: ok');
