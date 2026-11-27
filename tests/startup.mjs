// Startup check: opens the built page (npm run build, then npm run preview -- --port 4179) or the dev server, and
// times the way to "Tap to say hi": each "Waking up…" step, the bytes fetched before the tap, and the biggest files.
// The network can be slowed to a phone's (--net 4g: 9 Mbps down, 85 ms; --net wifi: 30 Mbps, 20 ms; default none).
//   node tests/startup.mjs [--net 4g|wifi] [--runs 3] [--warm] [--list 15] [url]
// --warm loads the page once first, so the second load shows what the browser's cache (and the page's own) saves.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const net = opt('--net'), runs = +(opt('--runs') || 1), list = +(opt('--list') || 15), warm = argv.includes('--warm');
// (?direct: the 3D canvas shown as a real browser shows it, not copied onto the page each frame, which reads the
// picture back from the software GPU and made every frame slow)
const url = argv.find(a => !a.startsWith('--')) || 'http://localhost:4179/?direct';
const NETS = { '4g': { down: 9e6, up: 3e6, rtt: 85 }, wifi: { down: 30e6, up: 10e6, rtt: 20 } };
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 420, height: 820 } });
await ctx.route('**/api.bigdatacloud.net/**', r => r.fulfill({ json: {} }));
await ctx.route('**/api.open-meteo.com/**', r => r.fulfill({ json: {} }));
async function once(label) {
  const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  if (net) { const n = NETS[net]; await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: n.rtt, downloadThroughput: n.down / 8, uploadThroughput: n.up / 8 }); }
  const files = new Map(); let tapAt = null;
  cdp.on('Network.responseReceived', e => files.set(e.requestId, { url: e.response.url, cached: e.response.fromDiskCache || e.response.fromServiceWorker || e.response.fromPrefetchCache, bytes: 0, t: 0 }));
  cdp.on('Network.loadingFinished', e => { const f = files.get(e.requestId); if (f) { f.bytes = e.encodedDataLength; f.t = e.timestamp; f.before = tapAt == null; } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const t0 = Date.now(), steps = [];
  await page.exposeFunction('__step', s => steps.push([Date.now() - t0, s]));
  await page.addInitScript(() => {
    const go = () => { const st = document.querySelector('#status'), wk = document.querySelector('#wake'); if (!st) return setTimeout(go, 5);
      let last = ''; const look = () => { const s = (wk && !wk.hidden ? 'WAKE ' + wk.textContent : '') || st.textContent; if (s !== last) { last = s; window.__step(s); } };
      new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }); look(); };
    document.addEventListener('DOMContentLoaded', go);
  });
  await page.goto(url);
  await page.waitForSelector('#wake:not([hidden])', { timeout: 300000 });
  const ready = Date.now() - t0; tapAt = ready;
  const lcp = await page.evaluate(() => performance.getEntriesByType('paint').map(p => `${p.name} ${Math.round(p.startTime)}`).join(', '));
  await page.waitForTimeout(500);
  const all = [...files.values()].filter(f => f.before !== false);
  const bytes = all.reduce((a, f) => a + f.bytes, 0);
  console.log(`\n${label}: Tap to say hi at ${ready} ms · ${all.length} files, ${(bytes / 1e6).toFixed(2)} MB over the wire before it · ${lcp}`);
  for (const [t, s] of steps) console.log(`  ${String(t).padStart(6)} ms  ${s}`);
  if (list) { console.log('  biggest files before the tap:'); for (const f of all.sort((a, b) => b.bytes - a.bytes).slice(0, list)) console.log(`  ${(f.bytes / 1e3).toFixed(0).padStart(8)} kB  ${f.url.replace(/^https?:\/\/[^/]+/, '')}`); }
  if (errors.length) console.log('  page errors:', errors.slice(0, 3));
  await page.close();
  return ready;
}
if (warm) await once('first load (cold)');
const times = []; for (let i = 0; i < runs; i++) times.push(await once(warm ? 'second load (warm)' : 'load ' + (i + 1)));
if (runs > 1) console.log('\nmedian:', [...times].sort((a, b) => a - b)[times.length >> 1], 'ms');
await browser.close();
