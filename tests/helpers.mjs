// Reverie's helpers on the page, against the scripted Claude and the stand-in helpers (REVERIE_FAKE=1): it sends one
// off, the pill and the wisp show it working, the page is reloaded while it works, and after the reload the helper
// reports back and Reverie says so. Screenshots go to tests/out/.
//   REVERIE_FAKE=1 REVERIE_FAKE_HELPER_MS=9000 npm run dev -- --port 5179   then   node tests/helpers.mjs [url]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5179/?debug';
mkdirSync('tests/out', { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
await page.route('**/api.open-meteo.com/**', r => r.fulfill({ json: {} }));
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' || /\[reverie\]/.test(m.text())) console.log('  page:', m.text().slice(0, 240)); });
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const shot = name => page.screenshot({ path: `tests/out/${name}.png` });

async function open() {
  await page.goto(url);
  await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
  await page.waitForSelector('#wake:not([hidden])', { timeout: 90000 });
  await page.click('#wake');
  await page.waitForTimeout(600);
}
await open();
await page.evaluate(() => localStorage.removeItem('reverie.helpers.v1'));

await page.fill('#say', 'look into the cheapest train to York on Saturday'); await page.press('#say', 'Enter');
await page.waitForFunction(() => window.__reverie.helpers.working.length === 1 && !window.__reverie.brain.busy, null, { timeout: 60000 }).catch(() => fail('no helper went out'));
await page.waitForSelector('#helpers li.working', { timeout: 10000 }).catch(() => fail('no pill for the helper'));
await page.waitForTimeout(3500);   // (it is asked after: the pill says what it is doing)
console.log('pill:', await page.textContent('#helpers'));
await shot('helper-1-working');
const told = await page.evaluate(() => window.__reverie.brain.history.map(m => typeof m.content === 'string' ? m.content : m.content.map(b => b.type === 'tool_result' ? b.content : b.text || b.type).join(' ')).join('\n'));
if (!/Sent Pip off/.test(told)) fail('the tool result did not say it went: ' + told.slice(-400));
if (!/Your helpers: Pip is/.test(await page.evaluate(() => window.__reverie.world.scene()))) fail('the scene line does not say what Pip is doing');

// a second and a third go out; a fourth is refused
for (const t of ['look into ferry times to Hull', 'look into the weather in York']) { await page.fill('#say', t); await page.press('#say', 'Enter'); await page.waitForFunction(() => !window.__reverie.brain.busy, null, { timeout: 60000 }); await page.waitForTimeout(400); }
await page.fill('#say', 'look into bus times too'); await page.press('#say', 'Enter');
await page.waitForFunction(() => !window.__reverie.brain.busy, null, { timeout: 60000 });
const refused = await page.evaluate(() => JSON.stringify(window.__reverie.brain.history.at(-2)));
if (!/3 at once is the most/.test(refused)) fail('a fourth helper was not refused: ' + refused.slice(0, 300));
if ((await page.locator('#helpers li').count()) !== 3) fail('expected three pills');
await shot('helper-2-three');

// reload while they work: they are picked up again and report back afterwards
await page.reload();
await page.waitForFunction(() => window.__reverie?.helpers, null, { timeout: 180000 });
const after = await page.evaluate(() => window.__reverie.helpers.list.map(h => h.name + ':' + h.status));
console.log('after reload:', after);
if (after.length !== 3) fail('the helpers were not kept over a reload');
await page.waitForSelector('#wake:not([hidden])', { timeout: 90000 }); await page.click('#wake');
await page.waitForFunction(() => window.__reverie.brain.history.some(m => typeof m.content === 'string' && /\[helper\] Pip/.test(m.content)), null, { timeout: 60000 }).catch(() => fail('Pip never reported back'));
await page.waitForFunction(() => window.__reverie.helpers.list.every(h => h.told), null, { timeout: 60000 }).catch(() => fail('not every helper was told'));
await page.waitForFunction(() => !window.__reverie.brain.busy && !window.__reverie.brain.speaking, null, { timeout: 60000 });
const said = await page.evaluate(() => window.__reverie.brain.history.filter(m => m.role === 'assistant').map(m => m.content.map(b => b.text || '').join('')).join(' | '));
if (!/My helper is back/.test(said)) fail('Reverie did not say a helper was back: ' + said.slice(-300));
await shot('helper-3-reported');
// it can read the whole report afterwards
const read = await page.evaluate(() => window.__reverie.helpers.manage({ action: 'read', name: 'pip' }));
if (!/full report/.test(read)) fail('could not read the report: ' + read);
if (errors.length) fail('page errors: ' + errors.join(' | '));
await browser.close();
console.log(process.exitCode ? 'helpers: failed' : 'helpers: ok');
