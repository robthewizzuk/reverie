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

// 7. Persona prompt & tool checks
{
  const diaryCount = (SYSTEM.match(/^Your diary:/gm) || []).length;
  ok(diaryCount === 1, `expected 1 "Your diary:" section in SYSTEM, found ${diaryCount}`);
  const names = new Set(TOOLS.map(t => t.name));
  for (const req of ['play', 'aquarium', 'capsule', 'story', 'jam']) ok(names.has(req), `tool ${req} registered`);
  const playTool = TOOLS.find(t => t.name === 'play');
  ok(playTool.input_schema.properties.game.enum.includes('cards') && playTool.input_schema.properties.game.enum.includes('words'), 'play tool includes cards and words');
  console.log('persona: ok');
}

console.log(process.exitCode ? 'features: failed' : 'features: all passed');
