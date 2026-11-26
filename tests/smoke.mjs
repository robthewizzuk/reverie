// Smoke test: opens the page against the scripted Claude (start the dev server with REVERIE_FAKE=1), wakes the
// creature, asks it to make something, changes it, throws it, and saves screenshots to tests/out/.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/smoke.mjs [url]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5179/?debug';
mkdirSync('tests/out', { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' || /\[reverie\]/.test(m.text())) console.log('  page:', m.text().slice(0, 300)); });
const shot = name => page.screenshot({ path: `tests/out/${name}.png` });
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };

await page.goto(url);
await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 60000 });
await page.waitForTimeout(1500);
await shot('1-awake');
await page.click('#wake');
await page.waitForTimeout(800);

async function ask(text, until, timeout = 60000) {
  await page.fill('#say', text); await page.press('#say', 'Enter');
  await page.waitForFunction(until, null, { timeout }).catch(() => fail(`"${text}" did not finish`));
  await page.waitForTimeout(900);
}
await ask('make a red dragon', () => !!window.__reverie.world.held && !window.__reverie.brain.busy, 120000);
await shot('2-holding');
const h = await page.evaluate(() => window.__reverie.brain.history.map(m => typeof m.content === 'string' ? m.content : m.content.map(b => b.type + (b.type === 'tool_result' ? ':' + b.content : '')).join(',')));
console.log('history:', h);
if (!h.some(x => /tool_result:(Made|Changed)/.test(x))) fail('no tool result for make');
await ask('make it made of gold', () => !!window.__reverie.world.held && !window.__reverie.brain.busy, 120000);
await shot('3-changed');
await ask('throw it', () => !window.__reverie.world.held && !window.__reverie.brain.busy);
await page.waitForTimeout(1500);
await shot('4-thrown');
await ask('why is the sky blue', () => !window.__reverie.brain.busy);
const tiers = await page.evaluate(() => window.__reverie.brain.history.at(-1));
console.log('last:', JSON.stringify(tiers).slice(0, 200));
console.log('timing:', await page.textContent('#timing'));
if (errors.length) fail('page errors: ' + errors.join(' | '));
await browser.close();
console.log(process.exitCode ? 'smoke: failed' : 'smoke: ok');
