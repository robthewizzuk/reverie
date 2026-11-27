// The helpers in the room: each helper Reverie has out is a little glowing wisp circling above its head, bobbing
// faster while it works. One with news to tell sinks close and pulses; when its news is told it darts into Reverie's
// core with a burst of sparkles, and one that came back empty-handed drifts down and fades. Made before the first
// frame from a small pool of sprites with a glow drawn in code (no files), so nothing new is built mid-chat.
import gs from '../engine/src/gamescroll.js';

const POOL = 4;

export function makeWisps({ scene, creature, floaties }) {
  const { THREE } = gs.hd;
  const glow = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.18, 'rgba(255,255,255,.95)'); g.addColorStop(.4, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const pool = Array.from({ length: POOL }, (_, i) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false; s.renderOrder = 5; scene.add(s);
    return { s, id: null, phase: i * Math.PI * 2 / POOL, on: 0, state: 'off', t: 0, colour: new THREE.Color('#7fd8ff') };
  });
  const head = new THREE.Vector3(), core = new THREE.Vector3(), orbit = new THREE.Vector3();
  let want = [];   // [{ id, colour, state: 'working' | 'news' | 'home' | 'gone' }]
  let clock = 0;

  return {
    /** The helpers to show now (from helpers.js): the ones out, and the ones with news not yet told. */
    show(list) {
      want = list.filter(h => h.status === 'working' || (!h.told && h.status !== 'stopped') || (h.ended && Date.now() - h.ended < 4000))
        .slice(-POOL).map(h => ({ id: h.id, colour: h.colour || '#7fd8ff', state: h.status === 'working' ? 'working' : !h.told ? 'news' : h.status === 'failed' ? 'gone' : 'home' }));
      for (const w of pool) {
        const h = want.find(x => x.id === w.id);
        if (!h) { if (w.id && w.state !== 'home' && w.state !== 'gone') w.state = 'fade'; continue; }
        if (h.state !== w.state && (h.state === 'home' || h.state === 'gone')) w.t = 0;
        w.state = h.state; w.colour.set(h.colour);
      }
      for (const h of want) if (!pool.some(w => w.id === h.id)) {
        const w = pool.find(w => !w.id); if (!w) break;
        Object.assign(w, { id: h.id, state: h.state, on: 0, t: 0 }); w.colour.set(h.colour);
      }
    },
    update(dt) {
      clock += dt;
      creature.root.getWorldPosition(head); head.y += .74;
      creature.coreAt(core);
      for (const w of pool) {
        if (!w.id) continue;
        const s = w.s, k = 1 - Math.exp(-dt * 3);
        w.t += dt;
        const spin = w.state === 'working' ? 1.1 : .5, r = w.state === 'news' ? .2 : .3;
        const a = w.phase + clock * spin;
        orbit.set(head.x + Math.cos(a) * r, head.y + Math.sin(clock * 2.3 + w.phase) * .04 - (w.state === 'news' ? .08 : 0), head.z + Math.sin(a) * r * .6);
        let size = .095 + Math.sin(clock * (w.state === 'news' ? 7 : 3) + w.phase) * (w.state === 'news' ? .02 : .008);
        if (w.state === 'home') {
          // darts into its core, then a burst of sparkles in its colour
          const u = Math.min(1, w.t / .6);
          s.position.lerpVectors(s.position, core, u);
          size *= 1 - u * .6;
          if (u >= 1) { floaties?.burst({ x: core.x, y: core.y + .05, z: core.z + .05 }, { n: 5, colour: '#' + w.colour.getHexString(), size: .04 }); w.id = null; s.visible = false; continue; }
          w.on = 1;
        } else if (w.state === 'gone' || w.state === 'fade') {
          w.on = Math.max(0, w.on - dt * 1.2); s.position.y -= dt * .1;
          if (!w.on) { w.id = null; s.visible = false; continue; }
        } else {
          w.on += (1 - w.on) * k;
          s.position.lerp(orbit, w.t < .1 ? 1 : k * 1.5);
        }
        s.visible = true; s.scale.setScalar(size * (.4 + .6 * w.on));
        s.material.color.copy(w.colour); s.material.opacity = w.on * .95;
      }
    },
    get count() { return pool.filter(w => w.id).length; },
  };
}
