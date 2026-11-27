// Real dice: Reverie throws them from its hands onto the rug, where they tumble in the stage's physics world
// (gs.physics3d) and the number is read off whichever face ends up on top (gs.dice.Dice3D). The dice themselves are
// the engine's board-game dice (gs.tabletop.die). Dice with other numbers of sides (a d20) have no cube to throw, so
// they are rolled by gs.dice.roll and the number pops up over its head in 3D text (gs.fx3d.text3d).
import gs, { loadParts } from '../engine/src/gamescroll.js';

const SIZE = .07;            // metres: a chunky toy die
const MAX = 6;               // the most cubes thrown at once
const KEEP_FOR = 30;         // seconds the dice stay on the floor before they fade away
const SHOW_FOR = 3.2;        // seconds a number shown over its head stays

/** Reads "2d6", "d20", "3d6+2", "a die", "two dice" into dice notation, or null. */
export function notation(text) {
  const t = String(text || '').toLowerCase().trim();
  const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const m = /^(\d+|a|an|one|two|three|four|five|six)?\s*d\s*(\d+)\s*(?:k([hl])(\d+))?\s*([+-]\s*\d+)?$/.exec(t.replace(/\s+/g, ''));
  if (m) {
    const n = m[1] ? (words[m[1]] ?? +m[1]) : 1, sides = +m[2];
    if (n < 1 || n > 20 || sides < 2 || sides > 1000) return null;
    return `${n}d${sides}${m[3] ? 'k' + m[3] + m[4] : ''}${m[5] ? m[5].replace(/\s+/g, '') : ''}`;
  }
  const w = /^(a|an|one|two|three|four|five|six|\d)?\s*(die|dice)$/.exec(t);
  if (w) return `${w[1] ? (words[w[1]] ?? +w[1]) : (w[2] === 'die' ? 1 : 2)}d6`;
  return null;
}

/**
 * The dice, for the stage. o: { THREE, scene, physics (a World3D), creature, sparks(at, colour, n) }.
 * roll(text) resolves a sentence for Claude once the dice have stopped.
 */
export function makeDice({ THREE, scene, physics, creature, sparks }) {
  let cubes = null, meshes = [], clears = 0, age = 0, rolling = null, shown = [], t = 0;
  const at = new THREE.Vector3();

  function clearCubes() {
    if (cubes) cubes.remove(); cubes = null;
    for (const m of meshes) m.removeFromParent(); meshes = [];
  }
  async function pop(text, colour = '#ffe08a') {
    let label = null;
    // (its letters come from a font that loads the first time: until it's in, text3d throws with a promise to wait on)
    for (let i = 0; i < 20 && !label; i++) {
      try { label = gs.fx3d.text3d(text, { size: .09, color: colour, font: 'bold', align: 'center', outline: .008, outlineColor: '#2a1d16', face: true }); }
      catch (e) { if (!e?.kitLoading) { console.warn('[reverie] dice number:', e); return; } await e.kitLoading; }
    }
    if (!label) return;
    creature.coreAt(at); label.position.set(at.x, at.y + .55, at.z); label.scale.setScalar(.01); scene.add(label);
    shown.push({ label, t: 0 });
  }

  /** Throws real cubes (count of them, d6) from its hands. Resolves the faces on top once they all stop. */
  function throwCubes(count) {
    clearCubes();
    const { die } = gs.tabletop;
    for (let i = 0; i < count; i++) {
      const m = die(SIZE, { body: i % 2 ? '#fff4e0' : '#ffe3c4', pips: '#3a2230' });
      m.traverse(x => { if (x.isMesh) { x.castShadow = true; x.receiveShadow = true; } });
      scene.add(m); meshes.push(m);
    }
    cubes = new gs.dice.Dice3D(physics, meshes, { size: SIZE, bounce: .3, friction: .6, density: 1.2 });
    creature.coreAt(at);
    // out of its hands, forwards and up, so they land on the rug in front of it and roll towards the camera a little
    cubes.throw({ x: at.x, y: at.y + .18, z: at.z + .2 }, { x: (Math.random() - .5) * .6, y: 1.4, z: .55 });
    gs.tabletop.sounds.rattle(); age = 0;
    return new Promise(res => { rolling = { res, t: 0, age: 0 }; });
  }

  return {
    /** Rolls dice from dice notation ("2d6", "d20", "4d6kh3", "3d6+2"). Resolves a sentence for Claude. */
    async roll(text = '1d6') {
      const n = notation(text) || (text ? null : '1d6');
      if (!n) return { text: `Not rolled: "${text}" is not dice I know (try 2d6, d20 or 3d6+2).`, error: true };
      const cube = /^(\d+)d6([+-]\d+)?$/.exec(n);
      await loadParts(['dice']);   // (gs.dice loads on first use)
      creature.gesture('tada');
      if (cube && +cube[1] <= MAX) {
        const faces = await throwCubes(+cube[1]), plus = +(cube[2] || 0), total = faces.reduce((a, b) => a + b, 0) + plus;
        const list = faces.length === 1 ? `a ${faces[0]}` : `${faces.slice(0, -1).join(', ')} and ${faces.at(-1)}`;
        creature.gesture(total >= faces.length * 5 ? 'bounce' : 'nod');
        if (faces.length > 1 || plus) pop(String(total));
        return `Threw ${faces.length === 1 ? 'a real die' : `${faces.length} real dice`} onto the rug (${n}): it came up ${list}${faces.length > 1 || plus ? `, ${total} in all` : ''}.`;
      }
      let r; try { r = gs.dice.roll(n); } catch { return { text: `Not rolled: "${text}" is not dice I know.`, error: true }; }
      creature.coreAt(at); sparks(at, '#ffe08a', 30); gs.tabletop.sounds.rattle(); pop(String(r.total));
      const each = r.kept.flat();
      return `Rolled ${n} by magic (only six-sided dice can be thrown for real): ${each.length > 1 ? each.join(', ') + ', ' : ''}${r.total} in all. The number floats over your head.`;
    },
    /** Throws count real d6 from its hands (for a game). Resolves the faces that came up. */
    async throw(count = 1) {
      const my = clears; await loadParts(['dice']);
      if (my !== clears) return [];   // (taken away while the dice kit loaded: its game was put away, so no die lands)
      creature.gesture('tada'); return throwCubes(Math.max(1, Math.min(MAX, count)));
    },
    /** The dice on the floor, in a few words for the scene line, or ''. */
    get onFloor() { return cubes && !rolling ? `${meshes.length === 1 ? 'a die showing' : meshes.length + ' dice showing'} ${cubes.values.join(', ')}` : ''; },
    /** Takes every die (and number) away. */
    clear() { clears++; const had = meshes.length; clearCubes(); for (const s of shown) s.label.removeFromParent(); shown = []; if (rolling) { rolling.res([]); rolling = null; } return had; },
    /** Every frame, after the physics step. */
    update(dt) {
      t += dt;
      if (cubes) {
        cubes.update(dt); age += dt;
        if (rolling) {
          rolling.t += dt; rolling.age += dt;
          // a die leaning on another, or on the wall, never reads cleanly: nudge it; after 5 s take what shows
          if (rolling.t > .6 && rolling.age < 5) for (const b of cubes.bodies) {
            if (b.speed > .05) continue;
            const q = b.body.rotation(), up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
            const flat = Math.max(Math.abs(up.x), Math.abs(up.y), Math.abs(up.z));
            if (flat < .96) { b.setVel((Math.random() - .5) * .3, .9, (Math.random() - .5) * .3).setSpin((Math.random() - .5) * 8, 0, (Math.random() - .5) * 8); rolling.t = .3; }
          }
          if ((cubes.settled && rolling.t > .6) || rolling.age > 6) {
            const r = rolling; rolling = null; gs.tabletop.sounds.clack(.5);
            for (const m of meshes) { m.getWorldPosition(at); sparks(at, '#ffe08a', 8); }
            r.res(cubes.values);
          }
        }
        // a die that slipped out of the world: it's gone, and a roll still waiting gets a fair face for each die
        for (const m of meshes) if (m.position.y < -2) { if (rolling) { const r = rolling; rolling = null; r.res(meshes.map(() => 1 + Math.floor(Math.random() * 6))); } clearCubes(); break; }
        if (cubes && !rolling && age > KEEP_FOR) clearCubes();
      }
      for (const s of shown) {
        s.t += dt; const k = Math.min(1, s.t / .25), out = Math.max(0, (s.t - SHOW_FOR + .4) / .4);
        s.label.scale.setScalar(Math.max(.01, (1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2)) * (1 - out)));
        s.label.position.y += dt * .04;
      }
      for (const s of shown) if (s.t > SHOW_FOR) { s.label.removeFromParent(); s.label.dispose?.(); }
      shown = shown.filter(s => s.t <= SHOW_FOR);
    },
  };
}
