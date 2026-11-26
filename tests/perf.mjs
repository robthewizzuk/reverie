// Speed check: opens the page (dev server with REVERIE_FAKE=1), wakes the creature, then for a few seconds
// in each state (idle, holding a prop, after throwing it) records the CPU time of a frame (the stage's update and
// the 3D frame), draw calls, triangles and the quality tier the engine settled on. The GPU here is SwiftShader
// (software), so frame rates say nothing about a real browser; the CPU numbers are what to compare before and after.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/perf.mjs [--gpu] [--secs 6] [--json out.json] [url]
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const secs = +(opt('--secs') || 6), out = opt('--json'), gpu = argv.includes('--gpu'), shots = opt('--shots'), tier = opt('--tier'), exp = opt('--exp'), idleOnly = argv.includes('--idle');
const url = argv.find(a => !a.startsWith('--')) || 'http://localhost:5179/';
const icd = join(dirname(chromium.executablePath()), 'vk_swiftshader_icd.json');
const browser = await chromium.launch(gpu
  ? { args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--use-angle=vulkan', '--enable-features=Vulkan'], env: { ...process.env, VK_ICD_FILENAMES: icd } }
  : { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
await page.route('**/api.bigdatacloud.net/**', r => r.fulfill({ json: {} }));
await page.route('**/api.open-meteo.com/**', r => r.fulfill({ json: {} }));
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__reverie?.body, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 60000 });
await page.click('#wake');
if (tier != null) { await page.waitForTimeout(1500); await page.evaluate(async t => { (await import('/engine/src/kit/hd3d.js')).HD.force = +t; }, tier); }
// time each frame's parts by wrapping the stage's update and draw
await page.evaluate(() => {
  const w = window.__reverie.world, P = window.__perf = { up: [], draw: [], gap: [], last: 0, info: [] };
  const u = w.update, d = w.draw;
  w.update = dt => { const t = performance.now(); u(dt); P.up.push(performance.now() - t); };
  w.draw = c => { const t = performance.now(); d(c); P.draw.push(performance.now() - t); if (P.last) P.gap.push(t - P.last); P.last = t; const I = window.__reverie.gs.hd.HD.info; P.info.push({ calls: I.calls, tris: I.tris, cpu: I.cpu, shCalls: I.shCalls, backend: I.backend }); };
});
const med = a => a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : 0;
const p95 = a => a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * .95))] : 0;
async function measure(name) {
  await page.evaluate(() => { const P = window.__perf; P.up = []; P.draw = []; P.gap = []; P.info = []; P.last = 0; });
  await page.waitForTimeout(secs * 1000);
  const r = await page.evaluate(() => { const P = window.__perf, HD = window.__reverie.gs.hd.HD; return { up: P.up, draw: P.draw, gap: P.gap, info: P.info, tier: HD.tier, name: HD.name, backend: HD.info.backend, res: [HD.info.canvas] }; });
  const last = r.info.at(-1) || {};
  const row = { state: name, frames: r.draw.length, updateMs: +med(r.up).toFixed(2), drawMs: +med(r.draw).toFixed(2), drawP95: +p95(r.draw).toFixed(2), hdCpu: +med(r.info.map(i => i.cpu || 0)).toFixed(2), gapMs: +med(r.gap).toFixed(1), calls: last.calls, tris: last.tris, shadowCalls: last.shCalls, tier: r.tier, backend: r.backend };
  console.log(JSON.stringify(row));
  if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${name}.png`) }); }
  return row;
}
await page.waitForFunction(() => !window.__reverie.brain.speaking, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2000);
const prof = argv.includes('--profile');
let cdp; if (prof) { cdp = await page.context().newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
if (exp) { await page.evaluate(exp); console.log('ran:', exp); await page.waitForTimeout(1000); }
const rows = [await measure('idle')];
if (prof) {
  const { profile } = await cdp.send('Profiler.stop'); const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n]));
  const dt = profile.timeDeltas; const cnt = new Map(); profile.samples.forEach((id, i) => cnt.set(id, (cnt.get(id) || 0) + (dt[i] || 0)));
  for (const [id, us] of cnt) { const n = byId.get(id), f = n.callFrame, k = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + us); }
  const tot = [...self.values()].reduce((a, b) => a + b, 0);
  console.log('self time, top 30 (of ' + (tot / 1000).toFixed(0) + ' ms):'); [...self].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, us]) => console.log('  ' + (us / 1000).toFixed(1).padStart(8) + ' ms  ' + k));
}
if (!idleOnly) {
await page.evaluate(() => window.__reverie.world.make('a red teapot'));
await page.waitForTimeout(1000);
rows.push(await measure('holding'));
await page.evaluate(() => window.__reverie.world.toss());
rows.push(await measure('thrown'));
}
if (errors.length) console.log('page errors:', errors.slice(0, 5));
if (out) writeFileSync(out, JSON.stringify(rows, null, 1));
await browser.close();
