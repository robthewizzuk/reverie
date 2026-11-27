// The garden's numbers (src/plants.js), no browser: plants grow over real days while watered, droop when dry but never
// die, perk up when watered, flower, ripen, can be picked, and are kept. Fake clock and store.
//   node tests/plants.mjs
import { makePlants, kindOf, potIndex, potLine, droopOf, KINDS } from '../src/plants.js';
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (c, msg) => c ? console.log('ok  ', msg) : fail(msg);
let t = Date.UTC(2026, 10, 27, 9), kept = null;
const store = { load: () => kept && JSON.parse(kept), save: o => { kept = JSON.stringify(o); } };
const now = () => t, H = 3.6e6;

ok(kindOf('a pink tulip') === 'tulip' && kindOf('strawberries') === 'strawberry' && kindOf('something magic') === 'glowbloom' && kindOf('a rose') === 'tulip' && kindOf('flowers') === 'daisy' && kindOf('carrots') === null, 'seed words');
let g = makePlants({ store, now });
const sun = g.plant('sunflower', { name: 'Sunny' }), tul = g.plant('tulip'), str = g.plant('strawberry', { pot: 2 });
ok(g.pots.every(Boolean) && g.plant('daisy') === null, 'three pots, then full');
ok(potIndex('sunny', g.pots) === 0 && potIndex('the middle one', g.pots) === 1 && potIndex('the strawberries', g.pots) === 2, 'pots by name, place and kind');

// a day, watered: a sprout
t += 24 * H; let ev = g.tick();
ok(ev.some(e => e.id === sun.id && e.what === 'sprouted'), 'sprouted after a day: ' + JSON.stringify(ev.map(e => e.what)));
ok(sun.water > 0 && sun.water < .4, 'water drains over a day: ' + sun.water.toFixed(2));
// watered every day: the tulip flowers on day 4, the sunflower on day 5
for (let d = 0; d < 4; d++) { [0, 1, 2].forEach(i => g.water(i)); t += 24 * H; ev = g.tick(); }
ok(tul.g >= 1 && sun.g > .95, `tulip in flower by day 5, sunflower about to (${tul.g.toFixed(2)}, ${sun.g.toFixed(2)})`);
console.log('     ' + potLine(sun, t) + ' | ' + potLine(tul, t) + ' | ' + potLine(str, t));
// left dry for two days: no growth, droops, never dies
const g0 = sun.g; t += 60 * H; g.tick();
ok(sun.g - g0 < .1 && droopOf(sun) >= .9 && g.pots[0], `dry: stops growing and droops (${droopOf(sun).toFixed(2)}), still there`);
ok(/badly needs water/.test(potLine(sun, t)), 'Claude hears it needs water: ' + potLine(sun, t));
g.water(0); ok(droopOf(sun) === 0 && sun.water === 1, 'a drink perks it up');
// strawberries ripen two days after flowering, and can be picked
[0, 1, 2].forEach(i => g.water(i)); t += 30 * H; g.tick(); [0, 1, 2].forEach(i => g.water(i)); t += 30 * H; ev = g.tick();
ok(str.ripe >= 1 && g.pick(2) && str.ripe === 0 && str.g >= 1, 'strawberry ripens and is picked: ' + str.ripe);
ok(g.pick(1) && tul.g < 1 && tul.picked === 1, 'a picked tulip goes back to a bud');
ok(!g.pick(1), 'nothing to pick on a bud');
// kept, and caught up after a week away
const id = sun.id; t += 7 * 24 * H;
g = makePlants({ store, now });
ok(g.pots[0]?.id === id && g.pots[0].name === 'Sunny', 'kept on the device');
ok(droopOf(g.pots[0]) >= 1 && g.away.some(e => e.what === 'drooping'), 'a week away: drooping, and told: ' + JSON.stringify(g.away.map(e => e.what)));
ok(g.dig(1)?.kind === 'tulip' && g.pots[1] === null, 'dug up');
ok(Object.values(KINDS).every(k => k.days >= 3 && k.drink >= 24), 'every plant takes days, and a watering lasts a day or more');
