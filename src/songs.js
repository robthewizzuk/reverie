// The songs Reverie knows. Its own (words written for it, tunes written by tune.js over the composer's band), and two
// old ones whose words and tunes are free to sing (public domain: Twinkle Twinkle Little Star, from the 1800s, and
// Happy Birthday to You, public domain in the US since 2016). Claude can write a new one any time (the karaoke tool's
// words), and Rob's own song lyrics come in as LRC files (lyrics.js), never fetched from the web.

/** Its own songs: words, a mood and a style for the band. */
export const OWN = {
  'little glow': {
    title: 'Little Glow', mood: 'happy', style: 'pop',
    verse: ['I woke up in my workshop', 'With a spark inside my chest', 'I made a teapot out of nothing', 'And I gave it all my best'],
    verse2: ['You came by to say hello', 'And the whole room lit up gold', 'We built a castle on the carpet', 'Out of stories we were told'],
    chorus: ['Little glow, little glow', 'Shining brighter when you smile', "Everywhere that I'm going", "I'll be glowing for a while"],
    bridge: ['When the night is dark and quiet', 'I will hum a little tune'],
  },
  'rainy day workshop': {
    title: 'Rainy Day Workshop', mood: 'calm', style: 'lofi',
    verse: ['Raindrops tapping on the window', 'Kettle singing on the stove', 'Paper boats along the shelf', 'Sailing nowhere slow'],
    verse2: ['Pencil shavings on the table', 'Blanket fort beside the chair', 'Every grey and sleepy hour', 'Has a story there'],
    chorus: ['Stay a while, stay a while', 'In the rainy day workshop', 'We can make a world inside', 'Till the raindrops stop'],
  },
  'robot disco': {
    title: 'Robot Disco', mood: 'groovy', style: 'disco',
    verse: ['Beep beep goes the toaster', 'Whirr whirr goes the fan', 'All the gadgets in the kitchen', 'Started dancing as a band'],
    verse2: ['The kettle does the moonwalk', 'The blender spins around', 'The fridge is doing robot arms', 'And shaking up the ground'],
    chorus: ['Robot disco, robot disco', 'Flashing lights from head to toe', 'Robot disco, robot disco', 'Everybody steal the show'],
    bridge: ['Bleep, bloop, beep', 'Bleep, bloop, beep'],
  },
  'sleepy moon': {
    title: 'Sleepy Moon', mood: 'dreamy', style: 'waltz',
    verse: ['Sleepy moon above the chimney', 'Yawning softly at the stars', 'Counting sheep across the garden', 'Hopping over parked-up cars'],
    chorus: ['Goodnight, goodnight', 'Close your eyes and drift away', 'I will keep the lamp on low', 'Till another day'],
  },
};

/** Old songs with their own tunes (public domain). Beats from the start of the song; a pickup before the first bar. */
export const FIXED = {
  'twinkle twinkle': {
    title: 'Twinkle Twinkle Little Star', bpm: 92, beats: 4,
    // (a chord a half bar: each line two bars, the first and second shapes of the tune twice over)
    chords: [[0, 'C'], [6, 'G'], ...[[8, 1], [16, 2], [24, 3], [32, 3], [40, 1], [48, 2]].flatMap(([at, k]) =>
      (k === 1 ? ['C', 'C', 'F', 'C'] : k === 2 ? ['F', 'C', 'G', 'C'] : ['C', 'F', 'C', 'G']).map((c, i) => [at + i * 2, c]))],
    lines: [
      ['Twinkle twinkle little star', 8, ['C4', 'C4', 'G4', 'G4', 'A4', 'A4', 'G4']],
      ['How I wonder what you are', 16, ['F4', 'F4', 'E4', 'E4', 'D4', 'D4', 'C4']],
      ['Up above the world so high', 24, ['G4', 'G4', 'F4', 'F4', 'E4', 'E4', 'D4']],
      ['Like a diamond in the sky', 32, ['G4', 'G4', 'F4', 'F4', 'E4', 'E4', 'D4']],
      ['Twinkle twinkle little star', 40, ['C4', 'C4', 'G4', 'G4', 'A4', 'A4', 'G4'], 'chorus'],
      ['How I wonder what you are', 48, ['F4', 'F4', 'E4', 'E4', 'D4', 'D4', 'C4'], 'chorus'],
    ].map(([text, at, ns, kind]) => ({ text, kind, notes: ns.map((n, i) => [n, at + i, i === 6 ? 2 : .95]) })),
  },
  'happy birthday': {
    title: 'Happy Birthday', bpm: 104, beats: 3,
    chords: [[0, 'C'], [6, 'C'], [9, 'G'], [12, 'G'], [15, 'C'], [18, 'C'], [21, 'F'], [24, 'C'], [26, 'G'], [27, 'C']],
    lines: [
      { text: 'Happy birthday to you', notes: [['G4', 5, .7], ['G4', 5.75, .25], ['A4', 6, .95], ['G4', 7, .95], ['C5', 8, .95], ['B4', 9, 1.8]] },
      { text: 'Happy birthday to you', notes: [['G4', 11, .7], ['G4', 11.75, .25], ['A4', 12, .95], ['G4', 13, .95], ['D5', 14, .95], ['C5', 15, 1.8]] },
      { text: 'Happy birthday dear {name}', notes: [['G4', 17, .7], ['G4', 17.75, .25], ['G5', 18, .95], ['E5', 19, .95], ['C5', 20, .95], ['B4', 21, .95], ['A4', 22, .9]] },
      { text: 'Happy birthday to you', kind: 'chorus', notes: [['F5', 23, .7], ['F5', 23.75, .25], ['E5', 24, .95], ['C5', 25, .95], ['D5', 26, .95], ['C5', 27, 2.6]] },
    ],
  },
};

const key = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
/** The song a name means, or null: { own } or { fixed }. */
export function songNamed(name) {
  const k = key(name);
  if (!k) return null;
  for (const [id, s] of Object.entries(OWN)) if (k === id || k === key(s.title) || key(s.title).includes(k) || k.includes(id)) return { id, own: s };
  for (const [id, s] of Object.entries(FIXED)) if (k === id || k === key(s.title) || key(s.title).includes(k) || k.includes(id) || (id === 'happy birthday' && /birthday/.test(k)) || (id === 'twinkle twinkle' && /twinkle/.test(k))) return { id, fixed: s };
  return null;
}
/** The songs, for Claude: "Little Glow (happy pop), ...". */
export const songList = () => [...Object.values(OWN).map(s => `${s.title} (${s.mood} ${s.style}, your own)`), ...Object.values(FIXED).map(s => `${s.title} (an old one)`)].join(', ');
