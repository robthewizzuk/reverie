// Reverie's windowsill garden: three little glazed pots on the sill under the round window, where it grows real
// plants with you, in real time. You plant a seed (ask Reverie, or tap an empty pot for a surprise one), water it
// (ask, or tap it: a tiny rain cloud puffs up over the pot), and over the next days it sprouts, puts out leaves, buds
// and flowers. Left dry it droops, gently, and perks straight back up with a drink: nothing ever dies. Tulips and
// daisies close up at night, a sunflower's head nods, and a glowbloom lights up in the dark. A flower or a ripe
// strawberry can be picked: it pops into Reverie's hands (made by the generator) and the plant grows another.
//
// All drawn in code, every plant from the same five shapes (a stem piece, a leaf, a petal, a ball and a pot), each
// one instanced mesh, so the whole garden is about six draws however much grows. plants.js keeps the numbers.
import gs from '../engine/src/gamescroll.js';
import { makePlants, KINDS, KIND_NAMES, POTS, kindOf, potIndex, potLine, droopOf, stageOf } from './plants.js';
import { FUN } from './mood.js';
import { colourOf } from './looks.js';
import * as room from './room.js';

// the garden's share of its mood (mood.js FUN: [joy, spark])
Object.assign(FUN, { plant: FUN.plant || [.04, .6], water: FUN.water || [.015, .35], bloom: FUN.bloom || [.05, .8], pick: FUN.pick || [.03, .5] });

// the sill under the round window in the back wall: room.js's SILL and onBoard (a point on it for an x) where the room
// has them, else the sill as world.js has built it: its ends, its top and the middle of its depth
const OLD_SILL = { x0: -.73, x1: .13, y: 1.145, z: -1.53 };
const onSill = x => room.SILL && room.onBoard ? room.onBoard(room.SILL, x) : [x, OLD_SILL.y, OLD_SILL.z];
const POT_R = .06, POT_H = .085, SOIL = .86;           // a pot's radius and height (metres), and where its soil is (0..1)
const BIG = 1.7;                                       // the plants drawn bigger than life, so they read from across the room
const POT_COLOURS = ['#efcfc2', '#c9dccb', '#d6d0ec'];   // blush, sage and lilac glaze
const LEAF = '#6fae5a', LEAF_DRY = '#b8a45e', STEM = '#6c9e52';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const sm = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const ease = (a, b, dt, s) => a + (b - a) * (1 - Math.exp(-dt / s));

/**
 * makeGarden({ world, onNews }): world is the stage (world.js: its view, creature, daylight, mood, make). onNews(text,
 * loud) hears what happens in the garden. Returns { update(dt), tap(x, y, w, h), command(input), line(), greet(), plants }.
 */
export function makeGarden({ world, sill = room.SILL || OLD_SILL, onNews = () => {} }) {
  const { THREE, pbr } = gs.hd, v = world.view, scene = v.scene, creature = world.creature;
  const plants = makePlants();
  const group = new THREE.Group(); group.name = 'garden'; scene.add(group);
  const fx = new gs.fx3d.Particles3D(scene);
  const mood = k => world.mood?.fun(k);

  // ---- the five shapes
  // a leaf or petal: a blade along +y (length 1, width 1 at its widest), cupped towards -z (up, once tilted out) and its
  // tip curled towards +z
  function blade(shape, cup, curl, nu = 7, nv = 4) {
    const pos = [], idx = [];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const u = i / nu, s = j / nv * 2 - 1, w = shape(u);
      pos.push(s * .5 * w, u, -cup * s * s * w + curl * u * u);
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, b = a + nv + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  const leafGeo = blade(u => Math.pow(Math.sin(Math.PI * Math.pow(u, .72)), .9), .22, .18);
  const petalGeo = blade(u => Math.pow(Math.sin(Math.PI * Math.pow(u, .5)), .6), .3, .1);
  const stemGeo = new THREE.CylinderGeometry(.5, .5, 1, 7, 1, true); stemGeo.translate(0, .5, 0);
  const ballGeo = new THREE.SphereGeometry(.5, 16, 10);
  const potShape = [[0, 0], [.7, 0], [.78, .025], [.84, .3], [.92, .7], [.99, .84], [1, .9], [.98, 1], [.9, 1], [.88, .93], [0, .93]];
  const potGeo = new THREE.LatheGeometry(potShape.map(([x, y]) => new THREE.Vector2(x, y)), 36);

  const many = (geo, mat, cap, shadow = true) => {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = true; m.count = 0;
    const white = new THREE.Color(1, 1, 1); for (let i = 0; i < cap; i++) m.setColorAt(i, white);
    group.add(m);
    return { mesh: m, n: 0, cap };
  };
  const side = THREE.DoubleSide;
  const parts = {
    pots: many(potGeo, pbr('#ffffff', { rough: .35, clear: .5 }), 3),
    stems: many(stemGeo, pbr('#ffffff', { rough: .6 }), 96),
    leaves: many(leafGeo, pbr('#ffffff', { rough: .55, side, sheen: .35, sheenColor: '#eaffd8', sheenRoughness: .5 }), 96),
    petals: many(petalGeo, pbr('#ffffff', { rough: .5, side, sheen: .5, sheenColor: '#ffffff', sheenRoughness: .4 }), 200),
    balls: many(ballGeo, pbr('#ffffff', { rough: .7 }), 160),
    glow: many(ballGeo, new THREE.MeshBasicMaterial({ color: '#ffffff' }), 24, false),
  };
  for (const p of Object.values(parts)) p.mesh.name = 'garden:' + Object.keys(parts).find(k => parts[k] === p);

  // ---- where each pot stands
  const mid = (sill.x0 + sill.x1) / 2, gap = Math.min(.29, (sill.x1 - sill.x0) / 3);
  const at = POTS.map((_, i) => new THREE.Vector3(...onSill(mid + (i - 1) * gap)));
  // what each pot looks like now (eased towards its numbers, so changes are seen happening)
  const looks = POTS.map((_, i) => ({ g: plants.pots[i]?.g ?? 0, droop: droopOf(plants.pots[i]), wet: plants.pots[i]?.water ?? 0, ripe: plants.pots[i]?.ripe ?? 0, pop: 1, phase: i * 2.1, top: .05, cloud: 0, rainAcc: 0, shake: 0 }));
  let drops = [];

  // ---- a little matrix maths, from a pool (no garbage each frame)
  const pool = []; let pi = 0;
  const M = () => (pool[pi] ||= new THREE.Matrix4(), pool[pi++].identity());
  const T = (x, y, z) => M().makeTranslation(x, y, z);
  const Rx = a => M().makeRotationX(a), Ry = a => M().makeRotationY(a), Rz = a => M().makeRotationZ(a);
  const S = (x, y, z) => M().makeScale(Math.max(1e-5, x), Math.max(1e-5, y), Math.max(1e-5, z));
  const mul = (...ms) => ms.reduce((a, b) => M().multiplyMatrices(a, b));
  const col = new THREE.Color(), c2 = new THREE.Color(), cache = new Map();
  const C = hex => { let c = cache.get(hex); if (!c) cache.set(hex, c = new THREE.Color(hex)); return c; };
  const mix = (a, b, k) => col.copy(C(a)).lerp(C(b), clamp(k));
  function emit(part, m, c) {
    if (part.n >= part.cap) return;
    part.mesh.setMatrixAt(part.n, m); part.mesh.setColorAt(part.n, c); part.n++;
  }
  const ball = (m, sx, sy, sz, c, part = parts.balls) => emit(part, mul(m, S(sx, sy, sz)), c);
  const leaf = (m, az, tilt, len, w, c) => len > 1e-4 && emit(parts.leaves, mul(m, Ry(az), Rx(tilt), S(w, len, (w + len) / 2)), c);
  function ring(m, n, len, w, open, c, rot = 0, part = parts.petals) {
    if (len < 1e-4) return;
    for (let i = 0; i < n; i++) emit(part, mul(m, Ry(rot + i * Math.PI * 2 / n), Rx(open), S(w, len, (w + len) / 2)), c);
  }
  // a stem: segs pieces, each bent a little more (bend, radians a piece, forwards), swaying; returns the joints
  let time = 0;
  // (drooping bends it over to one side, more towards the tip, so it reads from the front)
  let lean = 1;
  function stem(base, len, segs, bend, r, phase, c, droop = 0) {
    const nodes = [base], sl = len / segs;
    let m = base;
    r *= 1.35;   // (a little chunkier than life: soft and toy-like, as Reverie is)
    for (let k = 0; k < segs; k++) {
      const sway = Math.sin(time * 1.3 + phase + k * .5) * .01 * (k + 1) / segs, d = droop * (k + 1) / segs;
      m = mul(m, Rx(bend + d * .12 + sway), Rz(lean * d * .3 + sway * .7));
      if (sl > 1e-4) emit(parts.stems, mul(m, S(r * (1 - .35 * k / segs) * 2, sl * 1.12, r * (1 - .35 * k / segs) * 2)), c);
      m = mul(m, T(0, sl, 0)); nodes.push(m);
    }
    return nodes;
  }

  // ---- each kind of plant, drawn from its numbers. s: { g, open, droop, night, ripe, petal, leaf, stem, phase }
  const DRAW = {
    daisy(base, s) {
      const grow = sm((s.g - .05) / .6), hs = sm((s.g - .55) / .25);
      for (let j = 0; j < 6; j++) leaf(base, j * 1.05 + .3, 1.15 + s.droop * .45, .042 * sm((s.g - .08 - j * .035) / .15), .013, s.leaf);
      [[-.55, .22, .115], [0, .05, .135], [.7, .26, .12]].forEach(([az, lean, h], j) => {
        if (j && s.g < .3 + j * .08) return;   // (the side stems come up later)
        const n = stem(mul(base, Ry(az), Rx(lean)), h * grow, 4, .03, .0022, s.phase + j, s.stem, s.droop);
        const top = n[n.length - 1], head = mul(top, Rx(.45 + s.droop * .6));
        if (j === 1) cotyledons(top, s);
        if (hs < .02) return;
        if (s.open < .3) ball(head, .011 * hs, .012 * hs, .011 * hs, mix('#7fae5c', s.petal, s.open * 2));
        ring(head, 14, (.009 + .017 * s.open) * hs, .0075 * hs, .2 + s.open * 1.3, s.petalC, j);
        ball(mul(head, T(0, .002 * hs, 0)), .013 * hs, .006 * hs, .013 * hs, C('#f2c230'));
      });
      return .16 * grow;
    },
    tulip(base, s) {
      const grow = sm((s.g - .05) / .6), hs = sm((s.g - .5) / .3);
      leaf(base, .35, .32 + s.droop * .9, .085 * sm((s.g - .08) / .2), .026, s.leaf);
      leaf(base, .35 + Math.PI, .42 + s.droop * .9, .075 * sm((s.g - .14) / .2), .024, s.leaf);
      const n = stem(base, .165 * grow, 5, .012, .0028, s.phase, s.stem, s.droop), top = n[n.length - 1];
      cotyledons(top, s);
      if (hs < .02) return .17 * grow;
      const head = mul(top, Rx(s.droop * .7)), cupC = mix('#86b55e', s.petal, sm((s.g - .62) / .2));
      ring(head, 3, .033 * hs, .022 * hs, .1 + .32 * s.open, cupC, 0);
      ring(head, 3, .031 * hs, .021 * hs, .06 + .22 * s.open, c2.copy(cupC).multiplyScalar(.92), Math.PI / 3);
      return .2 * grow;
    },
    strawberry(base, s) {
      const grow = sm((s.g - .05) / .5), hs = sm((s.g - .55) / .25);
      for (let j = 0; j < 5; j++) {
        const ls = sm((s.g - .06 - j * .06) / .2); if (ls < .02) continue;
        const n = stem(mul(base, Ry(j * 1.26 + .4), Rx(.42)), .05 * ls * (j % 2 ? .85 : 1), 3, .14, .0018, s.phase + j, s.stem, s.droop), top = n[n.length - 1];
        for (const az of [-.95, 0, .95]) leaf(top, az, .95 + s.droop * .5, .024 * ls, .021, s.leaf);
      }
      cotyledons(base, s);
      if (hs < .02) return .07 * grow;
      for (let j = 0; j < 2; j++) {
        const n = stem(mul(base, Ry(.9 + j * 2.7), Rx(.65)), .058 * hs, 3, .2, .0013, s.phase + 4 + j, s.stem, s.droop), top = n[n.length - 1];
        if (s.ripe < .25) {
          const head = mul(top, Rx(.4)), o = s.open * (1 - sm(s.ripe / .25));
          ring(head, 5, .009 * hs * (.5 + .5 * o), .008 * hs, .3 + 1.15 * o, s.petalC, j);
          ball(head, .006 * hs, .004 * hs, .006 * hs, C('#f2c230'));
        }
        if (s.ripe > .05) {
          const k = .45 + .55 * s.ripe, berry = mul(top, Rx(2.6), T(0, .012 * k, 0));
          ball(berry, .015 * k, .02 * k, .015 * k, s.ripe < .5 ? mix('#9ccc6a', '#f6efd8', s.ripe * 2) : mix('#f6efd8', '#e8344a', (s.ripe - .5) * 2.2));
          for (const az of [0, 2.1, 4.2]) leaf(mul(top, Rx(2.6)), az, 1.3, .007 * k, .005 * k, s.leaf);
        }
      }
      return .09 * grow;
    },
    sunflower(base, s) {
      const grow = sm((s.g - .05) / .62), hs = sm((s.g - .5) / .3);
      const n = stem(base, .27 * grow, 6, .016, .0045, s.phase, s.stem, s.droop), top = n[n.length - 1];
      for (let j = 1; j < 6; j++) leaf(n[j], j * Math.PI + .5, 1.0 + s.droop * .6, .048 * sm((s.g - .06 - j * .07) / .2) * (1 - j * .07), .042, s.leaf);
      cotyledons(top, s);
      if (hs < .02) return .31 * grow;
      const head = mul(top, Rx(.95 + s.night * .25 + s.droop * .55), T(0, .004 * hs, 0)), bud = mix('#7fae5c', s.petal, sm((s.g - .72) / .15));
      ring(head, 9, .024 * hs, .016 * hs, .5 + .9 * s.open, C('#6a9c4e'), .2, parts.leaves);   // (the green bracts behind the petals)
      ring(head, 16, (.014 + .024 * s.open) * hs, .011 * hs, .25 + 1.2 * s.open, s.open > .2 ? s.petalC : bud);
      ring(head, 16, (.012 + .02 * s.open) * hs, .01 * hs, .2 + 1.12 * s.open, s.open > .2 ? c2.copy(s.petalC).multiplyScalar(.93) : bud, Math.PI / 16);
      const disc = .034 * hs * (.45 + .55 * s.open);
      ball(mul(head, T(0, .004 * hs, 0)), disc, .012 * hs, disc, C('#6b4528'));
      return .3 * grow;
    },
    glowbloom(base, s) {
      const grow = sm((s.g - .05) / .6), hs = sm((s.g - .5) / .3), lit = (.5 + 2.6 * s.night) * hs;
      const n = stem(base, .2 * grow, 6, .13 * grow, .0028, s.phase, s.stem, s.droop), top = n[n.length - 1];
      for (let j = 0; j < 4; j++) leaf(n[j], j * 2.4 + .4, .85 + s.droop * .6, .045 * sm((s.g - .07 - j * .06) / .2), .011, s.leaf);
      cotyledons(top, s);
      for (const j of [2, 3, 4]) if (s.g > .3 + j * .05) ball(mul(n[j], Ry(j * 2), T(.006, 0, 0)), .006, .006, .006, c2.copy(s.petalC).multiplyScalar(.6 + lit * .8), parts.glow);
      if (hs < .02) return .2 * grow;
      const head = mul(top, Rx(1.2 + s.droop * .5));
      ring(head, 5, .032 * hs, .02 * hs, .35 + .35 * s.open, s.petalC);
      ball(mul(head, T(0, .012 * hs, 0)), .016 * hs, .016 * hs, .016 * hs, c2.copy(s.petalC).lerp(C('#ffffff'), .5).multiplyScalar(.5 + lit), parts.glow);
      return .2 * grow;
    },
    cactus(base, s) {
      const grow = sm((s.g - .04) / .7), r = .012 + .026 * grow, hs = sm((s.g - .6) / .25), sq = 1 - s.droop * .15;
      const body = mul(base, T(0, r * .95 * sq, 0)), green = mix('#5f9e6e', '#a8a35c', s.droop * .6), c3 = cCactus.copy(green);
      if (s.g < .04) return .01;
      ball(body, r * 1.9, r * 2.2 * sq, r * 1.9, c3);
      for (let j = 0; j < 8; j++) ball(mul(body, Ry(j * Math.PI / 4), T(r * .72, 0, 0)), r * .45, r * 2.05 * sq, r * .45, c2.copy(c3).multiplyScalar(1.06));
      for (let j = 0; j < 14; j++) ball(mul(body, Ry(j * 2.4), Rz(-.9 + (j % 5) * .45), T(r * .98, 0, 0)), .0025, .0025, .0025, C('#fbf5e8'));
      if (s.g > .45) { const k = sm((s.g - .45) / .2), arm = mul(body, Ry(.6), T(r * .95, r * .1, 0)); ball(arm, r * .9 * k, r * 1.1 * k * sq, r * .9 * k, c3); }
      if (hs > .02) {
        const head = mul(body, T(0, r * 1.05 * sq, 0));
        ring(head, 11, (.008 + .01 * s.open) * hs, .007 * hs, .3 + .8 * s.open, s.petalC);
        ball(head, .006 * hs, .005 * hs, .006 * hs, C('#ffe07a'));
      }
      return r * 2.3 + .03 * hs;
    },
  };
  // a sprout's first two round leaves, there from its first day until its real leaves take over
  function cotyledons(top, s) {
    const c = sm((s.g - .03) / .05) * (1 - sm((s.g - .28) / .12));
    if (c < .02) return;
    leaf(top, 0, 1.15 + s.droop * .4, .012 * c, .01 * c, C('#9ccf6e'));
    leaf(top, Math.PI, 1.15 + s.droop * .4, .012 * c, .01 * c, C('#9ccf6e'));
  }

  // ---- drawn each frame (reusing scratch colours and skipping GPU buffer uploads when all pots are empty & still)
  const cPetal = new THREE.Color(), cLeaf = new THREE.Color(), cStem = new THREE.Color(), cCactus = new THREE.Color();
  const partList = Object.values(parts);
  let drawnStaticEmpty = false;
  function draw(dt) {
    const anyPlant = plants.pots.some(Boolean);
    const anyAnim = drops.length > 0 || looks.some(L => L.shake > 0 || L.cloud > 0 || Math.abs(L.pop - 1) > 1e-3 || L.wet > 1e-3);
    if (!anyPlant && !anyAnim && drawnStaticEmpty) return;
    drawnStaticEmpty = !anyPlant && !anyAnim;
    pi = 0; for (const p of partList) { p.prevN = p.n; p.n = 0; }
    const night = world.daylight?.state?.night ?? 0;
    plants.pots.forEach((p, i) => {
      const L = looks[i], base0 = at[i];
      L.shake = Math.max(0, L.shake - dt);
      const wob = Math.sin(L.shake * 30) * L.shake * .25, pop = L.pop = ease(L.pop, 1, dt, .12);
      const pot = mul(T(base0.x, base0.y, base0.z), Rz(wob * .3), S(POT_R, POT_H, POT_R));
      emit(parts.pots, pot, C(POT_COLOURS[i]));
      L.wet = ease(L.wet, p ? p.water : 0, dt, 1.2);
      // soil, darker when wet
      const soilY = base0.y + POT_H * SOIL;
      ball(mul(T(base0.x, soilY, base0.z), Rz(wob * .3)), POT_R * 1.78, .008, POT_R * 1.78, mix('#9a7658', '#4d3526', clamp(L.wet * 1.6)));
      if (!p) { L.top = .02; return; }
      const k = KINDS[p.kind];
      L.g = ease(L.g, p.g, dt, .6); L.ripe = ease(L.ripe, p.ripe || 0, dt, .6);
      // drooping comes on slowly; a drink perks it up in a couple of seconds
      const d = droopOf(p); L.droop = ease(L.droop, d, dt, d < L.droop ? .9 : 4);
      const closes = p.kind === 'tulip' || p.kind === 'daisy' || p.kind === 'strawberry';
      const open = sm((L.g - .8) / .2) * (closes ? 1 - .75 * night : 1) * (1 - L.droop * .45);
      const petal = p.colour || k.petals;
      cPetal.copy(mix(petal, '#b89a6a', L.droop * .35));
      cLeaf.copy(mix(p.kind === 'glowbloom' ? '#5e9e8c' : LEAF, LEAF_DRY, L.droop * .55));
      cStem.copy(mix(STEM, LEAF_DRY, L.droop * .4));
      const s = { g: L.g, open, droop: L.droop, night, ripe: L.ripe, phase: L.phase, petal, petalC: cPetal, leaf: cLeaf, stem: cStem };
      // the seed, sitting on the soil until it sprouts
      const base = mul(T(base0.x, soilY + .003, base0.z), Rz(wob), S(pop * BIG, pop * BIG, pop * BIG));
      if (L.g < .07) ball(base, .009, .006, .007, C('#7a5634'));
      lean = [1, .7, -1][i];
      L.top = (DRAW[p.kind](base, s) || .05) * BIG;
    });
    for (const p of partList) {
      p.mesh.count = p.n;
      if (p.n > 0 || p.prevN > 0) {
        p.mesh.instanceMatrix.needsUpdate = true;
        if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  // ---- watering: a little cloud puffs up over the pot and rains on it
  const cloudY = i => at[i].y + POT_H + clamp(looks[i].top * (1 - looks[i].droop * .3), .1, .3) + .04;
  function rainOn(i) {
    const L = looks[i];
    L.cloud = 2.6; L.shake = .3; drawnStaticEmpty = false;
    gs.sound.sounds.splash?.();
    setTimeout(() => gs.sound.sounds.splash?.(), 700);
  }
  function clouds(dt) {
    if (!drops.length && !looks.some(L => L.cloud > 0)) return;
    for (const d of drops) { d.vy -= 3 * dt; d.y += d.vy * dt; if (d.y > d.end) ball(T(d.x, d.y, d.z), .008, .018, .008, C('#6aa6e8')); }
    if (drops.length) drops = drops.filter(d => d.y > d.end);
    looks.forEach((L, i) => {
      if (L.cloud <= 0) return;
      L.cloud -= dt;
      const k = sm(Math.min(2.6 - L.cloud, L.cloud) / .35), p = at[i], y = cloudY(i);
      // its rain: drops falling from under it to the soil (solid little beads, so they read against a bright window)
      if (L.cloud > .5) for (L.rainAcc += dt * 45; L.rainAcc >= 1; L.rainAcc--) drops.push({ x: p.x + (Math.random() - .5) * .07, z: p.z + (Math.random() - .5) * .05, y: y - .02, vy: -.3, end: p.y + POT_H * SOIL });
      if (L.cloud <= 0) return;
      const base = T(p.x + Math.sin(time * 2) * .004, y, p.z);
      for (const [x, yy, r] of [[-.028, 0, .026], [.026, .002, .028], [0, .016, .034], [.006, -.005, .03]]) ball(mul(base, T(x * k, yy * k, 0)), r * 2.1 * k, r * 1.7 * k, r * 1.8 * k, C('#f6f8fb'));
    });
    parts.balls.mesh.count = parts.balls.n;
    parts.balls.mesh.instanceMatrix.needsUpdate = true;
    if (parts.balls.mesh.instanceColor) parts.balls.mesh.instanceColor.needsUpdate = true;
  }

  // ---- what happens, told to Reverie
  const nameOf = p => p.name ? `${p.name} the ${p.kind}` : `the ${p.kind}`;
  function tell(events, loud) {
    const said = [];
    for (const e of events) {
      const p = plants.pots.find(q => q?.id === e.id); if (!p) continue;
      const n = nameOf(p);
      if (e.what === 'sprouted') said.push(`${n} has sprouted`);
      else if (e.what === 'budded') said.push(`${n} has a bud`);
      else if (e.what === 'bloomed') said.push(`${n} has flowered${KINDS[p.kind].ripen ? '' : ' (it can be picked)'}`);
      else if (e.what === 'ripe') said.push(`${n} has a ripe strawberry to pick`);
      else if (e.what === 'thirsty') said.push(`${n} is getting thirsty`);
      else if (e.what === 'drooping') said.push(`${n} is drooping and needs water`);
    }
    if (said.length) onNews(`[garden] ${[...new Set(said)].join('; ')}.`, loud);
    for (const e of events) if (e.what === 'bloomed' || e.what === 'ripe') {
      const i = plants.pots.findIndex(q => q?.id === e.id), p = at[i];
      if (i >= 0) { fx.sparks({ x: p.x, y: p.y + POT_H + looks[i].top, z: p.z + .02 }, { color: '#ffe8a0', count: 16, power: .3, light: false }); mood('bloom'); }
    }
  }

  // ---- doing things (Claude's garden tool, and taps)
  function plantIn(i, kind, o = {}) {
    const p = plants.plant(kind, { pot: i, name: o.name, colour: o.colour });
    if (!p) return null;
    const L = looks[i]; L.g = 0; L.droop = 0; L.ripe = 0; L.pop = .01; L.wet = 1;
    const a = at[i]; fx.sparks({ x: a.x, y: a.y + POT_H, z: a.z + .02 }, { color: '#bfe8a0', count: 18, power: .35, light: false });
    gs.sound.sounds.pop?.(); creature.gesture('tada'); mood('plant');
    return p;
  }
  function waterIn(i) {
    const need = plants.water(i);
    rainOn(i); mood('water');
    return need;
  }
  const which = (words, test) => { const i = potIndex(words, plants.pots); return i >= 0 ? i : plants.pots.findIndex(test); };

  async function command(input = {}) {
    const act = String(input.action || '').toLowerCase(), pots = plants.pots;
    plants.tick();
    if (act === 'plant') {
      const kind = kindOf(input.plant || input.seed || 'flower');
      if (!kind) return { text: `Not planted: there are no "${input.plant}" seeds. Seeds you have: ${KIND_NAMES.join(', ')}.`, error: true };
      let i = input.pot ? potIndex(input.pot, pots) : pots.findIndex(q => !q);
      if (i < 0) return { text: `Not planted: all three pots are full (${pots.map(q => nameOf(q)).join(', ')}). Dig one up first, or pick another pot.`, error: true };
      if (pots[i]) return { text: `Not planted: the ${POTS[i]} pot already has ${nameOf(pots[i])} in it. Dig it up first, or use another pot.`, error: true };
      const colour = input.colour ? colourOf(input.colour, THREE) : null;
      const p = plantIn(i, kind, { name: input.name, colour });
      return `Planted ${KINDS[kind].about} seed${p.name ? ` called ${p.name}` : ''} in the ${POTS[i]} pot on the windowsill, and watered it in. It grows in real time: a sprout by tomorrow, flowers in about ${KINDS[kind].days} days if they water it every day or so.`;
    }
    if (act === 'water') {
      const all = !input.pot || /\b(all|every|them|both)\b/i.test(input.pot);
      const list = all ? pots.map((q, i) => q ? i : -1).filter(i => i >= 0) : [potIndex(input.pot, pots)].filter(i => i >= 0 && pots[i]);
      if (!list.length) return { text: all ? 'Nothing to water: the pots are empty. Plant something first.' : `Not watered: no plant matches "${input.pot}".`, error: true };
      creature.gesture('point');
      const done = list.map((i, n) => { const need = pots[i].water, d = droopOf(pots[i]); setTimeout(() => waterIn(i), n * 450); return `${nameOf(pots[i])} (${d > .3 ? 'it was drooping and perks right up' : need < .25 ? 'it was thirsty' : need > .8 ? 'it had plenty already' : 'nicely'})`; });
      return `Watered ${done.join(', ')}. One watering lasts about a day and a half.`;
    }
    if (act === 'pick') {
      const i = which(input.pot, q => q && (KINDS[q.kind].ripen ? q.ripe >= 1 : q.g >= 1));
      const p = pots[i];
      if (!p) return { text: 'Nothing to pick yet: no plant is in flower.', error: true };
      if (!plants.pick(i)) return { text: `Not picked: ${nameOf(p)} is ${stageOf(p.g)}${KINDS[p.kind].ripen ? ', and its strawberries are not ripe yet' : ''}.`, error: true };
      const a = at[i]; fx.sparks({ x: a.x, y: a.y + POT_H + looks[i].top, z: a.z + .02 }, { color: '#ffe8a0', count: 20, power: .4, light: false }); mood('pick');
      const words = p.colour && !KINDS[p.kind].ripen ? `a ${input.colour || ''} ${KINDS[p.kind].pick.replace(/^an? /, '')}`.replace(/\s+/g, ' ') : KINDS[p.kind].pick;
      const r = await world.make(words);
      return `Picked ${KINDS[p.kind].ripen ? 'a strawberry' : 'a flower'} from ${nameOf(p)}; it will grow another in a day or two. ${r}`;
    }
    if (act === 'dig_up') {
      const i = potIndex(input.pot, pots);
      if (i < 0 || !pots[i]) return { text: `Not dug up: name the pot (left, middle, right) or the plant. In the pots: ${pots.map((q, j) => `${POTS[j]}: ${q ? nameOf(q) : 'empty'}`).join(', ')}.`, error: true };
      const p = plants.dig(i), a = at[i];
      fx.sparks({ x: a.x, y: a.y + POT_H, z: a.z }, { color: '#c8a27a', count: 16, power: .3, light: false }); gs.sound.sounds.pop?.();
      return `Dug up ${nameOf(p)}; the ${POTS[i]} pot is empty again.`;
    }
    if (act === 'rename') {
      const i = which(input.pot, q => q);
      if (!pots[i] || !input.name) return { text: 'Not renamed: say which plant and its new name.', error: true };
      const old = nameOf(pots[i]); plants.rename(i, input.name);
      return `${old} is now called ${pots[i].name}.`;
    }
    return { text: 'action must be plant, water, pick, dig_up or rename.', error: true };
  }

  // ---- taps: a planted pot is watered; an empty one gets a surprise seed
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), box = new THREE.Box3();
  function tap(x, y, w, h) {
    ndc.set(x / w * 2 - 1, -(y / h) * 2 + 1); ray.setFromCamera(ndc, v.cam);
    for (let i = 0; i < 3; i++) {
      const a = at[i], top = Math.max(.08, looks[i].top + POT_H + .02);
      box.min.set(a.x - .085, a.y - .01, a.z - .08); box.max.set(a.x + .085, a.y + top, a.z + .08);
      if (!ray.ray.intersectsBox(box)) continue;
      const p = plants.pots[i];
      if (p) { const d = droopOf(p), need = p.water; waterIn(i); onNews(`[garden] They watered ${nameOf(p)}${d > .3 ? ', which was drooping and perks right up' : need < .25 ? ', which was thirsty' : ''}.`, d > .3); }
      else {
        const kind = KIND_NAMES[Math.floor(Math.random() * KIND_NAMES.length)];
        plantIn(i, kind);
        onNews(`[garden] They tapped the empty ${POTS[i]} pot and planted a surprise seed. It is a ${kind} seed, but keep it a surprise: let them guess what it will grow into.`, true);
      }
      return true;
    }
    return false;
  }

  let tickIn = 5;
  return {
    plants, group, at, fx,
    update(dt) {
      time += dt;
      if ((tickIn -= dt) < 0) { tickIn = 10; const ev = plants.tick(); if (ev.length) tell(ev, ev.some(e => e.what === 'bloomed' || e.what === 'ripe')); }
      draw(dt); clouds(dt);
      fx.update(dt);
    },
    tap, command,
    /** The garden in a line for Claude (each turn). */
    line() {
      const pots = plants.pots;
      if (!pots.some(Boolean)) return ' Your windowsill garden: three empty pots on the sill under the round window, ready for seeds.';
      return ` Your windowsill garden: ${pots.map((p, i) => `${POTS[i]} pot: ${potLine(p)}`).join('; ')}.`;
    },
    /** What happened in the garden while they were away (once, when it wakes), as news, or ''. */
    greet() {
      const ev = plants.away.splice(0);
      const thirsty = plants.pots.filter(p => p && p.water < .25 && !ev.some(e => e.id === p.id && (e.what === 'thirsty' || e.what === 'drooping')));
      for (const p of thirsty) ev.push({ id: p.id, what: droopOf(p) >= .5 ? 'drooping' : 'thirsty' });
      if (ev.length) tell(ev, false);
    },
    /** Time passes faster (tests): every pot `hours` on, its news told. */
    skip(hours) { const ev = plants.skip(hours); tell(ev, false); return ev; },
  };
}
