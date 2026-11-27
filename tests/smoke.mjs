// Smoke test: opens the page against the scripted Claude (start the dev server with REVERIE_FAKE=1), wakes the
// creature, asks it to make something, changes it, throws it, and saves screenshots to tests/out/.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/smoke.mjs [url]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5179/?debug';
mkdirSync('tests/out', { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1, permissions: ['geolocation'], geolocation: { latitude: 53.8, longitude: -1.55 } });
// the place name and the weather, answered here (the test machine may not reach them)
await page.route('**/api.bigdatacloud.net/**', r => r.fulfill({ json: { city: 'Leeds', principalSubdivision: 'England', countryName: 'United Kingdom', countryCode: 'GB' } }));
await page.route('**/api.open-meteo.com/**', r => r.fulfill({ json: { current: { temperature_2m: 6.4, apparent_temperature: 3.1, weather_code: 61, wind_speed_10m: 19.6, is_day: 0 },
  daily: { time: ['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'], weather_code: [61, 3, 0, 71], temperature_2m_max: [8, 7, 6, 2], temperature_2m_min: [4, 3, 1, -1], precipitation_probability_max: [80, 20, 0, 60], sunrise: ['2026-11-26T07:52'], sunset: ['2026-11-26T15:47'] } } }));
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
await ask("what's the weather like", () => !window.__reverie.brain.busy);
const wx = await page.evaluate(() => JSON.stringify(window.__reverie.brain.history.slice(-4)));
if (!/Weather in Leeds/.test(wx)) fail('no weather for Leeds: ' + wx.slice(0, 300));
if (!/From the device[^\]]*Leeds/.test(wx)) fail('the place did not reach Claude');
// the room follows the weather there (raining in Leeds: the mock), and Claude hears it; asking for a sky shows it
await page.waitForFunction(() => window.__reverie.world.daylight.state.rain > .1, null, { timeout: 60000 }).catch(() => fail('the rain in Leeds did not reach the window'));
await ask('show me a sunset with snow', () => !window.__reverie.brain.busy);
const sky = await page.evaluate(() => window.__reverie.world.daylight.state);
if (sky.asked.time !== 'sunset' || sky.asked.weather !== 'snow') fail('the window did not change: ' + JSON.stringify(sky));
await page.waitForTimeout(2500); await shot('4b-sunset-snow');
await ask('back to the real sky', () => !window.__reverie.brain.busy);
if ((await page.evaluate(() => window.__reverie.world.daylight.state.asked.time)) !== 'live') fail('the real sky did not come back');
await ask('why is the sky blue', () => !window.__reverie.brain.busy);
const tiers = await page.evaluate(() => window.__reverie.brain.history.at(-1));
console.log('last:', JSON.stringify(tiers).slice(0, 200));
// asking for a new voice and new colours: both kept on the device, and back after a reload
await ask('talk like a pirate', () => !window.__reverie.brain.busy);
await ask('go purple', () => !window.__reverie.brain.busy);
await page.waitForTimeout(800);
await shot('5-recoloured');
const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('reverie.looks.v1') || 'null'));
console.log('kept:', JSON.stringify(kept));
if (kept?.voice?.name !== 'captain_silas_blackwater') fail('the pirate voice was not kept');
if (kept?.colours?.body !== '#c8b4ee' || kept?.colours?.glow !== '#30a0ff') fail('the colours were not kept');
console.log('timing:', await page.textContent('#timing'));
await page.reload();
await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
const glow = await page.evaluate(() => { const c = window.__reverie.world.creature.core.material.emissive; return { r: c.r, b: c.b }; });
if (!(glow.b > glow.r)) fail('the blue glow did not come back after a reload: ' + JSON.stringify(glow));
if (errors.length) fail('page errors: ' + errors.join(' | '));
await browser.close();
console.log(process.exitCode ? 'smoke: failed' : 'smoke: ok');
