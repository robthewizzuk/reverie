// Twenty Questions: Reverie thinks of something and you find out what with yes-or-no questions. A mystery box sits on
// the table with twenty little lamps in front of it, one going dark for each question. Guess it and the box bursts
// open and the thing appears in Reverie's hands, made by the 3D generator; run out and it shows you what it was.
//
// Who does what: the engine picks the secret (from things the generator makes well), counts the questions and checks
// the guesses, so the count and the win are never in doubt. Reverie answers each question truthfully, in its own words,
// knowing the secret from the line sent with what you say.
//
// A game here is an object the stage drives (see ./index.js for the shape every game has). heard(text) is called
// with everything the person says while it's on, before Claude hears it.
import gs from '../../engine/src/gamescroll.js';
import { table, clock, popIn, ease, words } from './parts.js';

const QUESTIONS = 20;
const TABLE_H = .3;
const CENTRE = { x: 0, z: .6 };
export const CAMERA = { pos: [0, 1.0, 1.5], look: [0, .38, .4] };

// what it might be thinking of: [name, kind, other names people use]. Level 1 sticks to the first, easiest things.
const THINGS = [
  ['cat', 'an animal'], ['dog', 'an animal', 'puppy'], ['fish', 'an animal'], ['duck', 'an animal'], ['cow', 'an animal'], ['pig', 'an animal', 'piggy'],
  ['rabbit', 'an animal', 'bunny'], ['horse', 'an animal', 'pony'], ['elephant', 'an animal'], ['giraffe', 'an animal'], ['lion', 'an animal'], ['frog', 'an animal'],
  ['penguin', 'an animal'], ['owl', 'an animal'], ['snail', 'an animal'], ['bee', 'an animal', 'bumblebee'], ['butterfly', 'an animal'], ['octopus', 'an animal'],
  ['shark', 'an animal'], ['whale', 'an animal'], ['crab', 'an animal'], ['snake', 'an animal'], ['dragon', 'a creature from stories'], ['mermaid', 'a creature from stories'],
  ['apple', 'a food'], ['banana', 'a food'], ['pizza', 'a food'], ['cake', 'a food', 'birthday cake'], ['ice cream', 'a food', 'ice cream cone'], ['carrot', 'a food'],
  ['strawberry', 'a food'], ['donut', 'a food', 'doughnut'], ['hamburger', 'a food', 'burger|cheeseburger'], ['watermelon', 'a food'], ['pineapple', 'a food'], ['mushroom', 'a food', 'toadstool'],
  ['teapot', 'a thing at home'], ['cup', 'a thing at home', 'mug'], ['chair', 'a thing at home'], ['bed', 'a thing at home'], ['clock', 'a thing at home'], ['candle', 'a thing at home'],
  ['umbrella', 'an everyday thing', 'brolly'], ['key', 'an everyday thing'], ['book', 'an everyday thing'], ['backpack', 'an everyday thing', 'rucksack|schoolbag'], ['hat', 'an everyday thing'], ['shoe', 'an everyday thing', 'trainer|sneaker|boot'],
  ['guitar', 'an instrument'], ['piano', 'an instrument'], ['drums', 'an instrument', 'drum|drum kit'], ['trumpet', 'an instrument'], ['violin', 'an instrument', 'fiddle'],
  ['car', 'a vehicle'], ['bicycle', 'a vehicle', 'bike'], ['bus', 'a vehicle'], ['train', 'a vehicle'], ['airplane', 'a vehicle', 'plane|aeroplane|jet'], ['helicopter', 'a vehicle'],
  ['sailboat', 'a vehicle', 'boat|sailing boat|yacht'], ['submarine', 'a vehicle'], ['tractor', 'a vehicle'], ['rocket', 'a vehicle', 'spaceship|space rocket'], ['hot air balloon', 'a vehicle', 'balloon'],
  ['castle', 'a building'], ['lighthouse', 'a building'], ['windmill', 'a building'], ['tent', 'a thing outdoors'], ['tree', 'a thing outdoors'], ['flower', 'a thing outdoors'],
  ['cactus', 'a thing outdoors'], ['snowman', 'a thing outdoors'], ['crown', 'a treasure'], ['sword', 'a treasure'], ['diamond', 'a treasure', 'gem|jewel'], ['treasure chest', 'a treasure', 'chest'],
  ['robot', 'a toy', 'droid'], ['teddy bear', 'a toy', 'teddy'], ['kite', 'a toy'], ['soccer ball', 'a toy', 'football|ball'], ['skateboard', 'a toy'], ['lantern', 'an everyday thing', 'lamp'],
];
const EASY = 36;   // the first ones in the list: animals and food

/** Does what they said name the thing? Plurals and the other names count ("bunnies", "a bike"). */
export function names(said, [name, , other = '']) {
  const s = ' ' + words(said) + ' ';
  return [name, ...other.split('|').filter(Boolean)].some(n => {
    const w = words(n);
    return [w, w + 's', w + 'es', w.replace(/y$/, 'ies')].some(f => s.includes(' ' + f + ' '));
  });
}
/** Is it a question? (A recogniser leaves the question mark off, so how it starts counts too.) */
export function isQuestion(said) {
  const s = words(said);
  if (!s || s.split(' ').length < 2) return /\?\s*$/.test(said);
  return /\?\s*$/.test(said) || /^(so |ok |okay |hmm |um |and |right |then |is |are |was |were |does |do |did |can |could |has |have |had |would |will |should |might |may |if |it s |its |am |isn t |doesn t |wait is )+/.test(s + ' ') && !/^(is it over|can we stop|can i give up|do you give up)/.test(s);
}
const GIVE_UP = /\b(give up|giving up|i surrender|tell me what it is|reveal it)\b/;
/** Do they mean it as a guess ("is it a cat?", "a cat!", "I think it's a cat"), not a question that mentions it? */
export function guessed(said, thing) {
  if (!names(said, thing)) return false;
  const s = words(said);
  return s.split(' ').length <= 4 || /\b(is it|it s|its|it is|thinking of|guess|could it be|you re|are you|must be|bet it)\b/.test(s);
}

export function makeTwenty(stage) {
  const { THREE, scene, creature } = stage, { decal, dot, sounds } = gs.tabletop, { rbox, pbr } = gs.hd;
  let root, box, lid, mark, lamps = [], body = null;
  let secret = null, asked = 0, state = 'off', level = 2, t = 0, seen = new Set(), log = [], wins = { you: 0, me: 0 };
  const clk = clock();

  function build() {
    root = table(THREE, { w: .7, d: .46, h: TABLE_H }); root.position.set(CENTRE.x, 0, CENTRE.z); root.name = 'game:twenty';
    // the mystery box: plum wood with a glowing question mark on its front, and a lid that flies off
    const wood = gs.tabletop.wood('#5a3a5c'), trim = pbr('#e8b54a', { rough: .3, metal: .9 });
    box = new THREE.Group(); box.position.set(0, TABLE_H, -.07); root.add(box);
    const shell = new THREE.Mesh(rbox(.2, .17, .2, .012), wood); shell.position.y = .085; box.add(shell);
    for (const y of [.012, .158]) { const band = new THREE.Mesh(rbox(.206, .014, .206, .005), trim); band.position.y = y; box.add(band); }
    lid = new THREE.Group(); lid.position.y = .17; box.add(lid);
    const top = new THREE.Mesh(rbox(.215, .03, .215, .01), wood); top.position.y = .015; lid.add(top);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(.018, 16, 12), trim); knob.position.y = .04; lid.add(knob);
    mark = decal(.12, .12, (c, w, h) => { c.fillStyle = '#ffd27a'; c.font = `900 ${h * .9}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', w / 2, h * .54); }, { px: 256, lift: 0, glow: 2 });
    mark.rotation.x = Math.PI / 2; mark.position.set(0, .088, .101); box.add(mark);
    // twenty lamps in two rows along your edge, lit until a question uses them up
    lamps = Array.from({ length: QUESTIONS }, (_, i) => {
      const l = dot('#ffd27a', { r: .011, glow: 2 }), row = Math.floor(i / 10), col = i % 10;
      l.scale.y = .25; l.position.set((col - 4.5) * .05, TABLE_H + .003, .1 + row * .045); root.add(l); return l;
    });
    root.traverse(m => { if (m.isMesh && m !== mark) { m.castShadow = true; m.receiveShadow = true; } });
  }

  function light() {
    lamps.forEach((l, i) => { l.visible = true; const m = l.material; m.emissiveIntensity = i < QUESTIONS - asked ? 2 : 0; m.color.set(i < QUESTIONS - asked ? '#ffd27a' : '#3a2a20'); });
  }
  const pick = () => {
    const pool = THINGS.slice(0, level === 1 ? EASY : THINGS.length).filter(x => !seen.has(x[0]));
    const s = pool.length ? pool[Math.floor(Math.random() * pool.length)] : THINGS[Math.floor(Math.random() * THINGS.length)];
    seen.add(s[0]); return s;
  };
  const an = n => (/^[aeiou]/.test(n) ? 'an ' : 'a ') + n;
  const hint = () => level <= 2 ? ` If they ask for a clue, it is ${secret[1]}.` : '';

  /** The box opens and the thing appears in its hands. won: they guessed it. */
  async function reveal(won) {
    const my = clk.epoch; state = won ? 'won' : 'lost';
    if (won) wins.you++; else wins.me++;
    creature.mood(won ? 'excited' : 'happy'); creature.gesture('tada');
    won ? sounds.chime() : sounds.gong();
    const from = lid.position.clone();
    clk.tween(.6, k => { lid.position.set(from.x + k * .25, from.y + Math.sin(k * Math.PI) * .25 + k * -.05, from.z - k * .05); lid.rotation.z = -k * 2.2; });
    const at = new THREE.Vector3(); box.getWorldPosition(at); at.y += .2;
    stage.sparks(at, won ? '#7dffa0' : '#ffd27a', 50);
    await clk.wait(.35);
    if (my !== clk.epoch) return '';
    clk.tween(.4, k => box.scale.setScalar(Math.max(.001, 1 - k)));   // (the box makes way for what was in it)
    const made = stage.make ? await stage.make(an(secret[0])) : '';
    return made;
  }

  // what Reverie is told
  const left = () => QUESTIONS - asked;
  const lastQs = () => log.slice(-6).map(q => `"${q}"`).join(', ');

  const api = {
    id: 'twenty', title: 'Twenty Questions', camera: CAMERA,
    get state() { return state; },
    /** A new secret, and twenty fresh lamps. level 1: animals and food only, with clues; 3 and up: anything, no clues. */
    async start({ level: lv } = {}) {
      if (!root) build();
      if (lv) level = Math.max(1, Math.min(5, Math.round(lv)));
      clk.stop(); secret = pick(); asked = 0; log = []; state = 'asking';
      lid.position.set(0, .17, 0); lid.rotation.set(0, 0, 0); box.scale.setScalar(1); box.rotation.set(0, 0, 0); light();
      if (!root.parent) { scene.add(root); body = stage.physics?.box(null, .7, TABLE_H, .46, { fixed: true, at: { x: CENTRE.x, y: TABLE_H / 2, z: CENTRE.z } }); }
      root.scale.setScalar(.01); clk.tween(.45, k => root.scale.setScalar(popIn(k)));
      stage.sparks(new THREE.Vector3(CENTRE.x, TABLE_H + .15, CENTRE.z - .07), '#c79bff', 40); sounds.flip();
      creature.gesture('think');
      return `Twenty Questions is set up: a mystery box on the table and twenty lamps. You have secretly thought of ${an(secret[0])} (${secret[1]}). Never say it, spell it or hint at it too strongly. They ask yes-or-no questions; answer each truthfully in a short, playful line ("Yes!", "Nope!", "Sort of..."). The lamps count their questions and the game spots a right guess by itself. Tell them you are thinking of something and they have twenty questions.`;
    },
    stop() {
      clk.stop(); state = 'off';
      if (root?.parent) { root.removeFromParent(); body?.remove?.(); body = null; }
    },
    update(dt) {
      if (state === 'off') return;
      t += dt; clk.update(dt);
      if (state === 'asking') {
        box.rotation.y = Math.sin(t * .8) * .12; box.position.y = TABLE_H + Math.max(0, Math.sin(t * 2.4)) * .006;
        mark.material.emissiveIntensity = 1.6 + Math.sin(t * 3) * .6;
        const next = QUESTIONS - asked - 1; if (lamps[next]) lamps[next].material.emissiveIntensity = 1.4 + Math.sin(t * 6) * 1.2;
      }
    },
    tap(ray) {
      if (state === 'off') return false;
      if (!ray.intersectObject(root, true).length) return false;
      if (state === 'asking') { sounds.rattle?.(.5); clk.tween(.3, k => { box.rotation.z = Math.sin(k * Math.PI * 4) * .08 * (1 - k); }); }
      return true;
    },
    /**
     * Everything they say while it's on, before Claude hears it: counts a question, spots a right guess, a give-up.
     * Returns a note for Claude about what the game did, or ''.
     */
    heard(said) {
      if (state !== 'asking') return '';
      const s = words(said);
      if (guessed(said, secret)) { reveal(true); return `(They guessed it: it was ${an(secret[0])}, after ${asked} question${asked === 1 ? '' : 's'}! The mystery box burst open and it is appearing in your hands. Cheer, and offer another round.)`; }
      if (GIVE_UP.test(s)) { reveal(false); return `(They gave up. It was ${an(secret[0])}: the box burst open and it is appearing in your hands. Tell them, playfully, and offer another round.)`; }
      if (!isQuestion(said)) return '';
      asked++; log.push(String(said).slice(0, 80)); light(); sounds.tick();
      if (asked >= QUESTIONS) { reveal(false); return `(That was their twentieth question and they have not got it. It was ${an(secret[0])}: answer this one, then tell them what it was. The box burst open and it is appearing in your hands. Offer another round.)`; }
      return `(Question ${asked} of ${QUESTIONS}: ${left()} left.${left() <= 3 ? ' Running out: tease them a little.' : ''})`;
    },
    /** Claude says they got it (in words the game didn't catch), or they give up: game_move "guessed" or "give up". */
    async command(text) {
      if (state === 'off') return 'No game is on.';
      if (state !== 'asking') return 'This round is over. Call play for another.';
      const s = words(text);
      if (/\b(guessed|got it|right|correct|win)\b/.test(s) || names(text, secret)) { await reveal(true); return `They got it! The box opened and you are holding ${an(secret[0])}.`; }
      if (/\b(give up|gave up|reveal|end|lost)\b/.test(s)) { await reveal(false); return `You showed them: it was ${an(secret[0])}, now in your hands.`; }
      return 'Use "guessed" when they named it, or "give up" to show them.';
    },
    context() {
      if (state === 'off') return '';
      if (state !== 'asking') return `[twenty questions, on the table: the round is over; it was ${an(secret[0])}. They have won ${wins.you}, you ${wins.me}.]`;
      return `[twenty questions, on the table: you are thinking of ${an(secret[0])} (${secret[1]}); keep it secret. ${asked} of ${QUESTIONS} questions asked${log.length ? ` (latest: ${lastQs()})` : ''}. Answer yes-or-no questions truthfully and briefly; when they guess, the game checks it.${hint()} If they name it in a way the game misses, call game_move "guessed".]`;
    },
    bar() {
      if (state === 'off') return null;
      const text = state === 'asking' ? `Twenty Questions · ${asked} of ${QUESTIONS} asked` : state === 'won' ? `You got it: ${an(secret[0])}!` : `It was ${an(secret[0])}`;
      return { text, buttons: [...(state === 'asking' ? [{ id: 'giveUp', label: 'Give up' }] : [{ id: 'again', label: 'Again' }]), { id: 'leave', label: 'Done' }] };
    },
    async giveUp() {
      if (state !== 'asking') return;
      await reveal(false);
      stage.news(`[twenty] They pressed Give up. It was ${an(secret[0])}, and it is in your hands now. Tell them, playfully, and offer another round.`, true);
    },
  };
  return api;
}
