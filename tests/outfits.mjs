// Outfits test: a character voice puts its costume on and the normal voice takes it off; "wear" puts pieces on, with
// a colour, and takes them off; what it wears is told to Claude and kept after a reload; at Christmas it puts on a
// Santa hat by itself, and taking it off keeps it off. Then a close-up picture of every outfit in tests/out/outfits/.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/outfits.mjs [--pictures-only] [--only pirate,wizard] [url]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const only = opt('--only'), picsOnly = argv.includes('--pictures-only'), noPics = argv.includes('--no-pictures');
const url = argv.find(a => !a.startsWith('--')) || 'http://localhost:5179/';
mkdirSync('tests/out/outfits', { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
await page.route('**/api.bigdatacloud.net/**', r => r.fulfill({ json: {} }));
await page.route('**/api.open-meteo.com/**', r => r.fulfill({ json: {} }));
const errors = [];
page.on('pageerror', e => { errors.push(String(e)); console.log('  page error:', String(e).slice(0, 300)); });
page.on('console', m => { if (m.type() === 'error') console.log('  ' + m.text().slice(0, 300)); });
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const R = (fn, arg) => page.evaluate(fn, arg);
const quiet = () => page.waitForFunction(() => !window.__reverie.brain.busy && !window.__reverie.brain.speaking && !window.__reverie.world.walking, null, { timeout: 120000 });
async function say(text) { await page.fill('#say', text); await page.press('#say', 'Enter'); await page.waitForTimeout(400); await quiet(); }
const wearing = () => R(() => window.__reverie.world.outfits.wearing.slice().sort());
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

async function open(fresh) {
  await page.goto(url);
  await page.waitForFunction(() => window.__reverie?.world?.outfits, null, { timeout: 180000 });
  if (fresh) { await R(() => { window.__reverie.world.outfits.reset(); localStorage.removeItem('reverie.looks.v1'); }); await page.reload(); await page.waitForFunction(() => window.__reverie?.world?.outfits, null, { timeout: 180000 }); }
  await page.waitForSelector('#wake:not([hidden])', { timeout: 120000 });
  await page.click('#wake');
  await quiet();
}
await open(true);

if (!picsOnly) {
  // 1. a character voice dresses it, its own voice undresses it
  await say('talk like a pirate');
  let w = await wearing();
  console.log('pirate voice:', w.join(', '));
  if (!same(w, ['tricorn', 'eyepatch'])) fail('the pirate voice did not put on the tricorn and eyepatch');
  const told = await R(() => JSON.stringify(window.__reverie.brain.history.slice(-4)));
  if (!/pirate outfit went on/.test(told)) fail('Claude was not told the pirate outfit went on');
  if (!/You are wearing: tricorn and eyepatch \(your pirate outfit\)/.test(await R(() => window.__reverie.world.scene()))) fail('the scene line does not say what it wears');
  if (await R(() => window.__reverie.world.creature.rig.sprout.visible)) fail('the sprout pokes through the hat');
  await say('use your normal voice');
  w = await wearing();
  if (w.length) fail('its own voice did not take the costume off: ' + w);
  if (!await R(() => window.__reverie.world.creature.rig.sprout.visible)) fail('the sprout did not come back');

  // 2. asked for: a piece, an outfit, a colour, taking off
  await say('wear a party hat');
  if (!same(await wearing(), ['party_hat'])) fail('"wear a party hat" did not');
  await say('dress up as a wizard');
  w = await wearing(); console.log('wizard:', w.join(', '));
  if (!same(w, ['wizard_hat', 'wizard_cape'])) fail('the wizard hat did not replace the party hat, with the cape');
  await say('wear the sunglasses');
  await say('wear a beanie in green');
  const tint = await R(() => { let c = null; window.__reverie.world.creature.rig.body.traverse(o => { if (o.isMesh && o.material?.map && o.material.sheen && !c) c = '#' + o.material.color.getHexString(); }); return c; });
  console.log('green beanie colour:', tint);
  if (tint !== '#008000') fail('the beanie is not green');
  // a pirate voice now swaps the hat and glasses, and going back leaves what it chose itself alone
  await say('talk like a pirate');
  await say('use your normal voice');
  w = await wearing(); console.log('after a pirate and back:', w.join(', '));
  if (!same(w, ['wizard_cape'])) fail('after the pirate costume came off, only the cape (still on) should be left');
  await say('take off the cape');
  if ((await wearing()).length) fail('the cape did not come off');

  // 3. kept after a reload
  await say('wear the crown');
  await open(false);
  if (!same(await wearing(), ['crown'])) fail('the crown was not kept after a reload');
  if (!/crown/.test(await R(() => window.__reverie.world.scene()))) fail('Claude is not told about the crown after a reload');
  await say('take your crown off');

  // 4. the seasons: at Christmas a Santa hat and mittens go on by themselves, and stay off once taken off
  const season = await R(async () => {
    const { makeOutfits } = await import('/src/outfits.js'), THREE = window.__reverie.world.THREE || (await import('/engine/src/gamescroll.js')).default.hd.THREE;
    const rig = () => ({ body: new THREE.Group(), sprout: new THREE.Object3D(), arms: [new THREE.Group(), new THREE.Group()], plush: new THREE.MeshStandardMaterial() });
    const backup = localStorage.getItem('reverie.outfit.v1'); localStorage.removeItem('reverie.outfit.v1');
    const dec = () => new Date(2026, 11, 10), jan = () => new Date(2027, 0, 3), mar = () => new Date(2027, 2, 1), dec27 = () => new Date(2027, 11, 2);
    const out = {};
    out.dec = makeOutfits({ rig: rig(), today: dec }).wearing;
    const o = makeOutfits({ rig: rig(), today: dec }); o.wear({ take_off: ['santa_hat'] });
    out.taken = makeOutfits({ rig: rig(), today: jan }).wearing;   // (still the same Christmas)
    out.march = makeOutfits({ rig: rig(), today: mar }).wearing;
    out.next = makeOutfits({ rig: rig(), today: dec27 }).wearing;  // (a new Christmas)
    const p = makeOutfits({ rig: rig(), today: dec27 }); p.forVoice('captain_silas_blackwater'); out.pirate = p.wearing; p.forVoice(''); out.back = p.wearing;
    out.march2 = makeOutfits({ rig: rig(), today: mar }).wearing;
    if (backup) localStorage.setItem('reverie.outfit.v1', backup); else localStorage.removeItem('reverie.outfit.v1');
    return out;
  });
  console.log('seasons:', JSON.stringify(season));
  if (!same(season.dec, ['santa_hat', 'mittens'])) fail('no Santa hat and mittens in December');
  if (!same(season.taken, ['mittens'])) fail('the Santa hat came back after it was taken off');
  if (season.march.length) fail('Christmas clothes still on in March');
  if (!same(season.next, ['santa_hat', 'mittens'])) fail('the Santa hat did not come back next Christmas');
  if (!same(season.pirate, ['tricorn', 'eyepatch', 'mittens'])) fail('a pirate at Christmas should keep its mittens: ' + season.pirate);
  if (!same(season.back, ['santa_hat', 'mittens'])) fail('the Santa hat did not go back on after the pirate voice');
  if (season.march2.length) fail('the Christmas clothes were not put away after Christmas');
}

// 5. a picture of each outfit, close up, from the front and from behind a shoulder
if (!noPics) {
  const { OUTFITS } = await import('../src/outfit-names.js');
  const names = only ? only.split(',') : Object.keys(OUTFITS);
  await R(() => { document.querySelector('#caption').style.display = 'none'; const w = window.__reverie.world; w.__draw ||= w.draw; });
  // (behind: it turns its back, as it would walking away, and the camera stays in front)
  const seats = { front: [[0, .62, 1.08], [0, .44, 0], null], back: [[.15, .66, 1.08], [0, .42, 0], Math.PI * .82] };
  for (const n of names) {
    await R(n => { const o = window.__reverie.world.outfits; o.reset(); o.wear({ put_on: [n] }); window.__reverie.world.view.precompile?.(); }, n);
    await page.waitForFunction(() => window.__reverie.world.view.shadersLeft === 0, null, { timeout: 120000, polling: 500 });
    for (const [seat, [pos, look, turn]] of Object.entries(seats)) {
      await R(([pos, look, turn]) => { const w = window.__reverie.world, v = w.view; w.creature.walk(0, turn); w.draw = c => { v.cam.position.set(...pos); v.cam.lookAt(...look); w.__draw(c); }; }, [pos, look, turn]);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `tests/out/outfits/${n}-${seat}.png`, clip: { x: 10, y: 150, width: 400, height: 500 } });
    }
    console.log('pictured', n);
  }
  await R(() => { const w = window.__reverie.world; w.draw = w.__draw; w.creature.walk(0, null); w.outfits.reset(); });
}

if (errors.length) fail('page errors: ' + errors.join(' | ').slice(0, 500));
await browser.close();
console.log(process.exitCode ? 'outfits: FAILED' : 'outfits: all good');
