// Props that move like they're alive: a springy squash and stretch as they pop into its hands, land where it puts them
// and vanish, a wobble when tapped or bumped, and their own small movements from the engine (gs.models.bring: an animal
// breathes, a fan's blades turn, a flag flies, a ghost bobs, a candle burns, a lamp glows). Every prop's shape sits in a
// "flex" group at its base (flexFor), so it squashes onto the surface it stands on, not about its middle. Springs are the
// engine's exact ones (gs.camera.Spring), the same at any frame rate, and a prop at rest costs nothing a frame.
import gs from '../engine/src/gamescroll.js';

// how each move feels: freq (Hz) and damp (1 no overshoot, lower bouncier) of the three springs, and the kicks
export const FEEL = {
  size: { freq: 2.6, damp: .52 },   // its overall size: pops in past full size and back
  squash: { freq: 3.4, damp: .32 }, // up-and-down stretch (+) and squash (-), the width keeping its volume
  tilt: { freq: 2.2, damp: .2 },    // a rock about its base, for a wobble
  pop: .32,        // how tall it stretches as it appears
  land: -.26,      // how flat it squashes as it is set down
  lift: .16,       // the stretch as it is picked up
  poke: .22,       // how far a tap rocks it (radians)
  bump: .09,       // how far brushing past it rocks it
  vanish: { freq: 3, swell: .7 },   // shrinking away: how quick (Hz, about .35 s in all) and how much it swells first
  lights: 2,       // props that may light the room at once (a lamp, a candle): each is a light
  // how strong a prop's own light is in the room: about the desk lamp's, a small pool on what is near it. (The engine's
  // own, 6 reaching a couple of metres, is for a game's lantern outdoors; on a shelf against the pale wall at night it
  // burnt a big white blot into the wall and washed out everything round it.)
  glow: { i: 1, reach: 1.1 },
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** Wraps a prop's shape (already centred on its pivot) in a flex group whose origin is the middle of its base. */
export function flexFor(pivot, thing, size) {
  const { THREE } = gs.hd, flex = new THREE.Group();
  flex.name = 'flex'; flex.position.y = -size.y / 2; thing.position.y += size.y / 2;
  flex.add(thing); pivot.add(flex); pivot.userData.flex = flex; pivot.userData.thing = thing;
  return flex;
}

/** The scale a squash value gives: taller and thinner above 0, flatter and wider below, about the same volume. */
export function squashScale(q, k = 1) {
  const y = clamp(1 + q, .45, 1.8);
  return { y: y * k, xz: k / Math.sqrt(y) };
}

export function makeMotion({ view, fx, sound = () => {} }) {
  const { Spring } = gs.camera;
  const moving = new Set();   // entries whose springs are still going
  let lit = 0;

  // an entry's springs, made the first time it moves (recreated if a plain-JSON flexing object was loaded from storage)
  function springs(e) {
    if (e.flexing && typeof e.flexing.size?.update === 'function') return e.flexing;
    return e.flexing = { size: new Spring({ ...FEEL.size, x: 1, target: 1 }), squash: new Spring({ ...FEEL.squash }), tilt: new Spring({ ...FEEL.tilt }), dir: Math.random() * Math.PI * 2, spin: 0, gone: null, t: 0 };
  }
  function go(e) { moving.add(e); return springs(e); }

  // ---- their own small movements (gs.models.bring with no body: the stage's physics has its own box for each)
  function life(e, o = {}) {
    stop(e);
    const thing = e.pivot.userData.thing; if (!thing) return null;
    let f; try { f = gs.models.fits(thing); } catch { return null; }
    const flag = f.idle?.how === 'wave';
    const light = !!f.light && lit < FEEL.lights && o.still;
    if (!f.parts?.length && !(f.idle && (!flag || o.still)) && !f.fire && !light) return null;
    try {
      e.life = gs.models.bring(thing, view, false, { body: false, breaks: false, explodes: false, pickup: false, drive: false, light, fx, idle: flag && !o.still ? false : true });
    } catch { e.life = null; return null; }
    if (e.life.light) { lit++; e.life.lit = true; roomLight(e.life.light, f.light); }
    return e.life;
  }
  // a prop's light toned to the room's: as soft as the desk lamp (a fire or a torch a little more), and a short reach
  function roomLight(l, L) {
    if (l.i0 == null || !l.s) return;   // (a plain point light, on a view with no lamps: left as it is)
    l.i0 = FEEL.glow.i * clamp(L?.intensity ?? 1, .5, 1.6);
    l.s.reach = Math.min(l.s.reach, FEEL.glow.reach);
  }
  // stops them, keeping the thing itself (bring's remove() would take the thing away too)
  function stop(e) {
    const L = e.life; if (!L) return; e.life = null;
    L.fire?.remove?.(); L.light?.stop?.(); if (L.light?.isLight) L.light.removeFromParent();
    L.cloth?.dispose?.(); L.idleStop?.(); L.gone = true;
    if (L.lit) lit--;
    // a flag's sheet was hidden while its cloth flew
    if (L.fits?.idle?.how === 'wave') e.pivot.traverse(m => { if (m.isMesh && m.visible === false && !m.userData.flames) m.visible = true; });
  }

  const api = {
    FEEL,
    /** It pops into being: from nothing, past full size and back, stretching up as it comes. delay: seconds before it does. */
    appear(e, delay = 0) {
      const s = go(e); s.size.set(0); s.size.target = 1; s.squash.set(0); s.squash.shove(FEEL.pop); s.wait = delay; s.gone = null;
      api.apply(e);
    },
    /** It is set down: it squashes onto the surface and springs back up. */
    land(e, amount = 1) { const s = go(e); s.squash.shove(FEEL.land * amount); },
    /** It is picked up: a little stretch. */
    lift(e) { const s = go(e); s.squash.shove(FEEL.lift); },
    /** It rocks on its base (a tap, or something brushing past), with a little squash. */
    wobble(e, amount = FEEL.poke) { const s = go(e); s.dir = Math.random() * Math.PI * 2; s.tilt.shove(amount); s.squash.shove(-amount * .5); },
    /** It swells a touch, then shrinks away to nothing with a twist; then(e) runs when it has gone. delay: seconds before. */
    vanish(e, then = () => {}, delay = 0) {
      const s = go(e); if (s.gone) return;
      stop(e); s.gone = then; s.t = 0; s.wait = delay; s.size.damp = 1; s.size.freq = FEEL.vanish.freq; s.size.target = 0;
      s.size.push(FEEL.vanish.swell * FEEL.vanish.freq * Math.PI * 2); s.squash.shove(.18); s.spin = 9;   // (a critical spring pushed out first: it swells about 12%, then goes)
    },
    /** Starts its own small movements; still: it stands where it was put (a flag flies, a lamp may light the room). */
    life,
    /** Stops them (before it is carried off, changed or removed). */
    stop,
    /** Is it shrinking away? */
    going: e => !!e.flexing?.gone,
    /** Puts the springs on its flex group. */
    apply(e) {
      const s = e.flexing, flex = e.pivot.userData.flex; if (!s || !flex) return;
      const k = Math.max(0, s.size.x), q = squashScale(s.squash.x, k);
      flex.scale.set(q.xz, Math.max(1e-3, q.y), q.xz);
      flex.rotation.set(Math.sin(s.dir) * s.tilt.x, flex.rotation.y, Math.cos(s.dir) * s.tilt.x);
    },
    /** Each frame: the springs of whatever is moving, and the small movements of those that have them. */
    update(dt, all) {
      for (const e of moving) {
        const s = e.flexing;
        if (s.wait > 0) { s.wait -= dt; api.apply(e); continue; }
        s.size.update(dt); s.squash.update(dt); s.tilt.update(dt);
        if (s.gone) {
          s.t += dt; s.spin *= Math.exp(-dt * 2); const flex = e.pivot.userData.flex; if (flex) flex.rotation.y += s.spin * dt;
          if (s.size.x < .02 || s.t > 1) { moving.delete(e); const then = s.gone; e.flexing = null; stop(e); then(e); continue; }
        }
        api.apply(e);
        if (!s.gone && s.size.x === s.size.target && !s.squash.x && !s.squash.v && !s.tilt.x && !s.tilt.v) moving.delete(e);
      }
      for (const e of all) if (e.life && !e.life.gone) { try { e.life.update(dt); } catch { stop(e); } }
    },
    /** How many props are springing now (0 once all are at rest). */
    get busy() { return moving.size; },
    /** For a sound with it. */
    sound,
  };
  return api;
}
