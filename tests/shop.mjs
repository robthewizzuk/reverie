// Shopping on the page, against the scripted Claude and shopping helper (start the dev server with REVERIE_FAKE=1):
// asks it to find something, waits for the cards and the [shop] news, asks to buy number 2, checks the confirm strip,
// taps through to the shop's page (a new tab), and brings the cards back after a reload. Pictures in tests/out/.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/shop.mjs [url]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5179/?debug';
mkdirSync('tests/out', { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 2 });
// the made-up shops answer here
await ctx.route('https://shop-*.example/**', r => r.fulfill({ contentType: 'text/html', body: '<h1>A shop</h1>' }));
await ctx.route('**/api.open-meteo.com/**', r => r.fulfill({ json: {} }));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' || /\[reverie\] shop/.test(m.text())) console.log('  page:', m.text().slice(0, 200)); });
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const shot = name => page.screenshot({ path: `tests/out/${name}.png` });
const history = () => page.evaluate(() => window.__reverie.brain.history.map(m => typeof m.content === 'string' ? m.content : m.content.map(b => b.type === 'tool_result' ? 'result:' + b.content : b.type === 'text' ? b.text : b.type === 'tool_use' ? 'tool:' + b.name + JSON.stringify(b.input) : b.type).join(' | ')));

async function wakeUp() {
  await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
  await page.waitForSelector('#wake:not([hidden])', { timeout: 60000 });
  await page.click('#wake'); await page.waitForTimeout(800);
}
async function ask(text, until, timeout = 60000) {
  await page.fill('#say', text); await page.press('#say', 'Enter');
  await page.waitForFunction(until, null, { timeout }).catch(() => fail(`"${text}" did not finish`));
  await page.waitForTimeout(600);
}

await page.goto(url);
await wakeUp();
await ask('find me wireless headphones under £100', () => document.querySelectorAll('#shop .card').length === 3 && !window.__reverie.brain.busy);
await page.waitForFunction(() => window.__reverie.brain.history.some(m => typeof m.content === 'string' && /\[shop\] Your shopping helper is back/.test(m.content)), null, { timeout: 30000 }).catch(() => fail('the [shop] news never reached Reverie'));
await page.waitForFunction(() => !window.__reverie.brain.busy, null, { timeout: 30000 });
await page.waitForTimeout(1500);
let h = await history();
if (!h.some(x => /tool:shop\{"action":"find","query":"wireless headphones","budget":100\}/.test(x))) fail('no shop find call with the budget');
const news = h.find(x => /^\[shop\]|\n\[shop\]/.test(x) || /\[shop\] Your shopping helper is back/.test(x)) || '';
if (!/1\. wireless headphones \(black\): £44\.99 \(was £59\.99\) at Shop One/.test(news) || !/Cheapest: number 1\. Helper's pick: number 2\./.test(news)) fail('the news does not list the offers: ' + news.slice(0, 300));
const tags = await page.$$eval('#shop .card', cs => cs.map(c => c.querySelector('.tag')?.textContent || ''));
if (tags[0] !== 'Cheapest' || tags[1] !== "Reverie's pick") fail('tags: ' + tags);
const held = await page.evaluate(() => window.__reverie.world.held?.short || '');
console.log('holding:', held || '(nothing)');
await shot('shop-1-cards');

await ask('buy number 2', () => !document.querySelector('#shop .confirm').hidden && !window.__reverie.brain.busy);
const strip = await page.textContent('#shop .confirm p');
if (!/Shop Two/.test(strip) || !/£47\.50/.test(strip) || !/never sees your card/.test(strip)) fail('confirm strip: ' + strip);
if (!(await page.$('#shop .card.picked[data-n="2"]'))) fail('card 2 is not highlighted');
await shot('shop-2-confirm');
h = await history();
if (!h.some(x => /result:A confirm button for number 2/.test(x))) fail('buy did not answer with a confirm button');

const tabs = []; page.on('popup', p => tabs.push(p));
await page.click('#shop .confirm a');
for (let i = 0; i < 50 && !tabs.length; i++) await page.waitForTimeout(200);
const tab = tabs[0];
if (!tab) fail('no tab opened for the shop');
else { await tab.waitForLoadState().catch(() => {}); if (tab.url() !== 'https://shop-two.example/item/9') fail('opened ' + tab.url()); else console.log('opened', tab.url()); if (await tab.evaluate(() => window.opener !== null)) fail('the shop page can reach back (opener)'); await tab.close(); }
await page.waitForTimeout(300);
if (!(await page.$eval('#shop .confirm', e => e.hidden))) fail('the confirm strip stayed up');

// it's kept: after a reload, "show my shopping" brings the same cards back
await page.reload(); await wakeUp();
await ask('show my shopping', () => document.querySelectorAll('#shop .card').length === 3 && !window.__reverie.brain.busy);
if (errors.length) fail('page errors: ' + errors.join(' / '));
await browser.close();
console.log(process.exitCode ? 'shop test failed' : 'shop test passed');
