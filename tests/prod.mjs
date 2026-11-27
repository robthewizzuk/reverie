// The built page (what Cloudflare serves), not the dev server: it wakes, hears words through the mic path, answers a
// typed ask, and fails on any page error or "Something went wrong". The listening path is driven by hand, because a
// browser run by tests has no speech service (listen.js), and that is how "Cannot access 'r' before initialization"
// (brain.js yours(): a local named like the words() it called) reached the live site with every other test green.
//   npm run test:prod                  builds, serves dist/ with `vite preview` and the scripted Claude, and runs this
//   node tests/prod.mjs [url]          against a built page already being served (REVERIE_FAKE=1 npm run preview)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright');

let url = process.argv[2], server = null;
if (!url) {
  const port = 4179 + Math.floor(Math.random() * 500);
  server = spawn(process.execPath, ['engine/node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort'],
    { env: { ...process.env, REVERIE_FAKE: '1' }, stdio: 'ignore' });
  url = `http://localhost:${port}/`;
  for (let i = 0; i < 60; i++) { if (await fetch(url).then(r => r.ok, () => false)) break; await new Promise(r => setTimeout(r, 500)); }
}
process.on('exit', () => server?.kill());
const yours = text => page.evaluate(t => window.__reverie.brain.yours(t), text).catch(e => ({ error: e.message }));
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
await page.route('**/api.bigdatacloud.net/**', r => r.fulfill({ json: { city: 'Leeds', countryName: 'United Kingdom', countryCode: 'GB' } }));
await page.route('**/api.open-meteo.com/**', r => r.abort());
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const status = () => page.evaluate(() => document.querySelector('#status')?.textContent || '');
const check = async when => {
  const s = await status();
  if (/went wrong/.test(s)) fail(`${when}: ${s}`);
  if (errors.length) fail(`${when}: ${errors.splice(0).join(' | ')}`);
};

await page.goto(url);
if (!(await page.evaluate(() => [...document.scripts].some(s => /\/assets\/index-[\w-]+\.js$/.test(s.src))))) fail('this is not the built page (start `npm run preview`, not `npm run dev`)');
await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 60000 });
await check('loading');
await page.click('#wake');
await page.waitForTimeout(1500);
await check('waking');

// what the mic hears, told apart from its own voice: quiet, then while it has words queued
const parts = await yours('purple elephants juggle oranges');
if (parts?.words?.length !== 4 || parts.yours.length !== 4) fail('brain.yours: ' + JSON.stringify(parts));
// the frame loop's listening path, with words being heard (as a real recogniser gives them)
await page.evaluate(() => { const v = window.__reverie.voice; v.want = true; v.text = 'hello there little friend'; });
await page.waitForTimeout(1500);
await check('hearing words');
await page.evaluate(() => { const v = window.__reverie.voice; v.want = false; v.text = ''; });

// a typed ask, answered by the scripted Claude, and the mic path again while it talks
await page.fill('#say', 'make a red dragon'); await page.press('#say', 'Enter');
await page.waitForFunction(() => window.__reverie.brain.speaking || window.__reverie.world.held, null, { timeout: 120000 }).catch(() => fail('no answer to a typed ask'));
const talking = await yours('a red dragon for you');
if (!talking?.words?.length) fail('brain.yours while talking: ' + JSON.stringify(talking));
await page.waitForFunction(() => !window.__reverie.brain.busy, null, { timeout: 120000 }).catch(() => fail('the turn did not finish'));
await check('a typed turn');

await browser.close();
server?.kill();
console.log(process.exitCode ? 'prod: FAILED' : 'prod: ok');
