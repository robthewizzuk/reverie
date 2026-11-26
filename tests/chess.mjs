// Chess test: against the scripted Claude (REVERIE_FAKE=1), asks to play chess, plays moves by tapping the board
// and by saying them, checks Claude's replies come back on the board and that it hears the news, then puts it away.
// Pictures in tests/out/chess-*.png.
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/chess.mjs [url]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5179/?debug';
mkdirSync('tests/out', { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') console.log('  page:', m.text().slice(0, 300)); });
const shot = name => page.screenshot({ path: `tests/out/chess-${name}.png` });
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const idle = () => page.waitForFunction(() => { const r = window.__reverie; return r.world.game?.state === 'you' && !r.brain.busy && !r.brain.speaking; }, null, { timeout: 60000 }).catch(() => fail('did not come back to your move'));

await page.goto(url);
await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
await page.waitForSelector('#wake:not([hidden])', { timeout: 60000 });
await page.click('#wake');
await page.waitForTimeout(500);

await page.fill('#say', "let's play chess"); await page.press('#say', 'Enter');
await page.waitForFunction(() => window.__reverie.world.game?.state === 'you', null, { timeout: 60000 }).catch(() => fail('no board'));
// (the camera eases to its seat at the table; on a slow test machine that takes a while)
await page.waitForFunction(() => { const { world } = window.__reverie, c = world.view.cam.position, g = world.game.camera.pos; return Math.hypot(c.x - g[0], c.y - g[1], c.z - g[2]) < .005; }, null, { timeout: 60000 });
await page.waitForTimeout(500);
await shot('1-board');

// a tap on e2, then on e4, at the squares' places on screen
async function tapSquare(sq) {
  const p = await page.evaluate(sq => {
    const { world, gs } = window.__reverie, THREE = gs.hd.THREE, v = world.view, cv = document.querySelector('#view');
    const x = (sq.charCodeAt(0) - 97 - 3.5) * .06, z = .66 + (3.5 - (+sq[1] - 1)) * .06;
    const q = new THREE.Vector3(x, .3, z).project(v.cam), r = cv.getBoundingClientRect();
    return { x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height };
  }, sq);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(250);
}
await tapSquare('e2');
await shot('2-picked');
await tapSquare('e4');
await page.waitForFunction(() => window.__reverie.world.game?.context().includes('Moves so far: e4 '), null, { timeout: 30000 }).catch(() => fail('tapping did not play e4'));
await page.waitForTimeout(500);
await shot('3-claude-moving');
await idle();
await page.waitForTimeout(1200);
await shot('4-after-reply');

// a move said out loud
await page.fill('#say', 'move Nf3'); await page.press('#say', 'Enter');
await page.waitForFunction(() => /Moves so far: e4 \S+ Nf3 \S+/.test(window.__reverie.world.game?.context()), null, { timeout: 60000 }).catch(() => fail('saying Nf3 did not play it'));
await idle();

const h = await page.evaluate(() => window.__reverie.brain.history.map(m => typeof m.content === 'string' ? m.content : m.content.map(b => b.type + (b.type === 'tool_result' ? ':' + b.content : b.type === 'text' ? ':' + b.text : '')).join(',')));
console.log('history:\n  ' + h.map(x => x.slice(0, 160)).join('\n  '));
if (!h.some(x => /^\[chess\]/.test(x))) fail('Claude never heard news from the board');
if (!h.some(x => /tool_result:Played Nf3/.test(x))) fail('no game_move result');
console.log('context:', await page.evaluate(() => window.__reverie.world.game.context().slice(0, 300)));

await page.click('#gamebar button[data-id="leave"]');
await page.waitForTimeout(1500);
if (await page.evaluate(() => !!window.__reverie.world.game)) fail('Done did not put the board away');
await shot('5-away');
if (errors.length) fail('page errors: ' + errors.join(' | '));
await browser.close();
console.log(process.exitCode ? 'chess: failed' : 'chess: ok');
