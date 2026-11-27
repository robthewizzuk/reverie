// Reverie's pet: a tiny animal it makes for you (a kitten, a fox, a baby dragon, a bee...), built by the engine's
// creature maker (gs.models.creature: a real skeleton with gaits made for its own legs and wings) at pet size. It
// lives in the room on its own, all on the device: it wanders about (mostly where you can see it), trots after
// Reverie when it walks, chases anything thrown and noses it along the floor, runs to say hello when you come back,
// curls up beside Reverie when it gets sleepy, and does tricks when asked. Tap it and it hops, with hearts. It gets
// livelier the happier Reverie is. What it is and its name are kept on this device (it comes back next visit).
import gs from '../engine/src/gamescroll.js';
import { colourOf } from './looks.js';

const KEY = 'reverie.pet.v1';
// pet sizes, in metres (nose to rump; a bird beak to tail)
const SIZE = { quad: .36, bird: .22, insect: .16, monster: .38 };
// animals that would need water, or are people-shaped
const NOT = new Set(['fish', 'shark', 'eel', 'puffer', 'angler', 'serpent', 'ogre']);
// these never land; birds and a dragon take a little flight now and then
const ALWAYS_FLY = new Set(['bee', 'butterfly', 'dragonfly']), CAN_FLY = new Set(['songbird', 'crow', 'duck', 'hawk', 'owl', 'dragon', 'imp']);
const SAY = { quad: 'squeak', bird: 'chirp', insect: 'buzz', monster: 'growl' };
export const TRICKS = ['sit', 'jump', 'spin', 'come', 'sleep', 'play_dead', 'zoomies', 'dance'];
// where it may go: the floor of the room, and what is in the way there (x, z, radius)
const BOUNDS = { x0: -1.75, x1: 1.9, z0: -1.35, z1: 1.2 };
const STILL = [{ x: -1.45, z: -1.15, r: .3 }, { x: 1.85, z: -.6, r: .2 }];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/** The animal a word means ('kitten' → cat, 'puppy' → dog), or null. */
export function animalOf(word) {
  const likes = gs.models.creature.likes;
  const t = String(word || '').toLowerCase().replace(/^(a|an|the|baby|little|tiny|small|mini|wee|cute)\s+/g, '').replace(/^(baby|little|tiny|small|mini|wee|cute)\s+/g, '').trim();
  const ALIAS = { kitten: 'cat', kitty: 'cat', puppy: 'dog', pup: 'dog', doggy: 'dog', bunny: 'rabbit', hamster: 'mouse', bird: 'songbird', robin: 'songbird', sparrow: 'songbird', budgie: 'songbird', parrot: 'songbird', chick: 'chicken', hen: 'chicken', piglet: 'pig', lamb: 'sheep', calf: 'cow', cub: 'bear', bear: 'bear', ladybug: 'ladybird', bumblebee: 'bee', dino: 'dragon', dinosaur: 'lizard', gecko: 'lizard', slime: 'blob', jelly: 'blob', monster: 'beast', foal: 'horse', pony: 'horse', fawn: 'deer', kit: 'fox', duckling: 'duck', owlet: 'owl', froggy: 'lizard', frog: 'lizard', turtle: 'lizard' };
  const w = t.replace(/s$/, '');
  for (const k of [t, w, ALIAS[t], ALIAS[w], ...t.split(/\s+/).reverse().flatMap(x => [x, x.replace(/s$/, ''), ALIAS[x]])]) if (k && likes[k] && !NOT.has(k)) return k;
  return null;
}
export const PETS = () => Object.keys(gs.models.creature.likes).filter(k => !NOT.has(k));

function load() { try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); return o && o.like ? o : null; } catch { return null; } }
function save(o) { try { if (o) localStorage.setItem(KEY, JSON.stringify(o)); else localStorage.removeItem(KEY); } catch { /* a private window */ } }

/**
 * makePet({ scene, camera, creature, world, fx, floaties, mood, news }): one pet (or none).
 * update(dt) each frame, command(input) for the pet tool, tap(ray) for a tap, line() for Claude.
 */
export function makePet({ scene, camera, creature: reverie, world, sparks, floaties, mood, news = () => {} }) {
  const { THREE } = gs.hd;
  let pet = null, about = null, mode = 'idle', modeT = 0, wait = 1, target = null, flying = 0, height = 0, pose = '', heading = 0;
  let chased = new WeakMap(), chasing = null, poseOnce = null, spin = 0, zT = 0, lastPat = -99, t = 0, wasWalking = false, wasDrowsy = false;
  let pop = 1, chases = 0, base = 1, idlePose = null, trickNow = null;   // (what it is doing now: not kept)
  // its name, floating over it for a moment when it is made or patted (the engine's sharp 3D text)
  let label = null, labelT = 0;
  function showName(again = true) {
    if (!about) return;
    try {
      if (!label) { label = gs.fx3d.text3d(about.name, { size: .035, color: '#fff7ef', font: 'bold', outline: .006, outlineColor: '#d2694a', align: 'center', face: true }); scene.add(label); }
      else if (label.text !== about.name) { label.text = about.name; label.sync(); }
      labelT = 2.6;
    } catch (e) { if (e?.kitLoading && again) e.kitLoading.then(() => showName(false), () => {}); /* (its letters load the first time: shown once they're in) */ }
  }
  const v = new THREE.Vector3(), c = new THREE.Vector3();

  // (no seed: the animal as the book shows it, so a fox is a fox's colours; a colour asked for is its coat)
  const optionsOf = a => ({ like: a.like, size: SIZE[gs.models.creature.likes[a.like]] || .24, ...(a.colour ? { colour: a.colour } : {}), fur: furFor() });
  // fur in layers only on the fastest computers: on a tier 2 view it tripled the room's triangles for a pet this small
  // (its coat is painted either way)
  const furFor = () => (gs.hd.HD?.tier ?? 0) >= 3 ? { layers: 6 } : false;
  async function build(a) {
    const o = optionsOf(a);
    await gs.models.creature.ready(o);
    const p = gs.models.creature(o);
    p.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    return p;
  }
  function put(p, a, at) {
    if (pet) { pet.removeFromParent(); pet = null; }
    pet = p; about = a; scene.add(pet); base = pet.scale.x;   // (its size is the creature's own scale: kept as it pops in)
    pet.lod = 1;   // (a pet this small never needs its finest shape: a third of the triangles; and set once, as a change fades)
    pet.position.set(at.x, 0, at.z); heading = at.face ?? 0; pet.rotation.y = heading;
    flying = ALWAYS_FLY.has(a.like) ? 1 : 0; height = flying ? .55 : 0;
    mode = 'idle'; modeT = 0; wait = 1.2; target = null; chasing = null; poseOnce = null;
  }
  const kind = () => gs.models.creature.likes[about.like];
  const sound = (k = 1) => { const n = SAY[kind()] || 'squeak'; gs.sound.sounds[n]?.(kind() === 'monster' ? 1.7 * k : 1.3 * k); };
  const where = () => pet.position;

  // ---- what it does
  function play(name, o) {
    const r = pet.rig; if (!r?.pace?.(name)) return false;
    if (pose !== name || o?.again) { r.play(name, { fade: .2, ...o }); pose = name; }
    return true;
  }
  function setMode(m, o = {}) { mode = m; modeT = 0; poseOnce = o.once || null; target = o.to || null; wait = o.wait ?? wait; }
  // a point on the floor worth going to: mostly one in view of the camera, away from Reverie and the furniture
  function pickSpot(onScreen = Math.random() < .8) {
    for (let i = 0; i < 12; i++) {
      const x = BOUNDS.x0 + Math.random() * (BOUNDS.x1 - BOUNDS.x0), z = BOUNDS.z0 + Math.random() * (BOUNDS.z1 - BOUNDS.z0);
      if (blocked(x, z, .1) || Math.hypot(x - reverie.root.position.x, z - reverie.root.position.z) < .45) continue;
      if (onScreen) { v.set(x, .1, z).project(camera); if (Math.abs(v.x) > .75 || v.y < -.85 || v.y > .5 || v.z > 1) continue; }
      return { x, z };
    }
    return { x: (Math.random() - .5) * 1.2, z: .5 + Math.random() * .4 };
  }
  function obstacles() {
    const out = [...STILL, { x: reverie.root.position.x, z: reverie.root.position.z, r: .3 }];
    for (const i of world.room) if (i.y < .05 && i.r) out.push({ x: i.x, z: i.z, r: i.r });
    return out;
  }
  function blocked(x, z, r) { return obstacles().some(o => Math.hypot(x - o.x, z - o.z) < o.r + r); }
  const goTo = (to, s) => ({ x: to.x, z: to.z, s });

  /** Walks (or flies) towards target; true once there. */
  function travel(dt, to, speed, near = .06) {
    const p = where(), dx = to.x - p.x, dz = to.z - p.z, d = Math.hypot(dx, dz);
    if (d < near) { pet.move(dt, 0, { fly: flying > .5 }); return true; }
    const want = Math.atan2(dx, dz), turn = wrap(want - heading);
    heading += clamp(turn, -dt * 6, dt * 6);
    const sp = Math.min(speed, d * 3) * (Math.abs(turn) > 1.4 ? .3 : 1);
    let nx = p.x + Math.sin(heading) * sp * dt, nz = p.z + Math.cos(heading) * sp * dt;
    // slide round what is in the way
    for (const o of obstacles()) { const ox = nx - o.x, oz = nz - o.z, od = Math.hypot(ox, oz), r = o.r + .08; if (flying < .5 && od < r && od > 1e-4) { nx = o.x + ox / od * r; nz = o.z + oz / od * r; } }
    p.x = clamp(nx, BOUNDS.x0, BOUNDS.x1); p.z = clamp(nz, BOUNDS.z0, BOUNDS.z1);
    pet.rotation.y = heading;
    pose = '';
    pet.move(dt, sp, { fly: flying > .5, turn: clamp(turn, -1, 1) });
    return false;
  }
  function face(dt, x, z) { const p = where(); heading += clamp(wrap(Math.atan2(x - p.x, z - p.z) - heading), -dt * 5, dt * 5); pet.rotation.y = heading; }
  const faceCamera = dt => face(dt, camera.position.x, camera.position.z);
  function stand(dt, name = 'idle') { if (!play(name)) play('idle'); pet.rig.update(dt, { speed: 0 }); }

  function hearts(n = 4) { floaties.burst({ x: where().x, y: where().y + height + pet.size.height + .05, z: where().z }, { n }); }

  function update(dt) {
    t += dt;
    if (!pet) return;
    modeT += dt;
    const cheer = reverie.cheer ?? .5, walkS = pet.speeds.walk || .3, runS = pet.speeds.run || pet.speeds.trot || walkS * 2.2;
    // (in it pops, small to full size)
    if (pop < 1) { pop = Math.min(1, pop + dt * 2.5); const e = 1 + 2.2 * Math.pow(pop - 1, 3) + 1.2 * Math.pow(pop - 1, 2); pet.scale.setScalar(Math.max(.01, e) * base); }
        // things that change what it is doing, whatever it is doing
    const walking = world.walking, drowsy = reverie.drowsy && !world.game;
    if (walking && !wasWalking && !['trick', 'chase'].includes(mode)) setMode('follow');
    wasWalking = walking;
    if (drowsy && !wasDrowsy && mode !== 'trick') setMode('sleep');
    if (!drowsy && wasDrowsy && mode === 'sleep') { setMode('idle', { wait: .5 }); sound(1.2); }
    wasDrowsy = drowsy;
    if (!['chase', 'trick', 'sleep', 'greet'].includes(mode) && !world.game) {
      const thing = world.floorThings().find(e => !chased.has(e.pivot) || (chased.get(e.pivot) < 2 && e.body && Math.hypot(e.body.vel?.x || 0, e.body.vel?.z || 0) < .05 && modeT > 6));
      if (thing && thing.pivot.position.y < .6 && thing.pivot.position.x > BOUNDS.x0 && thing.pivot.position.x < BOUNDS.x1 && thing.pivot.position.z > BOUNDS.z0 && thing.pivot.position.z < BOUNDS.z1) {
        chases++; chasing = thing; chased.set(thing.pivot, (chased.get(thing.pivot) || 0) + 1); setMode('chase'); sound(1.4);
      }
    }
    // flying: birds and a dragon take off now and then and land again; a bee or butterfly never lands
    const flyWant = ALWAYS_FLY.has(about.like) ? 1 : (mode === 'flit' ? 1 : 0);
    flying += (flyWant - flying) * (1 - Math.exp(-dt * 2));
    const hover = ALWAYS_FLY.has(about.like) ? .45 + Math.sin(t * 1.3) * .08 : .6;
    height += ((flying > .05 ? hover * Math.min(1, flying * 1.5) : 0) - height) * (1 - Math.exp(-dt * 3));
    pet.position.y = height;

    if (label) {
      labelT -= dt; label.visible = labelT > 0;
      if (label.visible) { const k = Math.min(1, (2.6 - labelT) / .2, labelT / .3); label.scale.setScalar(Math.max(.01, k)); label.position.set(where().x, where().y + pet.size.height + .17, where().z); }
    }
    switch (mode) {
      case 'idle': {
        // standing about: looks at you, sits, sniffs, then off somewhere else (sooner the happier Reverie is)
        if (modeT < .1) wait = (2 + Math.random() * 4) * (1.3 - cheer * .6);
        const p = modeT < wait * .4 ? 'idle' : (idlePose ||= ['idle', 'sit', 'eat'][Math.floor(Math.random() * 3)]);
        stand(dt, p); if (modeT < 1.5) faceCamera(dt);
        if (modeT > wait) {
          idlePose = null;
          const r = Math.random();
          if (CAN_FLY.has(about.like) && r < .18) setMode('flit', { to: pickSpot() });
          else if (r < .12 + cheer * .18) setMode('zoom');
          else setMode('wander', { to: pickSpot() });
        }
        break;
      }
      case 'wander': case 'flit':
        if (travel(dt, target, (mode === 'flit' ? runS : cheer > .7 && Math.random() < .5 ? (pet.speeds.trot || walkS * 1.6) : walkS))) setMode('idle');
        break;
      case 'zoom': {
        // zoomies: a fast lap round a circle in front of Reverie
        const a = modeT * 2.6, R = .55, cx = reverie.root.position.x, cz = reverie.root.position.z + .3;
        travel(dt, { x: cx + Math.sin(a) * R, z: cz + Math.cos(a) * R * .7 }, runS, .01);
        if (modeT > 4.5) { setMode('idle'); hearts(2); }
        break;
      }
      case 'follow': {
        const r = reverie.root, back = { x: r.position.x - Math.sin(r.rotation.y) * .35 + .15, z: r.position.z - Math.cos(r.rotation.y) * .35 };
        if (travel(dt, back, runS, .12)) { stand(dt); face(dt, r.position.x, r.position.z); }
        if (!walking && modeT > 1) setMode('idle', { wait: 1 });
        break;
      }
      case 'chase': {
        const e = chasing, p = e?.pivot?.position;
        if (!p || !e.pivot.parent || modeT > 12) { setMode('idle'); break; }
        if (travel(dt, { x: p.x, z: p.z }, runS * (1 + cheer * .3), .12 + Math.max(e.pivot.userData.size?.x || .1, e.pivot.userData.size?.z || .1) * e.pivot.scale.x * .5)) {
          // there: a nose-boop that rolls it along, a munch, and pleased with itself
          const d = Math.max(.01, Math.hypot(p.x - where().x, p.z - where().z));
          e.body?.push?.((p.x - where().x) / d * .9, .9, (p.z - where().z) / d * .9);
          gs.sound.sounds.munch?.(1.4); play('jump', { once: true, again: true }); hearts(2);
          mood?.fun('pet', .4);
          setMode('idle', { wait: 1.5 });
        }
        break;
      }
      case 'greet': {
        // runs to the front to say hello, then hops
        const there = travel(dt, { x: .32, z: .75 }, runS, .08);
        if (there) { faceCamera(dt); if (!poseOnce) { poseOnce = 'jump'; play('jump', { once: true, again: true }); sound(1.3); hearts(3); } else if (pet.rig.done || modeT > 4) setMode('idle'); else pet.rig.update(dt, { speed: 0 }); }
        break;
      }
      case 'sleep': {
        // curled up by Reverie, a "z" now and then
        const r = reverie.root.position, spot = { x: r.x + .42, z: r.z + .18 };
        if (flying > .5 && ALWAYS_FLY.has(about.like)) { travel(dt, spot, walkS, .1); }
        else if (travel(dt, spot, walkS, .08)) {
          stand(dt, play('sit') ? 'sit' : 'idle');
          if ((zT -= dt) < 0) { zT = 2.4; floaties.burst({ x: where().x, y: where().y + pet.size.height + .04, z: where().z }, { kind: 'z', n: 1 }); }
        }
        break;
      }
      case 'patted': {
        if (modeT < .05) { play('jump', { once: true, again: true }); }
        faceCamera(dt); pet.rig.update(dt, { speed: 0 });
        if (pet.rig.done || modeT > 1.4) setMode('idle', { wait: 1.5 });
        break;
      }
      case 'trick': doTrick(dt); break;
      default: setMode('idle');
    }
    if (mode !== 'trick' || trickNow !== 'spin') pet.rotation.z += (0 - pet.rotation.z) * (1 - Math.exp(-dt * 8));
  }

  function doTrick(dt) {
    const k = trickNow;
    if (k === 'come') { if (travel(dt, { x: .25, z: .8 }, pet.speeds.run || .6, .08)) { faceCamera(dt); stand(dt, 'sit'); if (modeT > 3) setMode('idle'); } return; }
    if (k === 'zoomies') { setMode('zoom'); return; }
    if (k === 'sleep') { setMode('sleep'); return; }
    faceCamera(dt);
    if (k === 'spin') { heading += dt * 9; pet.rotation.y = heading; stand(dt, 'idle'); if (modeT > 1.4) { setMode('idle'); hearts(2); } return; }
    if (k === 'dance') {
      if (modeT < .05 || (pet.rig.done && modeT < 3)) { play('jump', { once: true, again: true }); heading += Math.PI * .5; }
      pet.rig.update(dt, { speed: 0 }); pet.rotation.y += (heading - pet.rotation.y) * (1 - Math.exp(-dt * 10));
      if (modeT > 3.2) { setMode('idle'); hearts(3); } return;
    }
    const pose = k === 'play_dead' ? 'dead' : k === 'jump' ? 'jump' : 'sit';
    if (modeT < .05) play(pose, { once: pose !== 'sit', again: true });
    pet.rig.update(dt, { speed: 0 });
    if (modeT > (pose === 'dead' ? 3.5 : pose === 'sit' ? 4 : 1.5)) { if (pose === 'dead') { play('jump', { once: true, again: true }); sound(1.5); } setMode('idle'); }
  }

  // ---- what it is told
  async function make({ animal, name, colour }) {
    const like = animalOf(animal || 'cat');
    if (!like) return { text: `Not done: "${animal}" is not an animal I can make a pet of. Some that work: cat, dog, fox, rabbit, mouse, panda, owl, duck, bee, butterfly, dragon, blob.`, error: true };
    const col = colour ? colourOf(colour, THREE) : null;
    if (colour && !col) return { text: `Not done: "${colour}" is not a colour I know.`, error: true };
    const a = { like, name: String(name || '').trim().slice(0, 24) || defaultName(like), ...(col ? { colour: col } : {}), born: Date.now() };
    const old = pet && about ? about.name : null;
    reverie.gesture?.('tada');
    let p; try { p = await build(a); } catch (e) { return { text: `It could not make the pet (${String(e?.message || e).slice(0, 80)}).`, error: true }; }
    if (pet) { pet.getWorldPosition(c); sparks?.(c, '#ffffff'); }
    // it appears just in front of Reverie with a sparkle, small and growing, then hops to say hello
    const r = reverie.root.position;
    put(p, a, { x: r.x + .22, z: r.z + .35, face: 0 });
    pop = 0; pet.scale.setScalar(.01 * base);
    sparks?.({ x: r.x + .22, y: .15, z: r.z + .35 }, '#ffd6f0');
    gs.sound.sounds.twinkle?.(); setTimeout(() => sound(1.2), 450);
    setMode('greet');
    save(a); mood?.fun('newpet'); showName();
    return `Made ${a.name}, a tiny ${col ? colour + ' ' : ''}${like}${kind() === 'insect' || ALWAYS_FLY.has(like) ? ' that flutters about' : ''}, as your pet. It is at your feet, will wander the room, chase things you throw, and is remembered next time.${old ? ` (${old} has gone off to live on a lovely farm of pets in the clouds.)` : ''}`;
  }
  function trick(name) {
    if (!pet) return { text: 'Not done: you have no pet yet. Make one with action make.', error: true };
    const k = String(name || '').toLowerCase().replace(/[\s-]+/g, '_').replace(/^roll_over$/, 'play_dead').replace(/^(lie_down|nap)$/, 'sleep').replace(/^(here|come_here)$/, 'come');
    if (!TRICKS.includes(k)) return { text: `Not done: tricks are ${TRICKS.join(', ')}.`, error: true };
    trickNow = k; setMode('trick'); mood?.fun('trick'); sound(1.1);
    return `${about.name} does ${k.replace('_', ' ')}.`;
  }
  const defaultName = like => {
    const N = ['Pip', 'Biscuit', 'Bean', 'Mochi', 'Pebble', 'Noodle', 'Button', 'Sprout', 'Waffle', 'Bramble', 'Toast', 'Fig'];
    return like === 'dragon' ? 'Ember' : like === 'bee' ? 'Bumble' : N[Math.floor(Math.random() * N.length)];
  };

  return {
    get pet() { return pet; },
    get about() { return about ? { ...about } : null; },
    get mode() { return mode; },
    /** Seconds it has been looked after (for tests). */
    get age() { return t; }, get modeT() { return modeT; },
    /** True while its name floats over it. */
    /** The trick it is doing, or the last one. */
    get trick() { return trickNow; },
    get nameShown() { return !!label?.visible; },
    /** Things it has chased (for tests). */
    get chases() { return chases; },
    get height() { return height; },
    update,
    /** Brings back the pet kept on this device, if there is one. */
    async restore() {
      const a = load(); if (!a || !animalOf(a.like)) return false;
      try { const p = await build(a); if (pet) return true; put(p, a, { ...pickSpot(true), face: 0 }); return true; } catch { return false; }
    },
    /** They've come back: it runs over to say hello. */
    greet() { if (pet && !world.game) setMode('greet'); },
    /** A tap: true if it hit the pet (it hops, with hearts). */
    tap(ray) {
      if (!pet) return false;
      c.copy(where()); c.y += height + pet.size.height * .5;
      if (ray.ray.distanceToPoint(c) > Math.max(.1, pet.size.length * .55)) return false;
      if (t - lastPat < .4) return true;
      setMode('patted'); sound(1.2); hearts(4); mood?.fun('pet'); showName();
      if (t - lastPat > 30) news(`[pet] They patted ${about.name}.`);
      lastPat = t;
      return true;
    },
    /** The pet tool: { action: make | trick | rename | away, animal, name, colour, trick }. Resolves a sentence. */
    async command(input = {}) {
      const act = String(input.action || 'make').toLowerCase();
      if (act === 'make') return make(input);
      if (act === 'trick') return trick(input.trick);
      if (!pet) return { text: 'Not done: you have no pet yet. Make one with action make.', error: true };
      if (act === 'rename') { const n = String(input.name || '').trim().slice(0, 24); if (!n) return { text: 'Not done: no name given.', error: true }; const old = about.name; about.name = n; save(about); sound(); showName(); return `${old} is now called ${n}.`; }
      if (act === 'away') {
        pet.getWorldPosition(c); sparks?.(c, '#ffffff'); gs.sound.sounds.pop();
        const n = about.name; pet.removeFromParent(); pet = null; about = null; save(null); if (label) label.visible = false, labelT = 0;
        return `${n} has gone off to a cosy pet farm in the clouds. You have no pet now.`;
      }
      return { text: `Not done: action must be make, trick, rename or away.`, error: true };
    },
    /** A line for Claude about the pet. */
    line() {
      if (!about) return '';
      const doing = { idle: 'pottering about', wander: 'wandering about', flit: 'flying about', zoom: 'doing zoomies', follow: 'trotting after you', chase: 'chasing something you threw', greet: 'running to say hello', sleep: 'curled up asleep beside you', patted: 'being patted', trick: 'doing a trick' }[mode] || 'about';
      return ` Your pet: ${about.name}, a tiny ${about.like}, ${doing}.`;
    },
  };
}
