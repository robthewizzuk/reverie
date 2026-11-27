// Songs to sing: words set to a tune, and the band to play under them. Two kinds:
// - written: an original song from its words, its mood and a seed. The band is the engine's composer
//   (gs.sound.compose: sections, chords led smoothly, a style's own instruments and fills), and the tune Reverie sings
//   is written here over its chords, a note a syllable: on chord tones on the beat and by step between, lower in the
//   verses, higher in the chorus, the same tune for the same line shape so a chorus is a hook, every section's last
//   line home on the key note.
// - fixed: an old song with its own tune (public domain: Twinkle Twinkle, Happy Birthday), its chords written out,
//   and a simple band made here for them.
// Either way plan() returns the same thing: the band's music() options, and every line with the time it starts, its
// notes (as gs.sound.say({ sing }) takes them) and its syllables timed, to light up as they are sung.
// (the composer and the syllable counter straight from their kits, so this also runs outside the page: tests/karaoke.mjs)
import { compose } from '../engine/src/kit/compose.js';
import { syllables } from '../engine/src/kit/sing.js';

const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10], 'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
};
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = m => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const midiOf = name => { const m = /^([A-G][#b]?)(-?\d)$/.exec(name); return m ? PC[m[1]] + 12 * (+m[2] + 1) : NaN; };

/** A small seeded random number source. */
function rng(seed) {
  let h = 2166136261; for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let s = h >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/**
 * Where the syllables of a line fall: [{ at, len }] in half beats from the line's start, over `room` half beats.
 * The last syllable is held (at least a beat); the others are eighths, some lengthened to quarters where they land on
 * a beat, as many as the room allows; a long line gets sixteenths. pickup: start half a beat late.
 */
export function rhythm(S, room, { pickup = false, end = 1 } = {}) {
  if (S <= 0) return [];
  const start = pickup ? 1 : 0, last = Math.max(2, Math.min(6, room - start - (S - 1) - end));
  const avail = room - start - last - end;   // half beats for the syllables before the last
  let lens = Array(S - 1).fill(1);
  if (S - 1 > avail) {   // too many: sixteenths, from the end of the line back
    lens = Array(S - 1).fill(.5); let spare = avail - (S - 1) * .5;
    for (let i = 0; i < lens.length && spare >= .5; i++) { lens[i] = 1; spare -= .5; }
  } else {
    let spare = avail - (S - 1);
    // quarters where a syllable lands on a beat, from the start, until a little room is left for the held note
    for (let pass = 0; pass < 2 && spare > 0; pass++) {
      let at = start;
      for (let i = 0; i < lens.length && spare > 0; i++) {
        if ((at % 2 === 0) === (pass === 0) && lens[i] === 1 && spare >= 1 && i % 3 !== 2) { lens[i] = 2; spare -= 1; }
        at += lens[i];
      }
    }
  }
  const out = []; let at = start;
  for (const l of lens) { out.push({ at, len: l }); at += l; }
  out.push({ at, len: Math.max(2, room - end - at) });
  return out;
}

/**
 * A tune for one line: midi notes for each place in `beats` (rhythm()), over chordAt(halfBeat) -> scale degree of the
 * chord (0-based), in a scale (semitone steps), with its key note at `root`. shape: 'rise' | 'fall' | 'arch' | 'dip';
 * centre: the scale degree it sits round; home: end on the key note.
 */
export function melody(beats, { chordAt, scale, root, centre = 2, span = 3, shape = 'arch', home = false, seed = 1 }) {
  const r = rng(seed), n = beats.length, deg = d => root + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  const curve = x => shape === 'rise' ? x * 1.2 - .3 : shape === 'fall' ? .7 - x * 1.1 : shape === 'dip' ? Math.cos(Math.PI * 2 * x) * .5 : Math.sin(Math.PI * x) - .15;
  const out = []; let prev = null;
  for (let i = 0; i < n; i++) {
    const b = beats[i], x = n > 1 ? i / (n - 1) : .5, c = chordAt(b.at);
    let want = centre + curve(x) * span + (r() - .5) * .8;
    const tones = [c, c + 2, c + 4];
    let d;
    if (i === n - 1) {   // the held end: a chord tone, home on the key note at a section's end
      d = home ? nearest([0, 7, -7], want) : nearestTone(tones, want);
    } else if (b.at % 2 === 0 || b.len >= 2) {   // on the beat: a chord tone
      d = nearestTone(tones, want);
    } else {   // between: a step from the last note toward where the line is going
      d = prev == null ? Math.round(want) : prev + Math.sign(Math.round(want) - prev || (r() < .5 ? 1 : -1));
    }
    if (prev != null && Math.abs(d - prev) > 4) { d = nearestTone(tones, prev + Math.sign(d - prev) * 2); if (Math.abs(d - prev) > 4) d = prev + Math.sign(d - prev) * 2; }
    // a repeated note now and then, but not three in a row
    if (prev != null && d === prev && out.length >= 2 && out[out.length - 2].d === d) d += want > d ? 1 : -1;
    d = Math.max(-3, Math.min(10, d));
    out.push({ d, midi: deg(d) }); prev = d;
  }
  return out.map(o => o.midi);
}
const nearest = (list, x) => list.reduce((a, b) => Math.abs(b - x) < Math.abs(a - x) ? b : a);
function nearestTone(tones, x) {
  const all = []; for (const t of tones) for (const o of [-14, -7, 0, 7, 14]) all.push(t + o);
  return nearest(all, x);
}

/** Its syllables and a note for each: { notes: [[midi, at s, len s] from the line's first note], syl: [{ text, at s, len s }] }. */
function sung(text, beats, midis, at0, half) {
  const syl = syllables(text), first = beats[0]?.at ?? 0, notes = [], times = [];
  for (let i = 0; i < beats.length; i++) {
    notes.push([midis[i], (beats[i].at - first) * half, beats[i].len * half * .96]);
    times.push({ text: syl[i]?.text ?? '', at: at0 + beats[i].at * half, len: beats[i].len * half });
  }
  return { notes, syl: times, start: at0 + first * half };
}

const SHAPES = { verse: ['arch', 'fall', 'rise', 'fall'], chorus: ['rise', 'arch', 'rise', 'fall'], last: ['rise', 'arch', 'rise', 'fall'], bridge: ['dip', 'rise', 'dip', 'arch'] };
const CENTRE = { verse: 2, chorus: 4.5, last: 4.5, bridge: 3 };

/**
 * An original song from its words: plan({ title, verse: [lines], chorus: [lines], verse2?, bridge?, mood, style, seed }).
 * Lines are said in two bars each; a section of eight bars has four. The verses take verse, then verse2 (or verse
 * again), choruses the chorus, the bridge the bridge (a bridge with no words is played, and Reverie dances).
 */
export function written({ title = 'A song', verse = [], chorus = [], verse2 = null, bridge = [], mood = 'happy', style = null, seed = null } = {}) {
  const clean = a => (Array.isArray(a) ? a : []).map(x => String(x || '').replace(/[.!?;:]+/g, ',').replace(/,\s*$/, '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8);
  verse = clean(verse); chorus = clean(chorus); bridge = clean(bridge); verse2 = verse2 ? clean(verse2) : null;
  if (!verse.length && !chorus.length) return null;
  if (!chorus.length) chorus = verse; if (!verse.length) verse = chorus;
  const tune = compose({ mood, style, seed: seed ?? title });
  const I = tune.info, B = I.steps, perBeat = I.beat, bpb = B / perBeat, stepSec = 60 / I.bpm / perBeat, half = stepSec * perBeat / 2;
  const scale = MODES[I.mode] || MODES.major, root = 60 + PC[I.key] - (PC[I.key] > 6 ? 12 : 0);
  const lines = [], verses = [verse, verse2 || verse]; let vi = 0;
  for (const s of I.sections) {
    if (s.kind === 'intro') continue;
    const words = s.kind === 'verse' ? verses[Math.min(1, vi++)] || verse : s.kind === 'bridge' ? bridge : chorus;
    if (!words.length) continue;
    const slots = Math.floor(s.bars / 2);
    for (let k = 0; k < slots; k++) {
      const text = words[k % words.length], bar = s.bar + k * 2, S = Math.max(1, syllables(text).length);
      const room = bpb * 2 * 2, pickup = k % 2 === 1 && S < room - 6;
      const beats = rhythm(S, room, { pickup, end: k === slots - 1 ? 0 : 1 });
      const chordAt = hb => I.chords[Math.min(I.chords.length - 1, bar + Math.floor(hb / (bpb * 2)))] - 1;
      const shift = s.kind === 'last' ? I.lift || 0 : 0;
      // the same shape of line in the same kind of section gets the same tune: a chorus comes back as itself
      const midis = melody(beats, { chordAt, scale, root: root + shift, centre: CENTRE[s.kind] ?? 3, shape: SHAPES[s.kind]?.[k % 4] || 'arch', home: k === slots - 1, seed: `${s.kind === 'last' ? 'chorus' : s.kind}|${k % 4}|${S}|${seed ?? title}` });
      lines.push({ text, kind: s.kind, ...sung(text, beats, midis, bar * B * stepSec, half), lead: { bar, beats, midis } });
    }
  }
  // the band: the composer's, with its tune taken out (Reverie sings it); the tune kept for a singer who wants a guide
  const total = I.bars * B;
  const guide = leadOf(lines, total, perBeat / 2, B);
  return { title, kind: 'written', mood: I.mood, style: I.style, key: I.key, mode: I.mode, bpm: I.bpm, stepSec, steps: total, lines,
    music: { ...tune, lead: rests(total), lead2: rests(total), loopFrom: 0, set: 'style' }, guide, info: I };
}
const rests = n => Array(n).fill('.').join(' ');
/** The tune as a music() part (a note name where each syllable starts, '-' while it is held). */
function leadOf(lines, total, stepsPerHalf, B) {
  const t = Array(total).fill('.');
  for (const l of lines) {
    const s0 = l.lead.bar * B;
    l.lead.beats.forEach((b, i) => {
      const at = Math.round(s0 + b.at * stepsPerHalf), len = Math.max(1, Math.round(b.len * stepsPerHalf));
      if (at >= total) return;
      t[at] = noteName(l.lead.midis[i] + 12 * (l.lead.midis[i] < 60 ? 1 : 0));
      for (let k = 1; k < len && at + k < total; k++) t[at + k] = '-';
    });
  }
  return t.join(' ');
}

/**
 * An old song with its own tune: fixed({ title, bpm, beats (a bar), key, chords: [[beat, 'C' | 'Am' | 'G7'...]],
 * lines: [{ text, notes: [['G4', beat, beats], ...] }], swing, style: 'band' | 'waltz' }). Beats count from the start.
 */
export function fixed(def, { name = null } = {}) {
  const bpb = def.beats || 4, perBeat = 2, stepSec = 60 / def.bpm / perBeat, half = stepSec;
  let end = 0;
  const lines = def.lines.map(l => {
    const text = name ? l.text.replace('{name}', name) : l.text.replace(/\{name\}/g, 'friend');
    const notes = l.notes.map(([n, at, len]) => ({ midi: typeof n === 'number' ? n : midiOf(n), at, len }));
    end = Math.max(end, ...notes.map(n => n.at + n.len));
    const beats = notes.map(n => ({ at: n.at * 2, len: n.len * 2 })), first = beats[0].at;
    return { text, kind: l.kind || 'verse', ...sung(text, beats.map(b => ({ at: b.at - first, len: b.len })), notes.map(n => n.midi), first * half, half),
      lead: { bar: 0, beats, midis: notes.map(n => n.midi) } };
  });
  const bars = Math.ceil((end + .01) / bpb) + 1, total = bars * bpb * perBeat;
  const band = bandFor(def.chords, total, bpb, def.style);
  const guide = leadOf(lines, total, 1, bpb * perBeat);
  return { title: def.title, kind: 'fixed', bpm: def.bpm, stepSec, steps: total, lines, music: { tempo: def.bpm, swing: def.swing || 0, set: 'band', loopFrom: 0, ...band, lead: rests(total) }, guide };
}
const CHORD = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11] };
function chordNotes(name) {
  const m = /^([A-G][#b]?)(m7|maj7|m|7)?$/.exec(name) || [, 'C', ''];
  return { root: PC[m[1]], tones: CHORD[m[2] || ''] };
}
/** A simple band for written-out chords: bass on the strong beats, chords held, a soft beat (a waltz in threes). */
function bandFor(chords, total, bpb, style) {
  const bass = Array(total).fill('.'), pad = [0, 1, 2].map(() => Array(total).fill('.')), drums = Array(total).fill('.'), arp = Array(total).fill('.');
  const at = s => { let c = chords[0]; for (const x of chords) if (x[0] * 2 <= s) c = x; return c; };
  for (let s = 0; s < total; s++) {
    const c = at(s), { root, tones } = chordNotes(c[1]), inBar = s % (bpb * 2), beat = inBar / 2;
    const changed = s === 0 || at(s - 1) !== c;
    if (inBar === 0 || changed) for (let v = 0; v < 3; v++) pad[v][s] = noteName(60 + (root + tones[v]) % 12);
    else for (let v = 0; v < 3; v++) pad[v][s] = '-';
    if (inBar % 2 === 0 && (beat === 0 || (bpb === 4 && beat === 2) || changed)) bass[s] = noteName(36 + root + (beat === 2 && bpb === 4 ? 7 : 0));
    if (bpb === 3) drums[s] = beat === 0 && inBar % 2 === 0 ? 'k' : inBar % 2 === 0 ? 'h' : '.';
    else drums[s] = inBar % 4 === 0 ? (beat % 2 === 0 ? 'k' : 's') : 'h';
    if (inBar % 2 === 1) arp[s] = noteName(72 + ((root + tones[(inBar >> 1) % tones.length]) % 12));
  }
  return { bass: bass.join(' '), pad: pad[0].join(' '), pad2: pad[1].join(' '), pad3: pad[2].join(' '), drums: drums.join(' '), arp: arp.join(' ') };
}

/** How long a planned song lasts (seconds). */
export const lengthOf = song => song.steps * song.stepSec;
