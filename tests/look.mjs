// Pictures of the room for checking the light: opens the page (dev server with REVERIE_FAKE=1), wakes the creature,
// lets the light settle and saves a picture from the usual seat and from wider seats, at a fixed quality tier.
//   node tests/look.mjs [--gl] [--tier 2] [--out dir] [--wait 20] [url]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const tier = +(opt('--tier') ?? 2), out = opt('--out') || 'tests/out', wait = +(opt('--wait') || 20), gl = argv.includes('--gl'), seats = opt('--seats'), exp = opt('--exp');
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
// (every shader built: until then things not ready yet are left out of the picture)
await page.evaluate(() => window.__reverie.world.view.prepare());   // (the page does this itself; an older page may not)
await page.waitForFunction(() => { const v = window.__reverie.world.view; return v.ready && v.shadersLeft === 0; }, null, { timeout: 300000, polling: 500 });
await page.evaluate(async t => { (await import('/engine/src/kit/hd3d.js')).HD.force = t; document.querySelector('#caption').style.display = 'none'; }, tier);
if (exp) await page.evaluate(exp);
const SEATS = { front: null, wide: [[.2, 1.6, 3.6], [-.2, .6, -.6]], top: [[0, 4.2, 1.2], [0, 0, -.3]], left: [[1.6, 1.2, 2.2], [-.8, .7, -.6]], window: [[1.6, 1.3, 2.6], [-2.1, 1.1, .2]], side: [[2.0, .9, .4], [0, .4, -.2]] };
for (const name of (seats || 'front,wide,top').split(',')) {
  await page.evaluate(seat => {
    const w = window.__reverie.world, v = w.view; w.__draw ||= w.draw;
    w.draw = seat ? c => { v.cam.position.set(...seat[0]); v.cam.lookAt(...seat[1]); w.__draw(c); } : w.__draw;
  }, SEATS[name]);
  await page.waitForTimeout(wait * 1000);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log('saved', join(out, `${name}.png`));
}
await browser.close();
