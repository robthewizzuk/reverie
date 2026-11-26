// The room's light: late afternoon sun coming in low through the window in the left wall, a warm lamp on the bench,
// the glow of its core, and the light all of that bounces off the floor and the bricks. An indoor mood set by hand
// rather than the engine's outdoor 'golden hour' look, which lit a room as if it stood in a field: haze and drifting
// cloud shadows indoors, sun shafts, glare and a lens flare with no sun in view, and a front-on sun from high up that
// left the creature flat and washed out. Here one low light from the side gives it a lit side and a shaded side, the
// window's cross falls on the rug and the wall behind, and what isn't in the sun is filled by the bounce.
import gs from '../engine/src/gamescroll.js';

// towards the sun: low, from the left wall's window and a little in front, so the light crosses the creature at a
// three-quarter angle and its shadow falls behind it to the right, where the camera sees it on the rug
export const SUN_DIR = [-.78, .52, .35];
export const WINDOW = { x: -2.1, z0: -.3, z1: 1.4, y0: .85, y1: 2.25 };   // the opening in the left wall (metres)

const CORE_LAMP = '#ff7020';     // the light its core casts, as made (moved with the glow colour)

/**
 * Lights the room in view v around the creature. roomBox: { min, max } of the room inside its walls. Call after the
 * room and the creature are made (so the room's reflections reach its eyes, glass dome and the props on the bench).
 * Returns { sun, bounce, room, update(dt, t), recolour() }.
 */
export function lightRoom(v, creature, roomBox) {
  const { sun } = gs.hd;

  // the mood: warm sun, cool shade, the walls never washed in orange
  v.scene.background.set('#2a1d16');
  v.hemi.color.set('#ffe4c8'); v.hemi.groundColor.set('#3a2418'); v.hemi.intensity = .05;   // (barely any fill of its own: the bounce from the sunlit patch does that)
  v.envI = .3;
  // (variation over the walls and floor, so no two bricks or boards are lit alike; no haze, mist or clouds indoors)
  v.air({ haze: 0, mist: 0, clouds: 0, wet: 0, macro: .55 });
  v.grade = { saturation: 1.04, contrast: 1.14, shadows: '#cdd5f0', highlights: '#fff0da' };
  v.lut = gs.hd.lut((r, g, b) => {
    const l = .3 * r + .59 * g + .11 * b, w = Math.min(1, Math.max(0, (l - .4) * 2 + .5)), c = x => Math.min(1, Math.max(0, x));
    // shade a touch cool, light a touch warm, blacks barely lifted: a film's late afternoon
    return [c(.012 + r + -.012 * (1 - w) + .028 * w * w), c(.012 + g + .002 * (1 - w) + .01 * w * w), c(.012 + b + .025 * (1 - w) - .022 * w * w)];
  });
  v.lutAmount = .55;
  v.exposure = 1; v.bloom = .45; v.glare = 0; v.shafts = 0; v.flare = null;
  v.film = { halation: .3, grain: 1, fringe: .008 };
  v.autoExposure = false;   // (a fixed exposure: an eye that adapts opened the shade up until the sun's patch no longer stood out)

  // the sun, through the window: sharper than a summer sky's (a window is a small opening), shadows by the view's tier
  const s = sun('#ffd8ac', 7.5, 4, SUN_DIR);
  s.softShadows(.7); v.scene.add(s, s.target); v.onTier(T => s.setTier(T));
  // light in the air where the sun comes through: beams cut by the window's frame, the dust in them catching it
  // (drawn at half size on high and ultra; the tiers turn it off on small phones)
  v.beams = { light: s, density: .05, far: 6, glow: .55, strength: .55, steps: 24 };

  // the bench lamp: a warm pool on the bench and the bricks behind it, and a rim on the creature's right side
  const lamp = { x: 1.5, y: 1.07, z: -1.24, col: '#ffb46a', i: 3, reach: 2.4 };
  v.lampLights(6);
  // its core: a warm light on its hands, on what it holds and on the rug in front of it, brighter as it glows
  const core = v.flash(0, .3, .3, { keep: true, col: creature.glowed(CORE_LAMP), i: 1, reach: 1.4 });
  const at = new gs.hd.THREE.Vector3();

  // a soft light from beside the camera, as a film crew lights a face: it lifts the shaded side of the face and puts
  // a bright point in each eye (one spot light, no shadow, aimed at its face every frame)
  v.faceLight(creature.face3d, { strength: .28, side: .35, up: .3, colour: '#fff1e2' });

  // bounce light from the brick, the boards and the sunlit patch (a warm wall tints what is next to it), reflections
  // of the room itself in anything shiny (its eyes, its glass dome, the floorboards) instead of the kit's studio, and
  // soft contact shadows on the rug under its feet and the props. Each scales itself down on a slow phone (v's tiers).
  const bounce = v.bounce(roomBox, { spacing: .8, bounces: 1, size: 8 });
  const reflections = v.room(roomBox, { strength: .9 });
  v.contact({ y: .013, size: 3, darkness: 1.1, opacity: .5, height: .7 });

  return {
    sun: s,
    /** The bounce light and the room's reflections: bake() each again after the room changes. */
    bounce, room: reflections,
    update(dt, t) {
      creature.coreAt(at); core.at(at.x, at.y - .04, at.z + .2); core.i0 = .3 + creature.coreGlow * .8;
      v.placeLamps([lamp], 0, .4, 0, t);
      s.follow(0, 0, 0);
    },
    /** The core's light, after its glow colour changed. */
    recolour() { core.s.col = creature.glowed(CORE_LAMP); },
  };
}
