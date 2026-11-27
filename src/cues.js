// Sound effects Reverie can drop into what it says, like a comedian's drummer: "And the winner is [drumroll] you! [tada]".
// A cue is a name in square brackets in its words; the speaker (brain.js) plays it at that point, in turn with the
// sentences around it, and waits for it before going on. Read by the page (sounds.js plays them) and by the server
// (the list Claude is told about in persona.js), so the names Claude knows are exactly the ones that play.
// [hmm], [laugh], [sigh] and [gasp] are not cues: the voice says those itself.

/** Every cue: what it is, for Claude. */
export const CUES = {
  drumroll: 'a drum roll that ends in a crash (before a big reveal)',
  rimshot: 'ba dum tss, after a joke or a pun',
  tada: 'a bright ta-da',
  fanfare: 'a royal trumpet fanfare',
  applause: 'a crowd clapping',
  sad_trombone: 'wah wah wah waaah, for a flop',
  boing: 'a cartoon spring',
  whoosh: 'something zooming past',
  pop: 'a pop',
  ding: 'a bell ding (a right answer, an idea)',
  buzzer: 'a wrong-answer buzzer',
  gong: 'a big gong',
  magic: 'a sparkly magic shimmer',
  slide_up: 'a slide whistle going up',
  slide_down: 'a slide whistle falling',
  honk: 'a clown horn',
  crickets: 'crickets chirping in an awkward silence',
  heartbeat: 'a heartbeat (suspense, or love)',
  spooky: 'a spooky ghostly wail',
  thunder: 'a thunder clap',
  splat: 'a squishy splat',
  gulp: 'a nervous gulp',
  level_up: 'a video game level up',
  cash: 'a till ka-ching',
  zap: 'a zap',
};

// other ways to write them ("ba dum tss", "drum roll", "sad trombone")
const ALIASES = { drum_roll: 'drumroll', ba_dum_tss: 'rimshot', badum_tss: 'rimshot', ba_dum_tsss: 'rimshot', ta_da: 'tada', clapping: 'applause', claps: 'applause',
  wah_wah: 'sad_trombone', trombone: 'sad_trombone', bell: 'ding', sparkle: 'magic', twinkle: 'magic', cricket: 'crickets', heart_beat: 'heartbeat',
  ghost: 'spooky', squish: 'splat', levelup: 'level_up', ka_ching: 'cash', kaching: 'cash', horn: 'honk', slide_whistle: 'slide_up', spring: 'boing' };

/** A name as Claude might write it ("Drum roll", "ba-dum-tss") to its cue, or null. */
export function cueOf(name) {
  const k = String(name || '').trim().toLowerCase().replace(/^(sfx|sound|sound effect)\s*:\s*/, '').replace(/[\s-]+/g, '_').replace(/[^a-z_]/g, '');
  return k in CUES ? k : ALIASES[k] || null;
}

/**
 * A line split at its cues, in order: strings to say and { cue } to play. Brackets that are not cues stay in the text
 * (the speaker strips them, and keeps [laugh] and the like for the voice).
 */
export function splitCues(line) {
  const out = []; let at = 0;
  for (const m of String(line).matchAll(/\[([^\]\n]{1,30})\]/g)) {
    const cue = cueOf(m[1]); if (!cue) continue;
    const before = line.slice(at, m.index).trim(); if (before) out.push(before);
    out.push({ cue }); at = m.index + m[0].length;
  }
  const rest = String(line).slice(at).trim(); if (rest) out.push(rest);
  return out;
}

/** The cues as one line for Claude. */
export const cueCatalogue = () => Object.entries(CUES).map(([k, v]) => `[${k}] ${v}`).join(', ');
