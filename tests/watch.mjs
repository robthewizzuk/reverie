// Watching a video together. On its own (no browser): reading YouTube links, the captions YouTube sends in its three
// shapes, picking a caption track, the backend's answer from a pretend YouTube, and fitting the player onto the screen.
// Then, with a browser (start the dev server with REVERIE_FAKE=1), a whole watch: a pasted link puts the screen up and
// Reverie sits down, the player is fitted onto the screen, what was said reaches Claude with what they say, it chips in
// at a quiet moment with its voice ducking the video, find and seek, the video's sound isn't taken for them, and Done.
//   node tests/watch.mjs                 the parts alone
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/watch.mjs --page [url]
import { videoOf, clock, fitQuad } from '../src/videos.js';
import { parseCaptions, pickTrack, videoInfo, handleVideo } from '../server/video.js';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (cond, msg) => { if (!cond) fail(msg); };

// ---- links
{
  const v = videoOf('look at this https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s ha');
  ok(v?.id === 'dQw4w9WgXcQ' && v.start === 90, 'a watch link with a time: ' + JSON.stringify(v));
  ok(videoOf('https://youtu.be/dQw4w9WgXcQ?si=abc&t=42')?.start === 42, 'a short link with a time');
  ok(videoOf('https://m.youtube.com/shorts/abcdefghijk')?.id === 'abcdefghijk', 'a short');
  ok(videoOf('https://www.youtube.com/watch?feature=share&v=abcdefghijk')?.id === 'abcdefghijk', 'v not first');
  ok(!videoOf('let us watch something about volcanoes'), 'words are not a link');
  ok(!videoOf('dQw4w9WgXcQ') && videoOf('dQw4w9WgXcQ', true)?.id === 'dQw4w9WgXcQ', 'a bare id only when asked');
  ok(clock(65) === '1:05' && clock(3725) === '1:02:05', 'clock');
}

// ---- captions
{
  const xml = '<?xml version="1.0"?><transcript><text start="0.5" dur="2.1">Hello &amp;amp; welcome</text><text start="2.6" dur="1">it&#39;s <b>hot</b></text><text start="3.6" dur="1">it&#39;s <b>hot</b></text></transcript>';
  const a = parseCaptions(xml);
  ok(a.length === 2 && a[0].text === 'Hello & welcome' && a[1].text === "it's hot" && a[1].d >= 2, 'classic XML, entities, a repeated line merged: ' + JSON.stringify(a));
  const srv3 = '<timedtext format="3"><body><p t="1000" d="2500"><s>big</s><s t="300"> bang</s></p><p t="4000" d="1000">[Music]</p></body></timedtext>';
  const b = parseCaptions(srv3);
  ok(b.length === 2 && b[0].t === 1 && b[0].d === 2.5 && b[0].text === 'big bang' && b[1].text === '[Music]', 'srv3: ' + JSON.stringify(b));
  const j3 = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'one' }, { utf8: ' two' }] }, { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: '\n' }] }] });
  ok(JSON.stringify(parseCaptions(j3)) === JSON.stringify([{ t: 0, d: 1, text: 'one two' }]), 'json3');
  ok(parseCaptions('nonsense').length === 0, 'nothing from nonsense');
  const tracks = [{ languageCode: 'fr', baseUrl: 'f' }, { languageCode: 'en', kind: 'asr', baseUrl: 'ea' }, { languageCode: 'en-GB', baseUrl: 'eg' }];
  ok(pickTrack(tracks, 'en-US').baseUrl === 'eg', 'a person-written English track first');
  ok(pickTrack(tracks, 'fr-FR').baseUrl === 'f', 'their own language first');
  ok(pickTrack([{ languageCode: 'de', kind: 'asr', baseUrl: 'd' }], 'en').baseUrl === 'd', 'any track at all');
  ok(pickTrack([], 'en') === null, 'no tracks');
}

// ---- the backend, against a pretend YouTube
{
  const calls = [];
  const yt = async (url, o = {}) => {
    calls.push(url);
    if (url.includes('/youtubei/v1/player')) {
      const body = JSON.parse(o.body);
      ok(body.videoId === 'abcdefghijk' && body.context.client.clientName === 'ANDROID', 'asks as the Android app');
      return Response.json({ playabilityStatus: { status: 'OK' }, videoDetails: { title: 'Bees!', author: 'Buzz', lengthSeconds: '95', shortDescription: 'All about bees.' },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', kind: 'asr', baseUrl: 'https://www.youtube.com/api/timedtext?v=abcdefghijk&fmt=srv3' }] } } });
    }
    if (url.includes('/api/timedtext')) { ok(!url.includes('fmt='), 'the plain caption format is asked for'); return new Response('<transcript><text start="1" dur="2">Bees make honey</text></transcript>'); }
    return new Response('', { status: 404 });
  };
  const info = await videoInfo('abcdefghijk', 'en', yt);
  ok(info.title === 'Bees!' && info.channel === 'Buzz' && info.seconds === 95 && info.about === 'All about bees.' && info.auto === true, 'details: ' + JSON.stringify(info));
  ok(info.lines.length === 1 && info.lines[0].text === 'Bees make honey', 'its captions');
  // the app's way refused: the page's way
  const page = async url => url.includes('/youtubei/') ? new Response('no', { status: 403 })
    : url.includes('/watch?') ? new Response('<script>var ytInitialPlayerResponse = {"videoDetails":{"title":"From the page","author":"A","lengthSeconds":"10"}};</script>') : new Response('', { status: 404 });
  const p = await videoInfo('abcdefghijk', 'en', page);
  ok(p.title === 'From the page' && p.lines.length === 0 && p.why === 'no captions', 'the web page when the app way is refused: ' + JSON.stringify(p));
  const off = await videoInfo('abcdefghijk', 'en', async () => { throw new Error('offline'); });
  ok(off.why === 'YouTube did not answer' && off.lines.length === 0, 'YouTube unreachable: ' + JSON.stringify(off));
  const bad = await handleVideo(new Request('http://x/api/video?v=../../etc'), {}, yt);
  ok(bad.status === 400, 'a bad id is refused');
  const good = await handleVideo(new Request('http://x/api/video?v=abcdefghijk'), {}, yt);
  ok(good.status === 200 && /max-age=86400/.test(good.headers.get('cache-control')), 'captions are cached a day');
  const s = await (await handleVideo(new Request('http://x/api/video?q=bees'), {}, yt)).json();
  ok(s.error === 'search is not set up', 'no search without a key');
  const s2 = await (await handleVideo(new Request('http://x/api/video?q=bees'), { YOUTUBE_API_KEY: 'k' }, async url => {
    ok(/googleapis\.com\/youtube\/v3\/search/.test(url) && /safeSearch=strict/.test(url) && /videoEmbeddable=true/.test(url), 'searches safely for videos that can be embedded');
    return Response.json({ items: [{ id: { videoId: 'abcdefghijk' }, snippet: { title: 'Bees &amp; honey', channelTitle: 'Buzz' } }] });
  })).json();
  ok(s2.results?.[0]?.id === 'abcdefghijk' && s2.results[0].title === 'Bees & honey', 'search: ' + JSON.stringify(s2));
}

// ---- fitting the player onto four corners
{
  const pts = [[100, 50], [500, 80], [480, 330], [120, 300]];
  const m = /matrix3d\(([^)]+)\)/.exec(fitQuad(640, 360, pts))[1].split(',').map(Number);
  const at = (x, y) => { const X = m[0] * x + m[4] * y + m[12], Y = m[1] * x + m[5] * y + m[13], W = m[3] * x + m[7] * y + m[15]; return [X / W, Y / W]; };
  [[0, 0], [640, 0], [640, 360], [0, 360]].forEach(([x, y], i) => { const [X, Y] = at(x, y); ok(Math.hypot(X - pts[i][0], Y - pts[i][1]) < .01, `corner ${i} lands on its point (${X.toFixed(2)}, ${Y.toFixed(2)})`); });
}
console.log(process.exitCode ? 'the parts: some failed' : 'the parts: all passed');

// ---- in the page
if (process.argv.includes('--page')) {
  const url = new URL(process.argv[process.argv.indexOf('--page') + 1]?.startsWith('http') ? process.argv[process.argv.indexOf('--page') + 1] : 'http://localhost:5179/');
  url.searchParams.set('fakeplayer', '1');
  const { chromium } = createRequire(import.meta.url)('playwright');
  mkdirSync('tests/out', { recursive: true });
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const sizes = process.argv.includes('--phone') ? [{ width: 390, height: 780 }] : [{ width: 1100, height: 700 }];
  for (const viewport of sizes) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', msg => { if (msg.type() === 'error' || /\[reverie\]/.test(msg.text())) console.log('  page:', msg.text().slice(0, 240)); });
    const shot = name => page.screenshot({ path: `tests/out/watch-${name}-${viewport.width}.png` });
    const R = fn => page.evaluate(fn);
    const idle = (ms = 40000) => page.waitForFunction(() => !window.__reverie.brain.busy && !window.__reverie.brain.speaking, null, { timeout: ms });
    await page.goto(url.toString());
    await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
    await page.waitForSelector('#wake:not([hidden])', { timeout: 90000 });
    await page.click('#wake');
    await idle(60000).catch(() => fail('no hello'));

    // a pasted link: up on the screen at once, and Reverie hears it is on
    await page.fill('#say', 'look at this https://youtu.be/TESTVIDEO01');
    await page.press('#say', 'Enter');
    await page.waitForFunction(() => window.__reverie.watch.on && window.__reverie.watch.info?.lines?.length, null, { timeout: 30000 }).catch(() => fail('the video did not open'));
    await idle().catch(() => fail('no reaction to the video'));
    const opened = await R(() => { const h = window.__reverie.brain.history; return { asked: h.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('youtu.be'))?.content || '', said: h.filter(m => m.role === 'assistant').at(-1)?.content?.find?.(b => b.type === 'text')?.text }; });
    ok(/The screen rolled down and "Volcanoes for beginners" by Rocky Earth/.test(opened.asked) && /It has captions/.test(opened.asked), 'Claude hears the video is on: ' + opened.asked.slice(-400));
    ok(/popcorn/i.test(opened.said || ''), 'it reacts: ' + opened.said);
    // seated and the camera on the sofa, the player fitted onto the screen
    await page.waitForFunction(() => !document.querySelector('#screen').hidden && !window.__reverie.world.walking, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const placed = await R(() => {
      const w = window.__reverie, p = w.world.creature.root.position, el = document.querySelector('#screen'), r = el.firstElementChild?.getBoundingClientRect();
      return { x: p.x, z: p.z, hidden: el.hidden, box: r && { l: r.left, t: r.top, w: r.width, h: r.height }, stage: document.querySelector('#stage').getBoundingClientRect().toJSON(), bar: document.querySelector('#gamebar span').textContent };
    });
    const seatX = viewport.width / viewport.height < 1.1 ? -.32 : -.68;
    ok(Math.hypot(placed.x - seatX, placed.z - .35) < .1, `it sat down by the screen (${placed.x.toFixed(2)}, ${placed.z.toFixed(2)})`);
    ok(!placed.hidden && placed.box && placed.box.w > placed.stage.width * .35, 'the player is on the screen and big: ' + JSON.stringify(placed.box));
    ok(/Volcanoes for beginners · 0:\d\d \/ 3:00/.test(placed.bar), 'the bar: ' + placed.bar);
    await shot('playing');

    // what they say goes with where they are and what was said
    await page.waitForFunction(() => window.__reverie.watch.player.time() > 16, null, { timeout: 30000 });
    await page.fill('#say', 'what did they say just now?');
    await page.press('#say', 'Enter');
    await idle().catch(() => fail('no answer'));
    // (the line rides with what they said when it is sent, not in the history: the fake quotes it back)
    const answer = await R(() => window.__reverie.brain.history.at(-1).content.find(b => b.type === 'text')?.text);
    ok(/^They said: .*(lava|magma|rock|melt|explode|volcano)/i.test(answer || ''), 'it answers from the captions: ' + answer);
    ok(/^\[watching "Volcanoes for beginners" by Rocky Earth on the screen together: 0:\d\d of 3:00, playing\. Said in the last minute: "/.test(await R(() => window.__reverie.watch.context())), 'the context line: ' + await R(() => window.__reverie.watch.context()));

    // the video talking, heard by the mic, isn't them; their own words are; its name always is
    const ears = await R(() => { const w = window.__reverie.watch, t = w.player.time(), now = w.info.lines.filter(l => l.t <= t && !/^\[/.test(l.text)).at(-1).text; return { now, video: w.isVideo(now.toLowerCase().replace(/[.,]/g, '')), them: w.isVideo('can we have pizza for tea later'), name: w.isVideo('reverie what is magma') }; });
    ok(ears.video && !ears.them && !ears.name, 'the video is told apart from them: ' + JSON.stringify(ears));

    // a quiet moment: it chips in (the laughter at 0:19 starts a long gap), and the video ducks while it talks
    await R(() => { const w = window.__reverie.watch; w.command({ action: 'chatter', chatter: 'chatty' }); });
    const n0 = await R(() => window.__reverie.brain.history.length);
    await page.waitForFunction(() => { const h = window.__reverie.brain.history; return h.some(m => m.role === 'user' && typeof m.content === 'string' && /\[watch\] A quiet moment/.test(m.content)); }, null, { timeout: 90000 }).catch(() => fail('it never chipped in'));
    await page.waitForFunction(() => window.__reverie.brain.speaking, null, { timeout: 15000 }).catch(() => {});
    const duck = await R(() => window.__reverie.watch.player.level);
    ok(duck < .5, 'the video ducks while it talks: ' + duck);
    await idle();
    const chip = await R(n => window.__reverie.brain.history.slice(n).find(m => m.role === 'user' && /\[watch\]/.test(m.content))?.content, n0);
    ok(/Said since you last spoke: "/.test(chip || ''), 'the news says what was said: ' + chip?.slice(0, 300));
    ok(await R(() => window.__reverie.watch.player.level) > .9, 'the sound comes back');
    await shot('chipping-in');

    // find and seek, through Claude's tool
    await page.fill('#say', 'find the bit about marshmallows'); await page.press('#say', 'Enter'); await idle();
    const found = await R(() => window.__reverie.brain.history.at(-1).content.find(b => b.type === 'text')?.text);
    ok(/Found it, at 0:2\d/.test(found || ''), 'find: ' + found);
    await page.fill('#say', 'go to 100 seconds'); await page.press('#say', 'Enter'); await idle();
    const t = await R(() => window.__reverie.watch.player.time());
    ok(t >= 100 && t < 110, 'seek: ' + t);

    // pause: it turns round to you, and the bar's button says Play
    await page.click('#gamebar button[data-id="toggle"]');
    await page.waitForTimeout(1500);
    ok(await R(() => window.__reverie.watch.player.state()) === 'paused', 'paused from the bar');
    ok(await page.textContent('#gamebar button[data-id="toggle"]') === 'Play', 'the bar offers Play');
    await shot('paused');

    // Done: the screen rolls up and it goes back to its place
    await page.click('#gamebar button[data-id="close"]');
    await page.waitForFunction(() => Math.abs(window.__reverie.world.creature.root.position.x) < .05, null, { timeout: 30000 }).catch(() => {});
    const after = await R(() => ({ on: window.__reverie.watch.on, hidden: document.querySelector('#screen').hidden, x: window.__reverie.world.creature.root.position.x, seat: window.__reverie.world.seat, bar: document.querySelector('#gamebar').hidden }));
    ok(!after.on && after.hidden && Math.abs(after.x) < .05 && !after.seat && after.bar, 'put away: ' + JSON.stringify(after));
    ok(await R(() => JSON.stringify(window.__reverie.memory.all().days).includes('watched \\"Volcanoes for beginners\\" together')), 'the diary has it');

    // the sheet: from the TV button, a pasted link, and a link that isn't one
    await page.click('#tv');
    ok(await page.isVisible('#watching'), 'the TV button opens the sheet');
    await page.fill('#watching input[type=url]', 'not a link'); await page.click('#watching button[data-id="go"]');
    ok(/doesn't look like a YouTube link/.test(await page.textContent('#watching .note')), 'a wrong link is explained');
    await page.fill('#watching input[type=url]', 'https://www.youtube.com/watch?v=NOCAPTIONS1'); await page.click('#watching button[data-id="go"]');
    await page.waitForFunction(() => window.__reverie.watch.on, null, { timeout: 30000 });
    await idle();
    const noCap = await R(() => ({ bar: document.querySelector('#gamebar span').textContent, video: window.__reverie.watch.isVideo('some words from the video'), name: window.__reverie.watch.isVideo('reverie, pause it') }));
    ok(noCap.video && !noCap.name, 'no captions: only its name is them: ' + JSON.stringify(noCap));
    await R(() => window.__reverie.watch.overheard('and that is how bees make honey'));
    ok(/your ears caught lately \(patchy\): "and that is how bees make honey"/.test(await R(() => window.__reverie.watch.context())), 'what its ears catch is the transcript');
    ok(/say "Reverie…" to talk/.test(noCap.bar), 'the bar says how to talk: ' + noCap.bar);
    await page.fill('#say', 'stop watching'); await page.press('#say', 'Enter'); await idle();
    ok(!(await R(() => window.__reverie.watch.on)), 'stop watching puts it away');

    ok(!errors.length, 'no page errors: ' + errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(process.exitCode ? 'the page: some failed' : 'the page: all passed');
}
