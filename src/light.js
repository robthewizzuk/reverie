// The room's light: soft daylight from the big window in the left wall, as on a bright overcast-ish afternoon, the
// glow of the desk lamp, the glow of its core, and a lot of light bounced off the pale walls and floor. Lifelike means
// gentle: the sun no brighter than a room's window lets in, wide soft shadows (a big window is a big light), a fill
// that keeps the shade readable, neutral colour with only a touch of warmth, and no light beams or heavy film look.
import gs from '../engine/src/gamescroll.js';
import { backZ, WINDOW } from './shell.js';

// towards the sun: from the window on the left and a little in front, high enough that its patch lands round Reverie
export const SUN_DIR = [-.8, .62, .3];
// the opening in the left wall, its window (shell.js, with the room's shape)
export { WINDOW };
// the desk lamp's globe
export const LAMP = { x: 1.3, y: 1.12, z: backZ(1.3, .8) + .15 };

const CORE_LAMP = '#ff7020';     // the light its core casts, as made (moved with the glow colour)

/**
 * Lights the room in view v around the creature. roomBox: { min, max } of the room inside its walls. Call after the
 * room and the creature are made (so the room's reflections reach its eyes, glass dome and the things on the desk).
 * Returns { sun, lamp, bounce, room, update(dt, t), recolour() }. daylight.js moves the sun and lamp with the real day.
 */
export function lightRoom(v, creature, roomBox) {
  const { sun } = gs.hd;

  // Enable WebGPU ray tracing for reflections, direct shadow rays, and live ray-traced bounce light (GI).
  // (Uses the mutable HD object from hd3d.js dynamically so hd3d stays code-split; gs.hd.HD is a read-only view.)
  import('../engine/src/kit/hd3d.js').then(({ HD }) => {
    try {
      HD.traced = true;
      HD.tracePhones = true;
      HD.regen = true;
      HD.traceSunMap = false;
    } catch { /* fallback to defaults */ }
  }).catch(() => {});

  // the mood: photorealistic natural daylight with AgX filmic roll-off and subtle camera optics
  v.scene.background.set('#e9e3da');
  v.tone = 'agx';
  v.hemi.color.set('#f4f2ee'); v.hemi.groundColor.set('#b79a7c'); v.hemi.intensity = .32;
  v.envI = .62;
  // (a little variation over the walls and floor, so they don't look printed; no haze, mist or clouds indoors)
  v.air({ haze: 0, mist: 0, clouds: 0, wet: 0, macro: .45 });
  v.grade = { saturation: 1.02, contrast: 1.05, shadows: '#e0e4ee', highlights: '#fff6ea' };
  v.lut = null;
  v.exposure = 1.02; v.bloom = .28; v.glare = 0; v.shafts = .22; v.flare = null; v.beams = null;
  v.film = { halation: .16, grain: .45, fringe: .12 };
  v.focus = { at: 2.35, range: 1.45, depth: 1.8, blur: 1.8 };
  v.autoExposure = false;

  // daylight through the window: soft (a big window), not too strong, a near-white with a little warmth
  const s = sun('#fff2e2', 3.1, 4, SUN_DIR);
  s.softShadows(3); v.scene.add(s, s.target); v.onTier(T => s.setTier(T));

  // the desk lamp's globe: a small warm glow on the desk and the wall behind it, as a lamp on in daytime
  const lamp = { ...LAMP, col: '#ffd7a6', i: 1.25, reach: 1.9 };
  v.lampLights(6);
  // its core: a warm light on its hands, on what it holds and on the rug in front of it, brighter as it glows
  const core = v.flash(0, .3, .3, { keep: true, col: creature.glowed(CORE_LAMP), i: .5, reach: 1.1 });
  const at = new gs.hd.THREE.Vector3(), swell = {};

  // a soft light from beside the camera, as a film crew lights a face: a bright point in each eye, the shade lifted
  v.faceLight(creature.face3d, { strength: .16, side: .35, up: .3, colour: '#fff6ec' });

  // Live ray-traced bounce light (GI) across the room on WebGPU, with baked bounce & room probe as WebGL fallback,
  // plus soft contact shadows under its feet.
  v.liveBounce = { kind: 'traced', box: roomBox, spacing: .65 };
  const bounce = v.bounce(roomBox, { spacing: .8, bounces: 2, size: 8 });
  const reflections = v.room(roomBox, { strength: .88 });
  v.contact({ y: .026, size: 3, darkness: .9, opacity: .42, height: .7 });

  return {
    sun: s,
    /** Toggle shallow depth of field (relaxed during tabletop games so the whole board stays crisp). */
    setDof(on) { v.focus = on ? { at: 2.35, range: 1.45, depth: 1.8, blur: 1.8 } : null; },
    /** The desk lamp's light ({ i, reach, col }): daylight.js turns it up as the day goes. */
    lamp,
    /** How much of its core's light reaches the room (daylight.js turns it down at night, so the rug isn't orange). */
    coreK: 1,
    /** 0..1, set each frame while it dances (music.js): the core's light and the desk lamp swell on the beat. */
    pulse: 0,
    /** The bounce light and the room's reflections: bake() each again after the room changes. */
    bounce, room: reflections,
    update(dt, t) {
      creature.coreAt(at); core.at(at.x, at.y - .04, at.z + .2); core.i0 = (.2 + creature.coreGlow * .5) * this.coreK * (1 + this.pulse * .8);
      // (a gentle swell, not a disco: the lamp is a little brighter on each beat)
      v.placeLamps([this.pulse ? Object.assign(swell, lamp, { i: lamp.i * (1 + this.pulse * .35) }) : lamp], 0, .4, 0, t);
      s.follow(at.x, 0, at.z);
    },
    /** The core's light, after its glow colour changed. */
    recolour() { core.s.col = creature.glowed(CORE_LAMP); },
  };
}
