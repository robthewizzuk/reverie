// The voices Reverie can be asked to speak in: the engine's built-in Phonon voices (engine/src/kit/talk-files.js: 90
// people speaking English in seven accents, and 12 characters). Read by the page (looks.js) and by the server (the
// voice tool's description in persona.js), so the names Claude is told about are exactly the ones that can be cast.
import { TALK_VOICES } from '../engine/src/kit/talk-files.js';

const ACCENTS = { 'en-GB': 'British', 'en-US': 'American', 'en-FR': 'French', 'en-DE': 'German', 'en-ES': 'Spanish', 'en-MX': 'Mexican', 'en-BR': 'Brazilian' };
// what the character voices are, for Claude (their names say most of it)
const CHARACTERS = {
  captain_silas_blackwater: 'a gruff pirate captain', morwenna_of_the_deep: 'a sea witch', old_mortlake: 'a creaky old man',
  azgorath: 'a huge deep demon', fennick_the_young_elf: 'a young elf', the_thing_under_the_stairs: 'a spooky monster',
  vyrmathrax_the_ancient: 'an ancient dragon', grub_the_ogre: 'a dim, friendly ogre', master_aldric: 'a wise old wizard',
  the_snow_queen: 'a cool, regal queen', sir_bramwell: 'a noble knight', fairy_godmother: 'a kind fairy godmother',
};
// The effects on its voice. The engine's own (engine/src/kit/voice-fx.js FX) by name, and Reverie's, as recipes of
// the same parts (voice-fx.js lists them: filters, a robot's ring, a metal tube's comb, slaps of echo...). Each line is
// shaped offline before it plays, and its mouth is read from the sound before the effect, so lip sync stays in time.
const ENGINE_FX = ['robot', 'tiny', 'radio', 'phone', 'megaphone', 'tannoy', 'box', 'warm', 'bright'];
export const FX_RECIPES = {
  alien: { low: 220, high: 6500, ring: [240, .5], comb: [.0032, .5, .45], peaks: [[2600, 4, 2]] },
  ghost: { low: 260, high: 5200, peaks: [[900, 3, 1]], echo: [[.19, .38], [.38, .24], [.57, .13]], mix: .9 },
  underwater: { high: 850, bass: 5, peaks: [[380, 6, 2]], comb: [.0085, .55, .5] },
  tin_can: { low: 380, high: 4200, peaks: [[1700, 7, 4]], comb: [.0024, .78, .7] },
  monster: { bass: 9, high: 5200, drive: .45, squeeze: .3 },
  old_record: { low: 480, high: 2600, peaks: [[1300, 4, 1.2]], drive: .3, hiss: .8, squeeze: .5 },
  walkie_talkie: { like: 'radio', low: 520, high: 2500, drive: .6, squelch: 1, hiss: .7 },
};
export const EFFECTS = ['none', ...ENGINE_FX, ...Object.keys(FX_RECIPES)];
/** What each effect sounds like, for Claude. */
export const EFFECT_ABOUT = {
  robot: 'a buzzing robot', tiny: 'a tiny tinny speaker', radio: 'a crackly radio', phone: 'on the telephone', megaphone: 'a megaphone',
  tannoy: 'a station announcement', box: 'from inside a box', warm: 'warm and close', bright: 'bright and crisp',
  alien: 'a wobbly alien', ghost: 'a spooky ghost with echoes', underwater: 'talking underwater', tin_can: 'through a tin can',
  monster: 'a growly monster (pair with a big size)', old_record: 'an old crackly record', walkie_talkie: 'a walkie-talkie',
};
/** The fx option for gs.sound.say: an engine name, a recipe, or null for none. */
export const fxFor = effect => !effect || effect === 'none' ? null : FX_RECIPES[effect] || (ENGINE_FX.includes(effect) ? effect : null);

// The echo of the room it talks in, through the engine's mixer (gs.sound.mixer.place): its voice and the room's sounds
// ring in it (the music doesn't). tail: seconds it rings; wet: how much; echo/delay: a slap back off far walls.
export const ECHOES = {
  none: null,
  bathroom: { tail: .8, wet: .38 },
  hall: { tail: 2.4, wet: .42 },
  cathedral: { tail: 4.2, wet: .5 },
  cave: { tail: 3, wet: .45, echo: .32, delay: .33 },
  tunnel: { tail: 1.3, wet: .35, echo: .38, delay: .12 },
  canyon: { tail: 1.8, wet: .22, echo: .5, delay: .62 },
};

/** Every voice by name: { name, kind: 'woman' | 'man' | 'character', accent, about }. */
export const VOICES = TALK_VOICES.map(v => ({
  name: v.name, kind: v.kind, accent: ACCENTS[v.lang] || '',
  about: v.kind === 'character' ? CHARACTERS[v.name] || 'a character' : `${ACCENTS[v.lang]} ${v.kind}`,
}));
export const byName = new Map(VOICES.map(v => [v.name, v]));

/** The voices as a few lines for Claude's tool description: grouped by accent and kind. */
export function voiceCatalogue() {
  const lines = [];
  for (const accent of Object.values(ACCENTS)) for (const kind of ['woman', 'man']) {
    const names = VOICES.filter(v => v.accent === accent && v.kind === kind).map(v => v.name);
    if (names.length) lines.push(`${accent} ${kind === 'woman' ? 'women' : 'men'}: ${names.join(', ')}`);
  }
  lines.push('Characters: ' + VOICES.filter(v => v.kind === 'character').map(v => `${v.name} (${v.about})`).join(', '));
  return lines.join('\n');
}

