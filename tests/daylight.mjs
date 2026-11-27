// Pictures of the room through the day and in each weather (daylight.js): opens the page (dev server with
// REVERIE_FAKE=1), and for each sky asks the window for it, waits for the light to settle and every shader to be
// built, and saves a picture from the usual seat (and from the side window's seat with --window).
//   node tests/daylight.mjs [--gl] [--tier 2] [--out dir] [--skies noon,sunset,night,rain-night] [--window] [url]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const tier = +(opt('--tier') ?? 2), out = opt('--out') || 'tests/out/daylight', gl = argv.includes('--gl'), side = argv.includes('--window');
const skies = (opt('--skies') || 'noon,golden hour,sunset,evening,night,cloudy-afternoon,rain-afternoon,rain-night,snow-morning,storm-evening').split(',');
const url = argv.find(a => !a.startsWith('--')) || 'http://localhost:5179/';
mkdirSync(out, { recursive: true });
const icd = join(dirname(chromium.executablePath()), 'vk_swiftshader_icd.json');
const browser = await chromium.launch(gl ? { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] }
  : { args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--use-angle=vulkan', '--enable-features=Vulkan'], env: { ...process.env, VK_ICD_FILENAMES: icd } });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
await page.route('**/api.bigdatacloud.net/**', r => r.fulfill({ json: {} }));
await page.route('**/api.open-meteo.com/**', r => r.fulfill({ json: {} }));
page.on('pageerror', e => console.log('page error:', String(e).slice(0, 300)));
await page.goto(url);
await page.waitForFunction(() => window.__reverie?.body, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 120000 });
const settled = () => page.waitForFunction(() => { const v = window.__reverie.world.view; return v.ready && v.shadersLeft === 0; }, null, { timeout: 300000, polling: 500 });
await page.evaluate(() => window.__reverie.world.view.prepare());
await settled();
await page.evaluate(async t => { (await import('/engine/src/kit/hd3d.js')).HD.force = t; document.querySelector('#caption').style.display = 'none'; document.querySelector('#wake').style.display = 'none'; }, tier);
if (side) await page.evaluate(() => { const w = window.__reverie.world, v = w.view; w.__draw ||= w.draw; w.draw = c => { v.cam.position.set(1.6, 1.3, 2.6); v.cam.lookAt(-2.1, 1.1, .2); w.__draw(c); }; });
for (const sky of skies) {
  const [a, b] = sky.split('-'), weather = ['clear', 'cloudy', 'overcast', 'fog', 'drizzle', 'rain', 'storm', 'snow'].includes(a) ? a : b || 'clear', time = weather === a ? b || 'noon' : a;
  console.log(await page.evaluate(async ([time, weather]) => { const d = window.__reverie.world.daylight, r = await d.set({ time, weather }); d.settle(); return r; }, [time, weather]));
  // (straight there, with the bounce light baked again; then any new shader is built)
  await page.waitForTimeout(6000); await settled(); await page.waitForTimeout(3000);
  const name = sky.replace(/\s+/g, '_');
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log('saved', join(out, `${name}.png`), await page.evaluate(() => JSON.stringify(window.__reverie.world.daylight.state)));
}
await browser.close();
