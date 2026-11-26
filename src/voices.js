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
export const EFFECTS = ['none', 'robot', 'tiny', 'radio', 'phone', 'megaphone', 'tannoy', 'box', 'warm', 'bright'];

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

