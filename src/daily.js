// Reverie's day: a surprise waiting on the first visit of each day (a little thing it made overnight, in its hands
// when you arrive, and a fact, riddle, word scramble or trivia question of the day), and a short daily briefing it
// gives out loud: the day, the weather and the sky, one thing from its diary, and the surprise. The surprise is picked
// from the date, so the same day gives the same one on every visit. Claude says it all in its own words; everything
// it is told comes from the device (the weather from Open-Meteo, the sun and moon from gs.real, the trivia question
// from the engine's bank).
import gs, { loadParts } from '../engine/src/gamescroll.js';
import { dayOf, daysBetween, prettyDay } from './memory.js';
import { placeAt } from './place.js';

/** Things it might have made overnight (short words the generator knows). */
export const BUILDS = [
  'a tiny lighthouse', 'a little rocket', 'a wooden robot', 'a teapot made of candy', 'a small hot air balloon', 'a toy sailing boat',
  'a golden crown', 'a little cactus in a pot', 'a pirate ship', 'a cuckoo clock', 'a lego car', 'a glass snow globe', 'a tiny castle',
  'a red mushroom', 'a little windmill', 'a toy train', 'a cupcake', 'a treasure chest', 'a little dragon', 'a paper crane',
  'a pumpkin', 'a toy biplane', 'a jelly cube', 'a tiny piano', 'a crystal', 'a garden gnome', 'a little submarine', 'a birthday cake',
  'a wooden duck', 'a magic lamp', 'a toy telescope', 'a little owl',
];

/** Fun facts, true and checked, kid-friendly. */
export const FACTS = [
  'Octopuses have three hearts, and their blood is blue.',
  'Honey never goes off: pots thousands of years old have been found still good to eat.',
  'A day on Venus is longer than its year.',
  'Bananas are berries, but strawberries are not.',
  'Sea otters hold hands while they sleep so they do not drift apart.',
  'There are more possible games of chess than atoms in the known universe.',
  'A group of flamingos is called a flamboyance.',
  'Wombats do cube-shaped poos.',
  'The Eiffel Tower grows about fifteen centimetres taller in summer, as the metal warms up.',
  'Cows have best friends, and get stressed when they are apart.',
  'Light from the Sun takes about eight minutes to reach us.',
  'A teaspoon of a neutron star would weigh about as much as a mountain.',
  'Sloths can hold their breath longer than dolphins can.',
  'Butterflies taste with their feet.',
  'The heart of a blue whale is about the size of a small car.',
  'Some turtles can breathe through their bottoms.',
  'Snails can sleep for up to three years.',
  'Your nose can tell apart at least a trillion different smells.',
  'Hot water can freeze faster than cold water. It is called the Mpemba effect.',
  'A bolt of lightning is about five times hotter than the surface of the Sun.',
  'Penguins propose with a pebble.',
  'Jupiter has about a hundred moons.',
  'Koalas sleep up to twenty two hours a day.',
  'An astronaut gets a few centimetres taller in space.',
  'The shortest war in history lasted under an hour.',
  'Crows can recognise human faces, and remember them for years.',
  'Bees can recognise faces too, a little like we do.',
  'The dot over a lowercase i or j is called a tittle.',
  'Some cats are allergic to people.',
  'There is enough gold inside the Earth to coat the whole surface knee-deep.',
  'A cloud can weigh more than a hundred elephants.',
  'Tardigrades can survive in outer space.',
];

/** Riddles, with their answers. */
export const RIDDLES = [
  ['What has keys but cannot open locks?', 'a piano'],
  ['What gets wetter the more it dries?', 'a towel'],
  ['What has a neck but no head?', 'a bottle'],
  ['What can you catch but not throw?', 'a cold'],
  ['What has hands but cannot clap?', 'a clock'],
  ['What goes up but never comes down?', 'your age'],
  ['What has many teeth but cannot bite?', 'a comb'],
  ['The more you take, the more you leave behind. What are they?', 'footsteps'],
  ['What is full of holes but still holds water?', 'a sponge'],
  ['What has one eye but cannot see?', 'a needle'],
  ['What runs but never walks, and has a bed but never sleeps?', 'a river'],
  ['What can travel around the world while staying in a corner?', 'a stamp'],
  ['What has a thumb and four fingers but is not alive?', 'a glove'],
  ['What building has the most stories?', 'a library'],
  ['What belongs to you, but other people use it more than you do?', 'your name'],
  ['What comes once in a minute, twice in a moment, and never in a thousand years?', 'the letter m'],
  ['I am tall when I am young and short when I am old. What am I?', 'a candle'],
  ['What has a face and two hands but no arms or legs?', 'a clock'],
  ['What can you break, even if you never pick it up or touch it?', 'a promise'],
  ['What month of the year has twenty eight days?', 'all of them'],
  ['What is always in front of you but cannot be seen?', 'the future'],
  ['What kind of band never plays music?', 'a rubber band'],
];

/** Words for the daily scramble: friendly, six to eight letters. */
export const SCRAMBLES = [
  'planet', 'rocket', 'dragon', 'pirate', 'castle', 'window', 'garden', 'jungle', 'kitten', 'puzzle', 'wizard', 'cookie', 'rainbow',
  'penguin', 'volcano', 'blanket', 'giraffe', 'pancake', 'teapot', 'balloon', 'library', 'dolphin', 'thunder', 'lantern', 'sandwich',
  'treasure', 'mushroom', 'dinosaur', 'snowman', 'monster', 'chimney', 'pumpkin',
];

/** Fun days, by MM-DD. */
const DAYS = {
  '01-01': "New Year's Day", '02-14': "Valentine's Day", '03-14': 'Pi Day (3.14)', '04-01': "April Fools' Day", '04-22': 'Earth Day',
  '06-21': 'about the longest day of the year in the north', '07-20': 'the day people first walked on the Moon, in 1969',
  '09-19': 'Talk Like a Pirate Day', '10-31': 'Halloween', '11-13': 'World Kindness Day', '12-21': 'about the shortest day of the year in the north',
  '12-24': 'Christmas Eve', '12-25': 'Christmas Day', '12-31': "New Year's Eve",
};

/** A number from a day and a name, the same every time (so a day's surprise doesn't change between visits). */
function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const pick = (list, day, salt) => list[hash(day + salt) % list.length];

/** The word scrambled: its letters shuffled from the day, never left as the word itself. */
export function scrambled(word, day) {
  const a = [...word.toUpperCase()]; let h = hash(day + word);
  for (let tries = 0; tries < 6; tries++) {
    for (let i = a.length - 1; i > 0; i--) { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; const j = h % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    if (a.join('') !== word.toUpperCase()) break;
  }
  return a.join(' ');
}

/** Today's trivia question from the engine's bank (gs.trivia), with its answer: { q, choices, a } or null. */
async function triviaFor(day) {
  try {
    await loadParts(['trivia']);
    let quiz = null;
    for (let i = 0; i < 20; i++) { try { quiz = new gs.trivia.Quiz({ difficulty: 'easy', kind: 'choice', seed: hash(day + 'trivia') }); break; } catch (e) { if (!e?.kitLoading) throw e; await e.kitLoading; } }
    const q = quiz?.next(); if (!q) return null;
    const { correct } = quiz.answer(0);
    return { q: q.text, choices: q.answers, a: q.answers[correct] };
  } catch { return null; }
}

/** The day's surprise: { build, kind, text (for Claude), show (a line for the diary) }. Same day, same surprise. */
export async function surpriseFor(day = dayOf()) {
  const build = pick(BUILDS, day, 'build');
  const kinds = ['fact', 'riddle', 'scramble', 'trivia'], kind = kinds[hash(day + 'kind') % kinds.length];
  if (kind === 'riddle') {
    const [q, a] = pick(RIDDLES, day, 'riddle');
    return { build, kind, show: `a riddle: ${q}`, text: `Today's puzzle is a riddle: "${q}" (the answer is ${a}: don't give it away; let them guess, give a hint if they're stuck, and tell them if they give up).` };
  }
  if (kind === 'scramble') {
    const w = pick(SCRAMBLES, day, 'word');
    return { build, kind, show: `a word scramble: ${scrambled(w, day)}`, text: `Today's puzzle is a word scramble: the letters ${scrambled(w, day)} (spell them out slowly, letter by letter). The answer is "${w}": don't give it away; let them guess, give its first letter as a hint if they're stuck.` };
  }
  if (kind === 'trivia') {
    const t = await triviaFor(day);
    if (t) return { build, kind, show: `a question: ${t.q}`, text: `Today's puzzle is a trivia question: "${t.q}" Choices: ${t.choices.join(', ')}. (The answer is ${t.a}: don't give it away until they've had a guess.)` };
  }
  const f = pick(FACTS, day, 'fact');
  return { build, kind: 'fact', show: `a fact: ${f}`, text: `Today's surprise fact: ${f} Tell it with wonder, in your own words.` };
}

/** What's special about today: their birthday, the day you met, a streak, a fun day. A list of short phrases. */
export function specialToday(memory, now = new Date()) {
  const d = dayOf(now), md = d.slice(5), v = memory.visits, out = [];
  if (memory.birthdayToday()) out.push(`it is their BIRTHDAY today: make a big fuss, sing a line of happy birthday`);
  const years = v.first ? Math.round(daysBetween(v.first, d) / 365) : 0;
  if (v.first && v.first !== d && v.first.slice(5) === md) out.push(`it is exactly ${years} year${years > 1 ? 's' : ''} since you first met`);
  else if (v.first) { const n = daysBetween(v.first, d); if ([7, 30, 50, 100, 200, 365].includes(n)) out.push(`you met ${n} days ago today`); }
  if ([3, 5, 7, 10, 14, 21, 30, 50, 100].includes(v.streak)) out.push(`they have visited ${v.streak} days in a row: cheer them on`);
  if (DAYS[md]) out.push(`it is ${DAYS[md]}`);
  return out;
}

const sky = now => {
  const bits = [];
  try {
    const sun = gs.real.sun(placeAt(), now), moon = gs.real.moon(placeAt(), now);
    const hhmm = h => h == null ? null : `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
    if (sun.rise != null && sun.set != null) bits.push(`the sun rises at ${hhmm(sun.rise)} and sets at ${hhmm(sun.set)}`);
    bits.push(`the moon is ${moon.name === 'full' ? 'full' : moon.name === 'new' ? 'new (none to see)' : `a ${moon.name}`}`);
  } catch { /* no sky: fine */ }
  return bits.join(', and ');
};

/**
 * The note Claude gets for a briefing: the day, what's special, the weather (if known), the sky, the diary and the
 * surprise, with how to say it. o: { weather: text or null, surprise, firstToday, holding (what it's holding) }
 */
export function briefingNote(memory, o = {}) {
  const now = o.now || new Date(), p = o.visit || memory.peek();
  const when = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const hour = now.getHours(), part = hour < 5 ? 'the middle of the night' : hour < 12 ? 'the morning' : hour < 17 ? 'the afternoon' : hour < 21 ? 'the evening' : 'late at night';
  const lines = [];
  lines.push(o.firstToday
    ? `[A new day, from the device, not said aloud: they just arrived for the first time today, ${when}, in ${part}${p.away > 1 ? `, ${p.away} days since their last visit` : p.away === 1 ? ', and they were here yesterday too' : ''}.`
    : `[Their daily briefing, from the device, not said aloud: it is ${when}, ${part}.`);
  const special = specialToday(memory, now); if (special.length) lines.push(`Special today: ${special.join('; ')}.`);
  if (o.weather) lines.push(`The weather: ${o.weather}`);
  const s = sky(now); if (s) lines.push(`The sky: ${s}.`);
  if (o.surprise) {
    if (o.firstToday && o.holding) lines.push(`Your surprise: you made ${o.holding} for them overnight, and it is in your hands now: show it off proudly (say you made it while they were away).`);
    lines.push(o.surprise.text);
  }
  lines.push(`Give them a short, playful daily briefing out loud, like a cheerful little morning show: ${o.firstToday ? 'a warm hello (by name if you know it), ' : ''}the weather and the sky in a few words, one thing from your diary if there is something nice (last time, a record, a thing you made), then the surprise. 4 to 6 short spoken sentences in all, no lists. Don't call the weather or briefing tools for this.]`);
  return lines.join(' ');
}

/** Today's fun day (for the diary sheet), or ''. */
export const funDay = (now = new Date()) => DAYS[dayOf(now).slice(5)] || '';
export { prettyDay };
