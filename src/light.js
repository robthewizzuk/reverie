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
// actual wall sconce lights mounted above the shelves (pulled slightly out from the wall so they illuminate the shelves cleanly without burning hotspots onto the plaster)
export const LAMP = { x: 1.09, y: 1.50, z: backZ(1.09, 1.50) + .28 };
export const SHELF_LAMP = { x: -.94, y: 1.13, z: backZ(-.94, 1.13) + .28 };

const CORE_LAMP = '#ff7020';     // the light its core casts, as made (moved with the glow colour)

/**
 * Lights the room in view v around the creature. roomBox: { min, max } of the room inside its walls. Call after the
 * room and the creature are made (so the room's reflections reach its eyes, glass dome and the things on the desk).
 * Returns { sun, lamp, bounce, room, update(dt, t), recolour() }. daylight.js moves the sun and lamp with the real day.
 */
export function lightRoom(v, creature, roomBox) {
  const { sun } = gs.hd;

  // Let the engine enable WebGPU ray tracing automatically on capable desktop GPUs without forcing it on phones
  // (forcing HD.tracePhones pushes mobile GPUs over budget and causes adaptive quality to drop 3D resolution).
  import('../engine/src/kit/hd3d.js').then(({ HD }) => {
    try {
      HD.traced = null;
      HD.tracePhones = false;
      HD.regen = true;
    } catch { /* fallback to defaults */ }
  }).catch(() => {});

  // the mood: crisp natural daylight with AgX filmic roll-off and no blur/fringe softening
  v.scene.background.set('#e9e3da');
  v.tone = 'agx';
  v.hemi.color.set('#f4f2ee'); v.hemi.groundColor.set('#b79a7c'); v.hemi.intensity = .32;
  v.envI = .62;
  // (a little variation over the walls and floor, so they don't look printed; no haze, mist or clouds indoors)
  v.air({ haze: 0, mist: 0, clouds: 0, wet: 0, macro: .45 });
  v.grade = { saturation: 1.02, contrast: 1.05, shadows: '#e0e4ee', highlights: '#fff6ea' };
  v.lut = null;
  v.exposure = 1.02; v.bloom = .24; v.glare = 0; v.shafts = 0; v.flare = null; v.beams = null;
  v.film = { halation: .05, grain: .15, fringe: 0 };
  v.focus = null;
  v.autoExposure = false;

  // daylight through the window: soft (a big window), not too strong, a near-white with a little warmth
  const s = sun('#fff2e2', 3.1, 4, SUN_DIR);
  s.softShadows(3); v.scene.add(s, s.target); v.onTier(T => s.setTier(T));

  // the two warm brass sconce lights above the shelves (right trophy shelf + left floating shelf)
  const lamp = { ...LAMP, col: '#ffd7a6', i: .95, reach: 2.0 };
  const leftLamp = { ...SHELF_LAMP, col: '#ffd7a6', i: .65, reach: 1.7 };
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

  // soft warm front-fill lamp that fades in at night so props in Reverie's hands and on the rug never fall into silhouette
  const propFill = { x: -.3, y: 1.05, z: 1.35, col: '#ffebd6', i: 0, reach: 3.2 };
  const lampsDay = [lamp, leftLamp], lampsNight = [lamp, leftLamp, propFill];

  return {
    sun: s,
    /** Keep the room and held props sharp (depth-of-field blur disabled for crispness). */
    setDof() { v.focus = null; },
    /** The right shelf sconce light ({ i, reach, col }): daylight.js turns it up as the day goes. */
    lamp,
    /** 0..1 night amount set by daylight.js, used to fade in the warm front prop-fill lamp. */
    night: 0,
    /** How much of its core's light reaches the room (daylight.js turns it down at night, so the rug isn't orange). */
    coreK: 1,
    /** 0..1, set each frame while it dances (music.js): the core's light and the shelf lights swell on the beat. */
    pulse: 0,
    /** The bounce light and the room's reflections: bake() each again after the room changes. */
    bounce, room: reflections,
    update(dt, t) {
      creature.coreAt(at); core.at(at.x, at.y - .04, at.z + .2); core.i0 = (.2 + creature.coreGlow * .5) * this.coreK * (1 + this.pulse * .8);
      // Keep shelf sconces warm and gentle (avoid blowing out the back wall with harsh white hotspots)
      const mainI = lamp.i * .55 * (1 + this.pulse * .35);
      const mainLamp = Object.assign(swell, lamp, { i: mainI });
      leftLamp.col = lamp.col;
      leftLamp.i = mainI * .58;
      leftLamp.reach = Math.max(1.4, lamp.reach * .75);
      if (this.night > .05) {
        propFill.x = at.x - .3; propFill.z = at.z + 1.35;
        propFill.i = 1.35 * this.night;
        lampsNight[0] = mainLamp;
        v.placeLamps(lampsNight, 0, .4, 0, t);
      } else {
        lampsDay[0] = mainLamp;
        v.placeLamps(lampsDay, 0, .4, 0, t);
      }
      // Keep the 4m shadow frustum centered on the room instead of jittering with Reverie's breathing
      s.follow(0, 0, 0);
    },
    /** The core's light, after its glow colour changed. */
    recolour() { core.s.col = creature.glowed(CORE_LAMP); },
  };
}
