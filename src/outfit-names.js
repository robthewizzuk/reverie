// What Reverie can wear: every piece by name, the outfits (sets of pieces), which outfit goes with which character
// voice, and the seasons. Only names and words here, no engine: the server reads it for the wear tool's description
// (server/persona.js), and the page (outfits.js) builds the pieces. Every piece is an original design made in code.

// slot: the part of it a piece goes on; a new piece on a slot replaces the old one
export const SLOTS = ['hat', 'eyes', 'ears', 'back', 'tail', 'hands', 'arm'];

export const PIECES = {
  tricorn:        { slot: 'hat', about: "a pirate's three-cornered hat with gold trim and a red feather" },
  eyepatch:       { slot: 'eyes', about: 'an eyepatch' },
  shell_tiara:    { slot: 'hat', about: 'a pearl tiara with a pink scallop shell and seaweed' },
  flat_cap:       { slot: 'hat', about: 'a tweed flat cap' },
  spectacles:     { slot: 'eyes', about: 'little round gold spectacles' },
  horns:          { slot: 'hat', about: 'two little red horns' },
  devil_tail:     { slot: 'tail', about: 'a red tail with a pointy tip' },
  elf_ears:       { slot: 'ears', about: 'pointy elf ears' },
  leaf_cap:       { slot: 'hat', about: 'a green pointed cap with a leafy brim' },
  eye_stalks:     { slot: 'hat', about: 'two wobbly monster eyes on stalks' },
  dragon_spikes:  { slot: 'hat', about: 'a row of soft dragon spikes down your back' },
  dragon_wings:   { slot: 'back', about: 'small teal dragon wings' },
  ogre_ears:      { slot: 'ears', about: 'big round ogre ears' },
  wizard_hat:     { slot: 'hat', about: 'a tall floppy starry wizard hat' },
  wizard_cape:    { slot: 'back', about: 'a starry blue cape' },
  ice_crown:      { slot: 'hat', about: 'a crown of ice crystals' },
  ice_cape:       { slot: 'back', about: 'a frosty blue cape with a snowy collar' },
  knight_helmet:  { slot: 'hat', about: "a knight's steel helmet with a red plume" },
  shield:         { slot: 'arm', about: 'a blue shield with a gold star' },
  star_tiara:     { slot: 'hat', about: 'a silver tiara with a glowing star' },
  fairy_wings:    { slot: 'back', about: 'shimmery fairy wings' },
  santa_hat:      { slot: 'hat', about: 'a red Christmas hat with a fluffy trim, a pom-pom and holly' },
  mittens:        { slot: 'hands', about: 'red knitted mittens' },
  witch_hat:      { slot: 'hat', about: "a purple witch's hat with a buckle" },
  bat_wings:      { slot: 'back', about: 'little purple bat wings' },
  party_hat:      { slot: 'hat', about: 'a stripy party hat' },
  top_hat:        { slot: 'hat', about: 'a tiny top hat' },
  beanie:         { slot: 'hat', about: 'a knitted bobble hat' },
  crown:          { slot: 'hat', about: 'a gold crown with jewels' },
  royal_cape:     { slot: 'back', about: 'a red velvet cape with a white fur collar' },
  flower_crown:   { slot: 'hat', about: 'a crown of little flowers' },
  bow:            { slot: 'hat', about: 'a big satin bow' },
  sunglasses:     { slot: 'eyes', about: 'cool sunglasses' },
  headphones:     { slot: 'ears', about: 'headphones' },
};

// outfits: names for sets of pieces
export const OUTFITS = {
  pirate: ['tricorn', 'eyepatch'],
  sea_witch: ['shell_tiara'],
  grandad: ['flat_cap', 'spectacles'],
  demon: ['horns', 'devil_tail'],
  elf: ['leaf_cap', 'elf_ears'],
  monster: ['eye_stalks'],
  dragon: ['dragon_spikes', 'dragon_wings'],
  ogre: ['ogre_ears'],
  wizard: ['wizard_hat', 'wizard_cape'],
  snow_queen: ['ice_crown', 'ice_cape'],
  knight: ['knight_helmet', 'shield'],
  fairy: ['star_tiara', 'fairy_wings'],
  christmas: ['santa_hat', 'mittens'],
  halloween: ['witch_hat', 'bat_wings'],
  royal: ['crown', 'royal_cape'],
  party: ['party_hat'],
  cool: ['sunglasses', 'headphones'],
};

// the character voices (voices.js) and the outfit each one puts on
export const VOICE_OUTFITS = {
  captain_silas_blackwater: 'pirate', morwenna_of_the_deep: 'sea_witch', old_mortlake: 'grandad', azgorath: 'demon',
  fennick_the_young_elf: 'elf', the_thing_under_the_stairs: 'monster', vyrmathrax_the_ancient: 'dragon',
  grub_the_ogre: 'ogre', master_aldric: 'wizard', the_snow_queen: 'snow_queen', sir_bramwell: 'knight',
  fairy_godmother: 'fairy',
};

// seasons: an outfit it puts on by itself for a while each year, unless taken off (month 1-12, day)
export const SEASONS = [
  { name: 'christmas', outfit: 'christmas', from: [12, 1], to: [1, 6] },
  { name: 'halloween', outfit: 'halloween', from: [10, 24], to: [10, 31] },
];

/** The season on a date (a Date), with a key for the year it belongs to: { name, outfit, key } or null. */
export function seasonOn(d) {
  const md = (d.getMonth() + 1) * 100 + d.getDate();
  for (const s of SEASONS) {
    const a = s.from[0] * 100 + s.from[1], b = s.to[0] * 100 + s.to[1];
    const inIt = a <= b ? md >= a && md <= b : md >= a || md <= b;
    if (inIt) return { ...s, key: `${s.name}-${a > b && md <= b ? d.getFullYear() - 1 : d.getFullYear()}` };
  }
  return null;
}

// other words people use for pieces and outfits
const ALIASES = {
  pirate_hat: 'tricorn', tricorne: 'tricorn', three_cornered_hat: 'tricorn', eye_patch: 'eyepatch', patch: 'eyepatch',
  glasses: 'spectacles', specs: 'spectacles', shades: 'sunglasses', cap: 'flat_cap', tweed_cap: 'flat_cap',
  devil_horns: 'horns', tail: 'devil_tail', ears: 'elf_ears', pointy_ears: 'elf_ears', elf_hat: 'leaf_cap',
  monster_eyes: 'eye_stalks', antennae: 'eye_stalks', spikes: 'dragon_spikes', wings: 'fairy_wings',
  cape: 'wizard_cape', cloak: 'wizard_cape', helmet: 'knight_helmet', tiara: 'star_tiara',
  santa: 'santa_hat', christmas_hat: 'santa_hat', father_christmas_hat: 'santa_hat', gloves: 'mittens',
  witch: 'witch_hat', bobble_hat: 'beanie', woolly_hat: 'beanie', wooly_hat: 'beanie', bobble: 'beanie',
  king: 'royal', queen: 'royal', flowers: 'flower_crown', daisy_chain: 'flower_crown', ribbon: 'bow',
  party_hat: 'party_hat', birthday_hat: 'party_hat', xmas: 'christmas', festive: 'christmas', spooky: 'halloween',
  shell: 'shell_tiara', ice_queen: 'snow_queen', grandpa: 'grandad', old_man: 'grandad', fairy_godmother: 'fairy',
};

const key = s => String(s ?? '').trim().toLowerCase().replace(/^(a|an|the|my|your|some)\s+/, '').replace(/['’]s\b/g, '').replace(/[\s-]+/g, '_');

/** What some words name: { pieces: [...] } (an outfit is its pieces) or null. */
export function resolve(words) {
  let k = key(words);
  const tries = [k, k.replace(/_?(outfit|costume|set|look)$/, ''), k.replace(/s$/, ''), k + 's'];
  for (const t of tries) {
    const n = ALIASES[t] || t;
    if (PIECES[n]) return { pieces: [n] };
    if (OUTFITS[n]) return { pieces: [...OUTFITS[n]], outfit: n };
  }
  return null;
}

/** A piece's name for people: "flat cap". */
export const said = p => p.replace(/_/g, ' ');

/** The pieces and outfits as a few lines for Claude's tool description. */
export function wardrobe() {
  const bySlot = SLOTS.map(s => `${s}: ${Object.keys(PIECES).filter(p => PIECES[p].slot === s).join(', ')}`);
  const outfits = Object.entries(OUTFITS).map(([n, ps]) => `${n} (${ps.join(' + ')})`).join(', ');
  return `Pieces, by where they go:\n${bySlot.join('\n')}\nOutfits: ${outfits}`;
}
