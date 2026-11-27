// Little things the table games share: a low wooden table in front of the creature, a clock of tweens run from
// update(dt) (a stop drops them all), and the pop-in curve. Chess and the quiz have their own copies from before.
import gs from '../../engine/src/gamescroll.js';

/** The springy grow-in, 0 to 1 (overshoots a little). */
export const popIn = k => Math.max(.01, 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2));
export const ease = k => k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

/**
 * A low wooden table, w x d metres, its top at h: a THREE.Group standing on the floor at its middle.
 * userData.top is the height of the table top.
 */
export function table(THREE, { w = .72, d = .5, h = .3 } = {}) {
  const { wood } = gs.tabletop, { rbox } = gs.hd;
  const g = new THREE.Group(), top = wood('#7a5234', { repeat: [2, 1] }), legs = wood('#5d3d25');
  const tt = new THREE.Mesh(rbox(w, .04, d, .015), top); tt.position.y = h - .02; g.add(tt);
  const lx = w / 2 - .05, lz = d / 2 - .05;
  for (const [x, z] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]]) { const l = new THREE.Mesh(rbox(.04, h - .04, .04, .01), legs); l.position.set(x, (h - .04) / 2, z); g.add(l); }
  g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  g.userData.top = h; g.userData.legs = legs;
  return g;
}

/** Tweens on a clock: tween(seconds, k => ...) resolves true when it ran to the end, false (at once) when dropped by stop(). */
export function clock() {
  let list = [], epoch = 0;
  return {
    get epoch() { return epoch; },
    tween(dur, fn) { const my = epoch; return new Promise(res => list.push({ t: 0, dur, fn, done: () => res(my === epoch) })); },
    wait(s) { return this.tween(s, () => {}); },
    // (dropped tweens resolve false at once, so nothing awaiting one is left hanging, such as a spoken move Claude waits on)
    stop() { epoch++; const old = list; list = []; for (const tw of old) tw.done(); },
    update(dt) {
      for (const tw of list) { tw.t += dt; tw.fn(Math.min(1, tw.t / tw.dur), tw.t); }
      const done = list.filter(tw => tw.t >= tw.dur); list = list.filter(tw => tw.t < tw.dur); for (const tw of done) tw.done();
    },
  };
}

/** Normalised words for matching what someone said: lower case, letters and digits, single spaces. */
export const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();
