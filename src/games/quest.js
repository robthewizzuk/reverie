// Dice Quest: a little adventure across the table that Reverie tells as you go. Your hero stands at camp at one end of
// a winding path of stepping stones; along it wait four challenges (a troll on a bridge, a sleeping dragon, a riddle
// door...), each one a little model magicked up by the 3D generator, and a treasure chest at the end. At each one you
// throw a real die from Reverie's hands: beat the number and you're past, miss it and you lose a heart (but carry on).
// Reach the treasure with a heart left and you win.
//
// Who does what: the engine sets the quest, throws the dice (gs.dice.Dice3D in the stage's physics) and keeps the
// hearts; Reverie is the storyteller, describing each challenge and what happened, from the news it is sent.
//
// A game here is an object the stage drives (see ./index.js for the shape every game has).
import gs from '../../engine/src/gamescroll.js';
import { table, clock, popIn, ease, words } from './parts.js';

const TABLE_H = .3;
const CENTRE = { x: 0, z: .62 };
export const CAMERA = { pos: [0, 1.15, 1.45], look: [0, .3, .5] };
const PROP = .1;          // metres: the longest side of a challenge's model
// the challenges: what it is (for the story), the model's words, and the number to beat on a die (before the level)
const CHALLENGES = [
  { what: 'a grumpy troll guarding a rickety bridge', prop: 'a troll', need: 4 },
  { what: 'a sleeping dragon curled round the path: tiptoe past without waking it', prop: 'a dragon', need: 5 },
  { what: 'a door with a talking lock that asks a riddle', prop: 'a wooden door', need: 4 },
  { what: 'a rushing river with slippery stepping stones', prop: 'a rowing boat', need: 3 },
  { what: 'a hungry wolf who wants your sandwiches', prop: 'a wolf', need: 4 },
  { what: 'a giant spider spinning a web across the path', prop: 'a spider', need: 4 },
  { what: 'a ghost in an old windmill who loves a good joke', prop: 'a windmill', need: 3 },
  { what: 'a cheeky goblin selling magic beans', prop: 'a goblin', need: 3 },
  { what: 'a towering cactus forest in a hot desert', prop: 'a cactus', need: 3 },
  { what: 'a wobbly rope ladder up a cliff', prop: 'a ladder', need: 4 },
  { what: 'a pirate ship blocking the harbour', prop: 'a pirate ship', need: 5 },
  { what: 'a snowman who will only let friends pass', prop: 'a snowman', need: 3 },
];
const STOPS = 6;          // camp, four challenges, the treasure
// where the stops are on the table top (metres, the table's middle at 0): an S from your left round to your right
const PATH = [[-.3, .15], [-.22, -.03], [-.06, .1], [.06, -.08], [.2, .07], [.3, -.1]];

export function makeQuest(stage) {
  const { THREE, scene, creature } = stage, { disc, pawn, eyes, dot, sounds } = gs.tabletop, { pbr } = gs.hd;
  let root, hero, hearts = [], stones = [], props = [], body = null;
  let quest = [], at = 0, life = 3, state = 'off', level = 2, t = 0, rolls = [], heroAt = new THREE.Vector3();
  const clk = clock(), alive = my => my === clk.epoch && state !== 'off';
  const need = c => Math.max(2, Math.min(6, c.need + (level <= 1 ? -1 : level >= 4 ? 1 : 0)));

  function build() {
    root = table(THREE, { w: .82, d: .52, h: TABLE_H }); root.position.set(CENTRE.x, 0, CENTRE.z); root.name = 'game:quest';
    // a mossy green cloth for the land, then the stepping stones with little dots of path between them
    const land = new THREE.Mesh(new THREE.CylinderGeometry(.36, .36, .006, 48), pbr('#7fa86a', { rough: .95 })); land.scale.z = .62; land.position.y = TABLE_H + .003; land.receiveShadow = true; root.add(land);
    stones = PATH.map(([x, z], i) => { const s = disc(i === 0 ? '#c9a27a' : i === STOPS - 1 ? '#e8c25a' : '#bdb6a8', { r: .028, h: .008 }); s.position.set(x, TABLE_H + .006, z); s.receiveShadow = true; root.add(s); return s; });
    for (let i = 0; i < STOPS - 1; i++) for (let k = 1; k < 4; k++) {
      const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1], u = k / 4, d = dot('#e9dcc0', { r: .005, glow: 0 }); d.scale.y = .2;
      d.position.set(ax + (bx - ax) * u, TABLE_H + .007, az + (bz - az) * u); root.add(d);
    }
    // your hero: a sky-blue pawn with glowing eyes
    hero = pawn('#7cc7f0', { r: .3, h: .9 }); hero.add(eyes('#ffffff', { y: .7, z: .2, gap: .09, r: .05 })); hero.scale.setScalar(.075); hero.castShadow = true; root.add(hero);
    // three hearts along your edge
    hearts = [0, 1, 2].map(i => {
      const h = new THREE.Shape(); h.moveTo(0, -.6); h.bezierCurveTo(-1.2, .2, -.5, 1.1, 0, .45); h.bezierCurveTo(.5, 1.1, 1.2, .2, 0, -.6);
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(h, { depth: .3, bevelEnabled: true, bevelSize: .12, bevelThickness: .12, bevelSegments: 3 }), pbr('#ff5a6a', { glow: .5, rough: .4, clear: .5 }));
      m.scale.setScalar(.016); m.position.set(.28 + i * .04 - .04, TABLE_H + .02, .22); root.add(m); return m;
    });
    root.traverse(m => { if (m.isMesh && !m.castShadow) { m.castShadow = true; } });
  }
  const stopAt = i => new THREE.Vector3(PATH[i][0], TABLE_H + .01, PATH[i][1]);

  /** The models for the challenges and the chest, made on the device and stood beside their stones. */
  async function dress() {
    for (const p of props) p.removeFromParent(); props = [];
    const my = clk.epoch;
    const list = [...quest.map(c => c.prop), 'a treasure chest'];
    await Promise.all(list.map(async (w, k) => {
      let thing = null; try { thing = await gs.models.generate.make(w, { seed: 1 + Math.floor(Math.random() * 999) }); } catch { return; }
      if (!thing || my !== clk.epoch) return;
      const g = new THREE.Group(); g.add(thing);
      const b = new THREE.Box3().setFromObject(thing), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      const k2 = (k === list.length - 1 ? PROP * .8 : PROP) / Math.max(.01, s.x, s.y, s.z);
      thing.position.set(-c.x, -b.min.y, -c.z); g.scale.setScalar(k2);
      thing.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      const i = k + 1, [x, z] = PATH[i], back = i === STOPS - 1 ? 0 : -.055;
      g.position.set(x + (i === STOPS - 1 ? .0 : .0), TABLE_H + .008, z + back); g.rotation.y = (Math.random() - .5) * .6;
      if (i === STOPS - 1) g.position.y += .012;
      root.add(g); props[k] = g;
      const full = g.scale.x; g.scale.setScalar(.001); clk.tween(.4, e => g.scale.setScalar(full * popIn(e)));
    }));
  }

  function showHearts() { hearts.forEach((h, i) => { h.visible = i < life; }); }
  const here = () => quest[at - 1];
  const tell = c => `The next challenge: ${c.what}. They need ${need(c)} or more on a die to get past.`;

  async function hop(to) {
    const from = hero.position.clone(), goal = stopAt(to);
    // (false when the quest was put away or begun again on the way: the hero's place is the new quest's then)
    if (!await clk.tween(.5, k => { const e = ease(k); hero.position.lerpVectors(from, goal, e); hero.position.y = goal.y + Math.sin(k * Math.PI) * .05; })) return false;
    sounds.clack(.5); at = to; return true;
  }

  /** A throw of the die for the challenge they are at. */
  async function roll() {
    if (state !== 'ready') return null;
    const my = clk.epoch, c = here(), n = need(c);
    state = 'rolling';
    let faces = [];
    try { faces = await stage.throwDice?.(1) || []; } catch (e) { console.warn('[reverie] quest dice:', e); }
    if (!alive(my)) return null;
    const v = faces[0] || Math.ceil(Math.random() * 6), ok = v >= n;
    rolls.push({ challenge: c.prop, v, ok });
    hero.getWorldPosition(heroAt);
    if (ok) { stage.sparks(heroAt, '#7dffa0', 26); sounds.chime(); creature.mood('excited'); creature.gesture(v === 6 ? 'tada' : 'bounce'); }
    else { life--; showHearts(); stage.sparks(heroAt, '#ff6a6a', 20); sounds.thud(); creature.mood('surprised'); creature.gesture('shake'); }
    const what = `They rolled a ${v} at ${c.what} (they needed ${n}): ${ok ? 'they made it past!' : `not enough, so they lose a heart${life ? ` (${life} left) but scramble past anyway` : ''}.`}`;
    if (!await clk.wait(.9) || !alive(my)) return v;
    if (life <= 0) return end(false, what);
    await hop(at + 1);
    if (!alive(my)) return v;
    if (at === STOPS - 1) return end(true, what);
    state = 'ready';
    stage.news(`[quest] ${what} Tell it in one or two lively storybook sentences, then: ${tell(here())} Ask them to roll.`, true);
    return v;
  }
  function end(won, what) {
    state = won ? 'won' : 'lost';
    if (won) { const chest = props[STOPS - 2]; if (chest) { chest.getWorldPosition(heroAt); stage.sparks(heroAt, '#ffd27a', 60); } sounds.gong(); creature.mood('excited'); creature.gesture('tada'); }
    else { sounds.thud(); creature.mood('sad'); creature.gesture('shrug'); }
    stage.news(`[quest] ${what} ${won ? `They reached the treasure chest with ${life} heart${life === 1 ? '' : 's'} left: they won the quest! Tell the happy ending in two or three sentences.` : 'That was their last heart: the quest is over. Tell a gentle, funny ending (a friendly owl carries the hero home for cocoa) and offer another go.'}`, true);
    return null;
  }

  const api = {
    id: 'quest', title: 'Dice Quest', camera: CAMERA,
    get state() { return state; },
    /** A new quest: four challenges picked at random. level 1 easier numbers to beat, 4 and 5 harder ones. */
    async start({ level: lv } = {}) {
      if (!root) build();
      if (lv) level = Math.max(1, Math.min(5, Math.round(lv)));
      clk.stop(); stage.clearDice?.();
      const pool = CHALLENGES.slice(); quest = [];
      while (quest.length < STOPS - 2) quest.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      life = level >= 5 ? 2 : 3; rolls = []; showHearts();
      hero.position.copy(stopAt(0)); at = 0; state = 'walking';
      if (!root.parent) { scene.add(root); body = stage.physics?.box(null, .82, TABLE_H, .52, { fixed: true, at: { x: CENTRE.x, y: TABLE_H / 2, z: CENTRE.z } }); }
      root.scale.setScalar(.01); clk.tween(.45, k => root.scale.setScalar(popIn(k)));
      stage.sparks(new THREE.Vector3(CENTRE.x, TABLE_H + .1, CENTRE.z), '#ffd27a', 40); sounds.flip();
      dress();
      const my = clk.epoch;
      clk.wait(.8).then(ok => { if (ok && alive(my)) hop(1).then(() => { if (alive(my)) state = 'ready'; }); });
      return `Dice Quest is set up on the table: a little land with a winding path, their hero at camp, four challenges along the way and a treasure chest at the end. They have ${life} hearts. You are the storyteller: set the scene in two playful sentences (give the hero a fun name), then: ${tell(quest[0])} They throw the die by tapping it, pressing Roll or saying "roll".`;
    },
    stop() {
      clk.stop(); state = 'off'; stage.clearDice?.();
      if (root?.parent) { root.removeFromParent(); body?.remove?.(); body = null; }
    },
    update(dt) {
      if (state === 'off') return;
      t += dt; clk.update(dt);
      if (state === 'ready') hero.rotation.y = Math.sin(t * 2) * .3;
      hearts.forEach((h, i) => { h.rotation.y = Math.sin(t * 1.5 + i) * .4; });
    },
    tap(ray) {
      if (state === 'off') return false;
      if (!ray.intersectObject(root, true).length) return false;
      if (state === 'ready') roll();
      return true;
    },
    async command(text) {
      if (state === 'off') return 'No quest is on.';
      if (state === 'won' || state === 'lost') return 'The quest is over. Call play for a new one.';
      if (state !== 'ready') return 'Wait a moment: the hero is on the move.';
      if (!/\b(roll|throw|go|dice|die)\b/.test(words(text))) return 'Say "roll" to throw the die.';
      const v = await roll();
      return v == null ? 'Rolled.' : `Threw the die for them: a ${v}. You will hear what happened.`;
    },
    roll() { roll(); },
    /** "Roll!", said while a challenge waits: the die is thrown at once, before Claude hears it. */
    heard(said) {
      if (state !== 'ready' || !/^(ok |okay |right |go on |let s |lets |i ll |ill )*(roll|throw)( it| the die| the dice| a die)?( now| please)?$/.test(words(said))) return '';
      roll();
      return '(The die is being thrown for them right now: you will hear what came up. Say one short, suspenseful line, and do not use the roll tool.)';
    },
    context() {
      if (state === 'off') return '';
      if (state === 'won' || state === 'lost') return `[dice quest: over; they ${state} with ${life} heart${life === 1 ? '' : 's'} left.]`;
      const c = here();
      return `[dice quest, on the table, you are the storyteller: ${life} hearts left, challenge ${Math.max(1, at)} of ${STOPS - 2}${c ? `: ${c.what}, they need ${need(c)} or more` : ''}. Rolls so far: ${rolls.map(r => `${r.v} (${r.ok ? 'made it' : 'missed'})`).join(', ') || 'none'}. The engine throws the dice; never invent a roll.]`;
    },
    bar() {
      if (state === 'off') return null;
      const s = state === 'won' ? 'You found the treasure!' : state === 'lost' ? 'Out of hearts' : `Challenge ${Math.max(1, at)} of ${STOPS - 2} · ${'♥'.repeat(life)}`;
      return { text: `Dice Quest · ${s}`, buttons: [...(state === 'ready' ? [{ id: 'roll', label: 'Roll' }] : []), ...(state === 'won' || state === 'lost' ? [{ id: 'again', label: 'Again' }] : []), { id: 'leave', label: 'Done' }] };
    },
  };
  return api;
}
