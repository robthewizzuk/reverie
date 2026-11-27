// Little things that float up and fade: hearts when Reverie gets happier or its pet is patted, and a sleepy "z" over a
// pet that has curled up. Each is a sprite with a picture drawn in code on a small canvas (no image files), from a
// small pool, so a burst costs no new materials or draw calls past the few that are flying.
import gs from '../engine/src/gamescroll.js';

const POOL = 14;

function picture(THREE, draw) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); draw(x);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const heart = x => {
  x.fillStyle = '#ffffff'; x.beginPath();
  x.moveTo(32, 54); x.bezierCurveTo(6, 36, 4, 14, 20, 10); x.bezierCurveTo(27, 8, 31, 13, 32, 18);
  x.bezierCurveTo(33, 13, 37, 8, 44, 10); x.bezierCurveTo(60, 14, 58, 36, 32, 54); x.fill();
};
// a "z" as three strokes (no font)
const zed = x => { x.strokeStyle = '#ffffff'; x.lineWidth = 7; x.lineCap = x.lineJoin = 'round'; x.beginPath(); x.moveTo(18, 18); x.lineTo(46, 18); x.lineTo(18, 46); x.lineTo(46, 46); x.stroke(); };

/** makeFloaties(scene): burst(at, { kind, n, colour }), update(dt). */
export function makeFloaties(scene) {
  const { THREE } = gs.hd;
  const pics = { heart: picture(THREE, heart), z: picture(THREE, zed) };
  const pool = [];
  for (let i = 0; i < POOL; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pics.heart, transparent: true, depthWrite: false }));
    s.visible = false; s.renderOrder = 3; scene.add(s);
    pool.push({ s, t: 0, life: 0, vx: 0, vy: 0, vz: 0, size: 0, spin: 0 });
  }
  return {
    /** Sends up n of them from a point ({ x, y, z }); kind 'heart' or 'z'. */
    burst(at, { kind = 'heart', n = 5, colour = kind === 'z' ? '#cfe0ff' : '#ff7a9a', size = kind === 'z' ? .05 : .055, spread = .12, rise = .35 } = {}) {
      for (let i = 0; i < n; i++) {
        const p = pool.find(p => !p.life) || pool.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b));
        p.s.material.map = pics[kind]; p.s.material.color.set(colour); p.s.material.needsUpdate = true;
        p.s.position.set(at.x + (Math.random() - .5) * spread, at.y + Math.random() * .05, at.z + (Math.random() - .5) * spread * .5);
        p.vx = (Math.random() - .5) * .12; p.vy = rise * (.7 + Math.random() * .6); p.vz = (Math.random() - .5) * .05;
        p.t = -i * .09; p.life = 1.3 + Math.random() * .6; p.size = size * (.75 + Math.random() * .5); p.spin = (Math.random() - .5) * 1.5;
        p.s.visible = false;
      }
    },
    update(dt) {
      for (const p of pool) {
        if (!p.life) continue;
        p.t += dt; if (p.t < 0) continue;
        if (p.t >= p.life) { p.life = 0; p.s.visible = false; continue; }
        const u = p.t / p.life, s = p.s;
        s.visible = true;
        s.position.x += (p.vx + Math.sin(p.t * 5 + p.spin * 9) * .05) * dt; s.position.y += p.vy * dt * (1 - u * .5); s.position.z += p.vz * dt;
        // pops in, floats, fades
        const pop = Math.min(1, p.t / .18), k = p.size * (pop < 1 ? 1.25 * pop : 1 + .1 * Math.sin(p.t * 7));
        s.scale.set(k, k, k); s.material.rotation = Math.sin(p.t * 3) * .25 + p.spin * u;
        s.material.opacity = u < .7 ? 1 : 1 - (u - .7) / .3;
      }
    },
    get flying() { return pool.filter(p => p.life).length; },
    clear() { for (const p of pool) { p.life = 0; p.s.visible = false; } },
  };
}
