// Sleepy Reverie: late at night (on your own clock, daylight.js lateness) it dozes off sooner when left alone, yawns
// more (body.js), and while it dozes little soft Z's drift up from its head and fade. Made before the first frame and
// hidden until wanted (one small picture, three sprites), so nothing is built mid-chat.
import gs from '../engine/src/gamescroll.js';
import { lateness } from './daylight.js';

export function makeSleepy({ scene, creature }) {
  const { THREE } = gs.hd;
  const tex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    x.font = '600 52px ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineJoin = 'round'; x.lineWidth = 8; x.strokeStyle = 'rgba(70,80,120,.35)'; x.strokeText('z', 32, 34);
    x.fillStyle = '#f4f1ff'; x.fillText('z', 32, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const zs = [0, 1, 2].map(i => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false; s.renderOrder = 6; scene.add(s); return { s, t: i / 3 };
  });
  const head = new THREE.Vector3();
  let on = 0, late = 0, lateT = 0;
  return {
    /** How sleepy the hour is, 0..1 (read every half minute). */
    get late() { return late; },
    update(dt) {
      if ((lateT -= dt) <= 0) { lateT = 30; late = lateness(); }
      // Z's while it dozes at night (by day it only goes drowsy-eyed, no Z's)
      on += ((creature.drowsy && late > .3 ? 1 : 0) - on) * (1 - Math.exp(-dt * 1.5));
      const show = on > .02;
      if (!show) { for (const z of zs) z.s.visible = false; return; }
      creature.root.getWorldPosition(head); head.y += .62;
      for (const z of zs) {
        z.t = (z.t + dt / 3.6) % 1;
        const k = z.t, s = .045 + k * .06;
        z.s.visible = true; z.s.scale.set(s, s, 1);
        z.s.position.set(head.x + .1 + k * .14 + Math.sin(k * 6 + z.t) * .02, head.y + k * .32, head.z + .05);
        z.s.material.opacity = on * Math.sin(k * Math.PI) * .9;
      }
    },
  };
}
