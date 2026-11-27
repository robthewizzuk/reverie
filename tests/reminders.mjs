// Reminders and timers on their own (no browser): reading times and lengths, setting, cancelling, snoozing, repeats,
// what goes off when, and the line Claude reads. Then, with a browser (start the dev server with REVERIE_FAKE=1):
// a timer asked for in words, its chip counting down, the chime and Reverie saying so, stopping it by talking, a
// reminder kept over a reload, cancelling it, and one that went off while the page was closed.
//   TZ=Europe/London node tests/reminders.mjs            on their own
//   REVERIE_FAKE=1 npm run dev -- --port 5179   then   node tests/reminders.mjs --page [url]
import { makeReminders, parseAt, parseLength, chipTime } from '../src/reminders.js';

const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (cond, msg) => { if (!cond) fail(msg); };

// ---- on their own, with a clock that moves (Friday 27 November 2026, 14:02, in their own time zone)
{
  const T = s => new Date(s).getTime();
  let now = T('2026-11-27T14:02');
  const at = s => { const t = parseAt(s, now); return t == null ? null : new Date(t).toString().slice(0, 21); };
  ok(at('18:00') === 'Fri Nov 27 2026 18:00', '18:00 is later today');
  ok(at('6pm') === 'Fri Nov 27 2026 18:00' && at('at 6') === 'Fri Nov 27 2026 18:00', '"at 6" in the afternoon is this evening');
  ok(at('13:00') === 'Sat Nov 28 2026 13:00', 'a time gone today is tomorrow');
  ok(at('2026-11-28 09:30') === 'Sat Nov 28 2026 09:30' && at('2026-11-28T09:30') === 'Sat Nov 28 2026 09:30', 'a date and time');
  ok(at('tomorrow 9am') === 'Sat Nov 28 2026 09:00', 'tomorrow');
  ok(at('monday 8:15') === 'Mon Nov 30 2026 08:15', 'a weekday');
  ok(at('friday 10am') === 'Fri Dec 04 2026 10:00', 'today\'s weekday, gone: next week');
  ok(at('3 December') === 'Thu Dec 03 2026 09:00', 'a day alone is nine in the morning');
  ok(at('noon') === 'Sat Nov 28 2026 12:00' && at('tonight') === 'Fri Nov 27 2026 20:00', 'noon and tonight');
  ok(at('soonish') === null && at('25:00') === null, 'nonsense is refused');
  ok(parseLength(10) === 600e3 && parseLength('1h 30m') === 5400e3 && parseLength('an hour and a half') === 5400e3 && parseLength('half an hour') === 1800e3 && parseLength('90 seconds') === 90e3, 'lengths of time');
  ok(parseLength('bad') === null && parseLength(-3) === null, 'bad lengths refused');

  const data = new Map(), store = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  let r = makeReminders({ store, clock: () => now });
  ok(r.line() === '' && r.items.length === 0, 'nothing set says nothing');
  const t1 = r.set({ action: 'set', minutes: 10, what: 'pasta' });
  ok(typeof t1 === 'string' && /10 minute timer for pasta/.test(t1) && /14:12/.test(t1), 'a timer: ' + t1);
  const t2 = r.set({ what: 'call Mum', at: '18:00' });
  ok(/reminder to call Mum/.test(t2) && /18:00 today/.test(t2), 'a reminder: ' + t2);
  r.set({ what: 'take my vitamins', at: '08:00', repeat: 'weekdays' });
  ok(r.set({ at: 'whenever', what: 'x' }).error && r.set({ what: 'x' }).error && r.set({ minutes: 'lots' }).error, 'bad ones refused');
  ok(r.set({ at: '2026-11-27 09:00', what: 'old' }).error, 'a time gone is refused');
  ok(r.items[0].kind === 'timer' && r.items[1].kind === 'reminder', 'kinds: timer and reminder');
  console.log('line:', r.line());
  ok(/vitamins at 08:00 on Monday 30 November/.test(r.line()), 'a weekday reminder starts on a weekday');
  ok(/pasta timer 10 minutes left/.test(r.line()) && /call Mum at 18:00 today/.test(r.line()), 'Claude\'s line');
  ok(chipTime(r.items[0], now) === '10:00' && chipTime(r.items[1], now) === '18:00', 'chips: ' + chipTime(r.items[0], now));
  // kept in the store
  r = makeReminders({ store, clock: () => now });
  ok(r.items.length === 3, 'kept');
  // the timer goes off
  now += 9 * 60e3; ok(r.due().length === 0, 'not yet');
  now += 61e3; let d = r.due();
  ok(d.length === 1 && d[0].what === 'pasta' && d[0].late < 2000, 'the pasta timer goes off');
  ok(r.items.length === 2, 'and is taken off');
  // snoozed
  ok(/again in 5 minutes/.test(r.snooze({}, d[0])), 'snoozed');
  ok(r.items.some(x => x.what === 'pasta'), 'back on the list');
  now += 5 * 60e3 + 1000; ok(r.due()[0]?.what === 'pasta', 'goes off again');
  // cancel by words, and refused when nothing matches
  ok(/^Cancelled the reminder to call Mum/.test(r.cancel({ what: 'mum' })), 'cancelled by a word');
  ok(r.cancel({ what: 'the dentist' }).error, 'nothing matches');
  // a repeat moves on to its next time (Saturday and Sunday skipped: weekdays)
  now = T('2026-11-30T08:00:30');
  d = r.due(); ok(d.length === 1 && d[0].repeat === 'weekdays', 'the weekday reminder');
  ok(new Date(r.items[0].at).toString().slice(0, 21) === 'Tue Dec 01 2026 08:00', 'its next time is Tuesday: ' + new Date(r.items[0].at));
  // gone off while away: late
  now = T('2026-12-01T09:30'); d = r.due(); ok(d.length === 1 && d[0].late > 3600e3, 'missed while away is late');
  ok(/^Cancelled/.test(r.cancel({ what: 'all' })) && r.items.length === 0, 'cancel all');
  console.log(process.exitCode ? 'reminders: failed' : 'reminders on their own: ok');
}

// ---- in the page
if (process.argv.includes('--page')) {
  const { createRequire } = await import('node:module');
  const { chromium } = createRequire(import.meta.url)('playwright');
  const url = process.argv.find(a => a.startsWith('http')) || 'http://localhost:5179/?debug';
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 1, timezoneId: 'Europe/London' });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' || /\[reverie\]/.test(m.text())) console.log('  page:', m.text().slice(0, 240)); });
  const boot = async () => {
    await page.waitForFunction(() => window.__reverie, null, { timeout: 180000 });
    await page.waitForSelector('#wake:not([hidden])', { timeout: 60000 });
  };
  async function ask(text, until = () => !window.__reverie.brain.busy) {
    await page.fill('#say', text); await page.press('#say', 'Enter');
    await page.waitForTimeout(300);
    await page.waitForFunction(until, null, { timeout: 60000 }).catch(() => fail(`"${text}" did not finish`));
  }
  await page.goto(url); await boot();
  await page.evaluate(() => { localStorage.removeItem('reverie.reminders.v1'); });
  await page.reload(); await boot();
  await page.click('#wake'); await page.waitForTimeout(500);

  await ask('set a timer for 6 seconds for the tea', () => !window.__reverie.brain.busy && window.__reverie.reminders.items.length === 1);
  const chip = await page.textContent('#timers').catch(() => '');
  console.log('chip:', chip);
  ok(/Tea/.test(chip) && /0:0\d/.test(chip), 'the chip shows the countdown: ' + chip);
  const sees = await page.evaluate(() => window.__reverie.world.scene());
  ok(/tea timer/.test(sees), 'Claude\'s scene line has the timer: ' + sees);
  await page.screenshot({ path: 'tests/out/reminders-1-timer.png' });
  // it goes off: rings, and Reverie says so
  await page.waitForFunction(() => window.__reverie.timers.ringing.length > 0, null, { timeout: 15000 }).catch(() => fail('the timer did not go off'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/out/reminders-2-ringing.png' });
  ok((await page.evaluate(() => window.__reverie.timers.chimes)) >= 1, 'the chime rang');
  await page.waitForFunction(() => window.__reverie.brain.history.some(m => typeof m.content === 'string' && /\[timer\] The 6 second timer for tea has finished/.test(m.content)), null, { timeout: 20000 })
    .catch(() => fail('Reverie was not told the timer finished'));
  ok(/time's up/i.test(await page.textContent('#timers')), 'the chip says time\'s up');
  // talking stops the chime
  await ask('thanks');
  ok(await page.evaluate(() => window.__reverie.timers.ringing.every(r => r.done)), 'talking stopped the chime');
  // a reminder, kept over a reload, and cancelled
  await ask('remind me at 23:59 to water the plants', () => !window.__reverie.brain.busy && window.__reverie.reminders.items.length === 1);
  const set = await page.evaluate(() => JSON.stringify(window.__reverie.brain.history.slice(-3)));
  ok(/Set a reminder to water the plants/.test(set), 'the reminder was set: ' + set.slice(0, 300));
  ok(/Water the plants/.test(await page.textContent('#timers')) && /23:59/.test(await page.textContent('#timers')), 'its chip');
  await page.screenshot({ path: 'tests/out/reminders-3-reminder.png' });
  await page.reload(); await boot();
  ok(/Water the plants/.test(await page.textContent('#timers')), 'kept over a reload');
  await page.click('#wake'); await page.waitForTimeout(500);
  await ask('cancel the plants', () => !window.__reverie.brain.busy && window.__reverie.reminders.items.length === 0);
  ok(await page.isHidden('#timers'), 'no chips when nothing is set');
  // the ✕ on a chip cancels it too
  await ask('set a timer for 30 minutes', () => !window.__reverie.brain.busy && window.__reverie.reminders.items.length === 1);
  await page.click('#timers .chip [data-cancel]');
  ok(await page.evaluate(() => window.__reverie.reminders.items.length === 0), 'the ✕ cancelled it');
  // one that went off while the page was closed: told gently, not rung
  await page.evaluate(() => localStorage.setItem('reverie.reminders.v1', JSON.stringify({ v: 1, items: [{ id: 'rold', kind: 'reminder', what: 'feed the cat', at: Date.now() - 40 * 60e3, made: Date.now() - 3600e3 }] })));
  await page.reload(); await boot();
  ok(/Feed the cat/.test(await page.textContent('#timers')), 'the missed one has a chip');
  await page.click('#wake');
  await page.waitForFunction(() => window.__reverie.brain.history.some(m => typeof m.content === 'string' && /time to feed the cat.*while they were away/.test(m.content)), null, { timeout: 30000 })
    .catch(() => fail('Reverie was not told about the missed reminder'));
  // the service worker is there (no caching, push only)
  ok(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())), 'the service worker is registered');
  if (errors.length) fail('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log(process.exitCode ? 'reminders page: failed' : 'reminders page: ok');
}
