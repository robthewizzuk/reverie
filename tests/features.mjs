// Unit tests for the 6 new features (no browser): Card Table Games, Chalkboard Word Games,
// Mini Desk Aquarium, Time Capsule Jars, Bedtime Storytime, and Pocket Jam Session,
// plus persona.js schema/dedup checks.
//   node tests/features.mjs
import { makeCardGame, TAROT_DECK } from '../src/games/cards-logic.js';
import { makeWordGame } from '../src/games/words-logic.js';
import { makeAquariumState, MAX_FISH, HUNGRY_MS } from '../src/aquarium-state.js';
import { makeCapsuleState, parseOpenDate, MAX_CAPSULES } from '../src/capsule-state.js';
import { makeStoryState } from '../src/storytime-state.js';
import { makeJamState, JAM_PADS } from '../src/jam-state.js';
import { makeBattleshipsGame, parseCoord, FLEET } from '../src/games/battleships-logic.js';
import { makeRadioState, STATION_NAMES } from '../src/radio-state.js';
import { makeThemesState, THEME_NAMES } from '../src/themes-state.js';
import { makeFocusState, formatClock } from '../src/focus-state.js';
import { makeTinyBrains } from '../src/tiny-brains.js';
import { describe, colourName } from '../src/describe.js';
import { isBargeIn, isPureHush, settleDelay } from '../src/turn-taking.js';
import { makeMemory, exportBackup, importBackup } from '../src/memory.js';
import { freePlace, FIXTURES } from '../src/room.js';
import { SYSTEM, TOOLS } from '../server/persona.js';

const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (cond, msg) => { if (!cond) fail(msg); };

// 1. Card Table Games (Blackjack, Higher/Lower, Fortune Teller)
{
  const bj = makeCardGame('blackjack', { seed: 42, level: 2 });
  ok(bj.player.length === 2 && bj.dealer.length === 2, 'blackjack deals 2 cards each');
  if (bj.state === 'play') {
    const r = bj.stand();
    ok(r.ok && r.over && ['win', 'lose', 'draw'].includes(r.result), 'blackjack stand resolves round');
    ok(!bj.dealerHidden, 'dealer card revealed on stand');
  }

  const hl = makeCardGame('higher_lower', { seed: 7, level: 1 });
  ok(hl.current && hl.target === 4, 'higher/lower starts with 1 card and target 4 at level 1');
  const g1 = hl.guess('higher');
  ok(g1.ok && hl.history.length === 2, 'higher/lower draws next card');

  const ft = makeCardGame('fortune', { seed: 99 });
  ok(TAROT_DECK.length >= 12 && ft.fortune.length === 3, 'fortune deals 3 tarot cards');
  ok(ft.flip(0).ok && ft.revealed === 1, 'flip past card');
  ok(!ft.flip(0).ok, 'refuses re-flipping same card');
  ok(ft.flip().ok && ft.flip().ok && ft.state === 'over', 'flip remaining cards finishes spread');
  console.log('cards: ok');
}

// 2. Chalkboard Word Games (Wordle + Hangman)
{
  const w = makeWordGame({ mode: 'wordle', answer: 'magic' });
  ok(!w.guess('cat').ok, 'wordle rejects wrong length');
  const r1 = w.guess('music');
  ok(r1.ok && !r1.over && r1.mark.join(',') === 'hit,miss,miss,hit,hit', 'wordle scores hit/miss accurately: ' + r1.mark);
  ok(/Hint:/.test(w.hint()), 'wordle gives a hint');
  const r2 = w.guess('magic');
  ok(r2.ok && r2.over && r2.result === 'win', 'wordle wins on exact word');
  ok(w.keyboardStatus().m === 'hit', 'keyboard tracks best status');

  const h = makeWordGame({ mode: 'hangman', answer: 'dragon' });
  ok(h.masked() === '_ _ _ _ _ _', 'hangman masks answer');
  ok(h.guess('a').ok && h.masked() === '_ _ A _ _ _', 'hangman reveals matching letter');
  ok(!h.guess('a').ok, 'hangman rejects repeated letter');
  ok(h.guess('z').ok && h.wrong.length === 1, 'hangman records miss');
  const hw = h.guess('dragon');
  ok(hw.ok && hw.over && hw.result === 'win', 'hangman allows whole-word solve');
  console.log('words: ok');
}

// 3. Mini Desk Aquarium
{
  let now = 1_700_000_000_000;
  const aq = makeAquariumState({ clock: () => now });
  ok(aq.fish.length === 0 && aq.line() === '', 'empty aquarium has no context line');
  const a1 = aq.add({ species: 'glowing jellyfish', name: 'Luna' });
  ok(a1.fish.kind === 'jellyfish' && a1.fish.name === 'Luna', 'maps species and keeps name');
  ok(!aq.isHungry(), 'freshly added fish not hungry');
  now += HUNGRY_MS + 1000;
  ok(aq.isHungry() && /hungry/.test(aq.line()), 'fish becomes hungry after 18h');
  ok(!aq.feed().error && !aq.isHungry(), 'feeding resets hunger');
  ok(aq.setDecor('pirate ship').decor === 'pirate_ship', 'decor maps pirate ship');
  ok(!aq.rename({ which: 'Luna', name: 'Nova' }).error && aq.fish[0].name === 'Nova', 'renames fish');
  for (let i = 0; i < MAX_FISH - 1; i++) ok(!aq.add({ species: 'goldfish' }).error, 'fills tank up to max');
  ok(!!aq.add({ species: 'betta' }).error, 'refuses exceeding max fish');
  ok(!aq.remove({ which: 'Nova' }).error && aq.fish.length === MAX_FISH - 1, 'removes fish');
  console.log('aquarium: ok');
}

// 4. Time Capsule Jars
{
  let now = new Date('2026-11-27T10:00:00Z').getTime();
  const cap = makeCapsuleState({ clock: () => now, birthday: () => '12-15' });
  ok(parseOpenDate('my birthday', now, '12-15') > now, 'parses upcoming birthday');
  const s1 = cap.seal({ note: 'Hello future me!', prop: 'a golden dragon', until: 'in 7 days', label: 'Next week' });
  ok(!s1.error && cap.items.length === 1 && cap.due().length === 0, 'seals capsule for future');
  ok(cap.open(s1.capsule.id).locked, 'refuses opening early without force');
  now += 8 * 86400e3;
  ok(cap.due().length === 1 && /READY TO OPEN/.test(cap.line()) && /glowing/.test(cap.briefingLine()), 'capsule becomes due and joins briefing');
  const o1 = cap.open(s1.capsule.id);
  ok(!o1.error && !o1.locked && /Hello future me!/.test(o1.text) && /golden dragon/.test(o1.text), 'opens due capsule with note and prop');
  ok(cap.items.length === 0, 'opened capsule leaves active shelf');
  for (let i = 0; i < MAX_CAPSULES; i++) ok(!cap.seal({ note: 'n' + i, until: 'tomorrow' }).error, 'fills shelf to max');
  ok(!!cap.seal({ note: 'extra', until: 'tomorrow' }).error, 'refuses exceeding max capsules');
  console.log('capsules: ok');
}

// 5. Bedtime Storytime
{
  const st = makeStoryState();
  ok(!st.active && st.line() === '', 'inactive storytime has empty line');
  st.start({ title: 'The Moon Dragon', theme: 'adventure' });
  ok(st.active.title === 'The Moon Dragon' && /Moon Dragon/.test(st.line()), 'starts storytime');
  st.puppet({ character: 'Sir Pip', prop: 'a tiny knight' });
  ok(st.active.puppet === 'a tiny knight' && st.active.speaker === 'Sir Pip', 'tracks puppet and speaker');
  st.scene({ beat: 'crossed the starlight bridge' });
  ok(st.active.beats.length === 1, 'records story beats');
  const ended = st.end();
  ok(ended.title === 'The Moon Dragon' && !st.active, 'ends storytime cleanly');
  console.log('storytime: ok');
}

// 6. Pocket Jam Session
{
  const jm = makeJamState();
  ok(!jm.playing && JAM_PADS.length === 6, 'jam starts off with 6 pads');
  jm.start({ style: 'funk', mood: 'groovy', bpm: 112 });
  ok(jm.playing && jm.style === 'funk' && jm.bpm === 112, 'starts with requested style and bpm');
  jm.change({ faster: true, drums: false });
  ok(jm.bpm === 128 && !jm.layers.drums && jm.layers.bass, 'tweaks tempo and layers');
  jm.change({ bass: false, chords: false, lead: false });
  ok(jm.activeLayers().length >= 1, 'never leaves zero layers active');
  ok(jm.stop() && !jm.playing, 'stops cleanly');
  console.log('jam: ok');
}

// 7. Battleships
{
  ok(parseCoord('fire at B4')?.r === 3 && parseCoord('fire at B4')?.c === 1, 'parses B4 coordinate');
  const bs = makeBattleshipsGame({ seed: 123, level: 3 });
  ok(bs.player.ships.length === FLEET.length && bs.ai.ships.length === FLEET.length, 'places full 4-ship fleets');
  const [sr, sc] = bs.ai.ships[0].cells[0];
  const shot = bs.fire(sr, sc);
  ok(shot.ok && shot.player.hit && bs.turns === 1, 'fires and registers hit + AI counter-shot');
  ok(!bs.fire(sr, sc).ok, 'refuses firing at same coordinate twice');
  console.log('battleships: ok');
}

// 8. Cosy Workshop Radio
{
  const rad = makeRadioState();
  ok(!rad.playing && STATION_NAMES.length === 6, 'radio starts off with 6 stations');
  ok(rad.play('crackling fire').station === 'fireplace' && rad.playing, 'maps fireplace alias');
  ok(rad.setVolume(40).volume === 40 && /40%/.test(rad.line()), 'sets volume and builds context line');
  ok(!rad.next().error && rad.station === 'rain', 'cycles to next station');
  ok(rad.stop().was && !rad.playing, 'stops cleanly');
  console.log('radio: ok');
}

// 9. Mood-Reactive Room Themes
{
  const th = makeThemesState();
  ok(THEME_NAMES.includes('spaceship') && th.get('cozy cabin')?.key === 'cabin', 'resolves built-in theme aliases');
  const saved = th.savePreset('Sunset Chill', { room: { walls: '#ffeedd' }, colours: { glow: '#ff8844' } });
  ok(!saved.error && th.get('sunset chill')?.isCustom, 'saves and recalls custom preset');
  ok(!th.removePreset('sunset chill').error && !th.get('sunset chill'), 'deletes custom preset');
  console.log('themes: ok');
}

// 10. Focus / Pomodoro Buddy
{
  let now = new Date('2026-11-27T14:00:00Z').getTime();
  const fc = makeFocusState({ clock: () => now });
  ok(formatClock(90_000) === '01:30', 'formats clock mm:ss');
  ok(!fc.start({ minutes: 1, label: 'Writing' }).error && fc.active.phase === 'focus', 'starts focus session');
  ok(!fc.pause().error && fc.tick(65_000) === null, 'paused timer does not advance');
  ok(!fc.resume().error, 'resumes timer');
  const done = fc.tick(61_000);
  ok(done?.done && done.phase === 'focus' && fc.stats.sessions === 1 && fc.stats.streak === 1, 'completes session and increments streak');
  console.log('focus: ok');
}

// 11. Multi-Brain Tiny Brains Suite
{
  const tb = makeTinyBrains();
  const focusSee = [0, -1, -1, -1, 0, 0, -1, 1]; // focusMode = 1
  const pFocus = tb.pickIdle(focusSee, ['rest', 'glance', 'hop', 'stretch'], 1);
  ok(['rest', 'glance'].includes(pFocus.act), 'focus mode stays calm: ' + pFocus.act);
  const normalSee = [-.5, 1, 0, .6, -.5, .8, 1, -1];
  tb.rewardIdle(normalSee, 'hop', { strong: true });
  tb.rewardIdle(normalSee, 'hop', { strong: true });
  ok(tb.pickIdle(normalSee, ['rest', 'glance', 'sway', 'hop'], 1).act === 'hop', 'coach learns liked idle move');
  ok(tb.pickReaction([.5, -.5, -1, 1, -1, 0], ['wave', 'bounce']).length > 0, 'react brain picks gesture');
  const sk0 = tb.skill();
  tb.recordGameResult(true); tb.recordGameResult(true); tb.recordGameResult(true);
  ok(tb.skill() >= sk0 && tb.stats().rounds === 3, 'skill dial adapts upward after player wins');
  tb.noteActivity('game'); tb.noteActivity('music'); tb.noteActivity('game');
  ok(tb.favouriteNext().guess != null, 'activity predictor tracks habits');
  tb.forgetAll();
  ok(tb.stats().rounds === 0, 'forgetAll resets all tiny brains');
  console.log('tiny-brains: ok');
}

// 12. Improved Item Descriptions (src/describe.js)
{
  const fakeMesh = {
    isMesh: true, name: 'wingL', userData: { part: 'wing' }, scale: { x: 1, y: 1, z: 1 }, position: { x: 0, y: 0, z: 0 },
    geometry: { boundingBox: { min: { x: -.2, y: 0, z: -.1 }, max: { x: .2, y: .7, z: .1 } } },
    material: { color: { r: .85, g: .65, b: .15 }, metalness: .85, roughness: .2, emissiveIntensity: .8 },
  };
  const fakeThing = {
    userData: {
      generatedSpec: { kind: 'creature', thing: 'dragon', style: 'lego', with: { how: 'with', crest: 'flame' } },
    },
    traverse(fn) { fn(this); fn(fakeMesh); },
  };
  const d = describe(fakeThing, 'a glowing gold lego dragon', { size: .4 });
  ok(/dragon/.test(d.short) && !/creature/.test(d.short), 'prefers spec.thing over generic spec.kind: ' + d.short);
  ok(/glowing/.test(d.text) && /metallic/.test(d.text) && /wings/.test(d.text) && /flame/.test(d.text), 'reports real mesh finish, parts, crest: ' + d.text);
  ok(/tall and upright/.test(d.text), 'reports actual 3D proportions: ' + d.text);
  ok(!/Not reflected/.test(d.text), 'no false-positive missing words: ' + d.text);
  ok(colourName('#d6a634') === 'gold', 'colourName maps gold accurately');
  console.log('describe: ok');
}

// 13. Persona prompt & tool checks
{
  const diaryCount = (SYSTEM.match(/^Your diary:/gm) || []).length;
  ok(diaryCount === 1, `expected 1 "Your diary:" section in SYSTEM, found ${diaryCount}`);
  const names = new Set(TOOLS.map(t => t.name));
  for (const req of ['play', 'aquarium', 'capsule', 'story', 'jam', 'radio', 'theme', 'focus']) ok(names.has(req), `tool ${req} registered`);
  const playTool = TOOLS.find(t => t.name === 'play');
  for (const g of ['cards', 'words', 'battleships']) ok(playTool.input_schema.properties.game.enum.includes(g), `play tool includes ${g}`);
  console.log('persona: ok');
}

// 14. Conversational Turn-Taking & Barge-In (src/turn-taking.js)
{
  // Instant keyword barge-in even on 1 word
  ok(isBargeIn('stop', { words: ['stop'], yours: ['stop'] }), '1-word "stop" barges in');
  ok(isBargeIn('wait', { words: ['wait'], yours: [] }), 'keyword "wait" barges in even if in echo');
  ok(isBargeIn('hold on', { words: ['hold', 'on'], yours: ['hold', 'on'] }), '"hold on" barges in');
  // 2+ clean non-echo words barge in
  ok(isBargeIn('make tea', { words: ['make', 'tea'], yours: ['make', 'tea'] }), '2 clean non-echo words barge in');
  // 1 random non-keyword word or echo does NOT barge in
  ok(!isBargeIn('dragon', { words: ['dragon'], yours: ['dragon'] }), '1 non-keyword word does not barge in');
  ok(!isBargeIn('the dragon', { words: ['the', 'dragon'], yours: ['dragon'] }), '2 words with echo does not barge in');
  // 3+ new words with >= 50% new barges in
  ok(isBargeIn('make a tiny blue frog', { words: ['make', 'a', 'tiny', 'blue', 'frog'], yours: ['make', 'tiny', 'frog'] }), '3+ new words >=50% barges in');
  // Pure hush detection
  ok(isPureHush('stop'), '"stop" is pure hush');
  ok(isPureHush('hey reverie stop talking!'), '"hey reverie stop talking!" is pure hush');
  ok(isPureHush('never mind.'), '"never mind." is pure hush');
  ok(!isPureHush('stop and make a cat'), 'hush + new request is NOT pure hush');
  // Adaptive endpointing delays
  ok(settleDelay('hit') === 320, 'snappy command "hit" -> 320 ms');
  ok(settleDelay('B3') === 320, 'snappy Battleships coord "B3" -> 320 ms');
  ok(settleDelay('make a dragon and') === 1100, 'trailing conjunction -> 1100 ms');
  ok(settleDelay('can you make um') === 1100, 'trailing hesitation "um" -> 1100 ms');
  ok(settleDelay('good morning') === 420, '2-word phrase -> 420 ms');
  ok(settleDelay('make a little ceramic teacup') === 580, 'normal sentence -> 580 ms');
  console.log('turn-taking: ok');
}

// 15. Smarter Memory (fuzzy/synonym recall, expanded records, JSON backup) & Fixture-Aware Placement
{
  const bag = new Map();
  const store = {
    get length() { return bag.size; },
    key: i => [...bag.keys()][i] ?? null,
    getItem: k => bag.get(k) ?? null,
    setItem: (k, v) => bag.set(k, String(v)),
    removeItem: k => bag.delete(k),
  };
  const mem = makeMemory({ store, clock: () => new Date('2026-11-27T12:00:00') });
  mem.remember({ fact: 'has a golden puppy called Biscuit', kind: 'people' });
  mem.remember({ fact: 'loves building Lego dinosaurs', kind: 'interests' });
  ok(/Biscuit/.test(mem.recall({ about: 'my dog' })), 'synonym recall ("dog" -> "puppy") finds Biscuit');
  ok(/dinosaurs/.test(mem.recall({ about: 'dinosar' })), '1-edit fuzzy recall ("dinosar" -> "dinosaurs") matches');
  mem.note('game_result', { game: 'battleships', result: 'won' });
  mem.note('game_result', { game: 'battleships', result: 'won' });
  mem.note('focus', { minutes: 25 });
  const sum = mem.summary();
  ok(/battleships: they won 2, you won 0/.test(sum), 'summary includes expanded battleships record');
  ok(/Focus sprints: 1 completed \(25 min total\)/.test(sum), 'summary includes focus sprint record');
  // Backup export & restore
  store.setItem('reverie.test.extra', 'hello');
  store.setItem('other.key', 'ignore-me');
  const snap = exportBackup(store);
  ok(snap.app === 'reverie' && snap.keys['reverie.test.extra'] === 'hello' && !snap.keys['other.key'], 'exportBackup snapshots only reverie.* keys');
  bag.clear();
  const res = importBackup(JSON.stringify(snap), store);
  ok(res.ok && res.restored >= 2 && store.getItem('reverie.test.extra') === 'hello', 'importBackup restores saved keys');
  mem.reload();
  ok(/Biscuit/.test(mem.summary()), 'memory.reload() reads restored diary');
  // Fixture-aware freePlace avoids desk aquarium/radio/lamp
  const aq = FIXTURES.find(f => f.name === 'aquarium');
  const p = freePlace('on the workbench', .12, []);
  ok(Math.hypot(p.x - aq.x, p.z - aq.z) > aq.r + .12, 'freePlace keeps desk props clear of aquarium');
  // Undo schema check
  const placeTool = TOOLS.find(t => t.name === 'place');
  const roomColTool = TOOLS.find(t => t.name === 'room_colours');
  ok(placeTool.input_schema.properties.spot.enum.includes('undo'), 'place tool supports undo');
  ok(roomColTool.input_schema.properties.undo?.type === 'boolean', 'room_colours tool supports undo');
  console.log('existing-systems: ok');
}

console.log(process.exitCode ? 'features: failed' : 'features: all passed');
