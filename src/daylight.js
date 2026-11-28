// The room follows the real day outside: the light through the windows, the sky in them and the desk lamp move with
// the sun where you are (worked out on the device, gs.real), and the weather there (Open-Meteo, place.js) clouds it
// over, rains on the glass or snows. Soft and lifelike like the rest of the room: low sun is a gentle peach, never
// orange; dusk is a calm blue with the lamp coming on; night is a deep blue window, stars and the real moon's phase,
// and a cosy warm lamp. You can also ask Reverie for another sky for fun ("show me a sunset", "make it snow").
//
// Costs little: a dozen numbers eased each frame, two small sky pictures painted again only when they change, one
// scrolling rain layer per window and a few dozen drops on the glass (one draw call each). Everything is made before
// the first frame, hidden until wanted, so no shader is built mid-chat. The bounce light and room reflections are baked
// again only after the light has really changed (a few times a day, or once after a sky is asked for).
import gs from '../engine/src/gamescroll.js';
import { herePlace, skyHere } from './place.js';
import { TIMES, TIME_NAMES, WEATHER_NAMES } from './sky-names.js';

export { TIME_NAMES, WEATHER_NAMES };

// (a see-through moving thing the engine's upscaler takes from the new frame, not smeared from old ones: as gs.sky's rain)
const reactive = m => { m.userData.reactive = true; const k = m.customProgramCacheKey; m.customProgramCacheKey = function () { return k.call(this) + '|reactive'; }; return m; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mix = (a, b, k) => a + (b - a) * k;

// The light at a few heights of the sun (degrees). Between two, it is mixed. Kept gentle: the day key is the room's
// approved daylight (light.js), and every other key stays within a soft, natural range of it.
const KEYS = [
  [-12, { name: 'night', sun: '#b9c8ea', sunI: .42, up: 34, hemi: '#a6b2cc', ground: '#786250', hemiI: .18, envI: .16, top: '#0a1226', low: '#1b2747', glow: .9, lamp: 2.5, reach: 3.4, globe: 2.8, exposure: 1.04, motes: 0 }],
  [-5, { name: 'blue hour', sun: '#b8c4e6', sunI: .32, up: 26, hemi: '#b4bdd4', ground: '#86705e', hemiI: .2, envI: .22, top: '#34446e', low: '#7c84ab', glow: .8, lamp: 2.3, reach: 3.2, globe: 2.6, exposure: 1.06, motes: 0 }],
  [0, { name: 'dusk', sun: '#ffd8bc', sunI: .9, up: 6, hemi: '#dcd6e2', ground: '#a08470', hemiI: .22, envI: .32, top: '#8c9bc2', low: '#f1c7b0', glow: .78, lamp: 2.3, reach: 2.6, globe: 2.6, exposure: 1.04, motes: 1 }],
  [9, { name: 'golden', sun: '#ffe6cc', sunI: 2.6, up: 15, hemi: '#f3ede6', ground: '#b89a7c', hemiI: .28, envI: .5, top: '#d3deea', low: '#fbe7d3', glow: 1, lamp: 1.4, reach: 2, globe: 1.9, exposure: 1, motes: 3 }],
  [26, { name: 'day', sun: '#fff2e2', sunI: 3, up: 38, hemi: '#f2f1ee', ground: '#b79c80', hemiI: .3, envI: .55, top: '#e3eaf0', low: '#f6f3ec', glow: 1.05, lamp: 1.2, reach: 1.8, globe: 1.6, exposure: 1, motes: 3 }],
];
const COLOURS = ['sun', 'hemi', 'ground', 'top', 'low'];
const NUMBERS = ['sunI', 'up', 'hemiI', 'envI', 'glow', 'lamp', 'reach', 'globe', 'exposure', 'motes'];

/** The weather as the room shows it: { cloud 0..1, rain 0..1, snow 0..1, fog 0..1, storm } from a WMO code (Open-Meteo). */
export function skyOf(code, cloud = null) {
  const c = code ?? 0, w = { cloud: 0, rain: 0, snow: 0, fog: 0, storm: false };
  if (c === 1) w.cloud = .2; else if (c === 2) w.cloud = .45; else if (c === 3) w.cloud = .85;
  else if (c === 45 || c === 48) { w.cloud = .7; w.fog = 1; }
  else if (c >= 51 && c <= 57) { w.cloud = .8; w.rain = .35; }
  else if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) { w.cloud = .9; w.rain = c === 61 || c === 80 ? .6 : c === 65 || c === 82 ? 1 : .8; }
  else if ((c >= 71 && c <= 77) || c === 85 || c === 86) { w.cloud = .85; w.snow = c === 71 || c === 85 ? .6 : 1; }
  else if (c >= 95) { w.cloud = 1; w.rain = 1; w.storm = true; }
  if (cloud != null && !w.rain && !w.snow && !w.fog) w.cloud = Math.max(w.cloud, cloud * .9);
  return w;
}
const WEATHERS = { clear: skyOf(0), cloudy: skyOf(2), overcast: skyOf(3), fog: skyOf(45), drizzle: skyOf(51), rain: skyOf(63), storm: skyOf(95), snow: skyOf(73) };

/** How sleepy the hour is on the device's own clock, 0..1: 0 by day, rising from 9:30 pm to 1 by 11:30 pm, easing off 5 to 7 am. */
export function lateness(d = new Date()) { return latenessAt(d.getHours() + d.getMinutes() / 60); }
/** The same for an hour of the day (0..24). */
export function latenessAt(h) {
  if (h >= 21.5) return clamp((h - 21.5) / 2, 0, 1);
  if (h < 5) return 1;
  if (h < 7) return 1 - (h - 5) / 2;
  return 0;
}

/**
 * Makes the day outside for the room in view v. light: from lightRoom (its sun, lamp, bounce and reflections);
 * outside: { side, round } the materials of the sky seen through the side window and the round one; glass: the round
 * window's { x, y, z, r }; side: the side window's opening (light.js WINDOW); globe: the desk lamp globe's material;
 * motes: the dust in the sunbeam. Returns { update(dt), set({ time, weather }), state, line(), sound(on) }.
 */
export function makeDaylight({ v, light, outside, glass, side, globe, motes }) {
  const { THREE } = gs.hd;
  const C = k => new THREE.Color(k);

  // ---- what is shown now, what it is heading for, and what the bounce light was last baked with
  const now = {}, goal = {}, baked = {};
  for (const k of COLOURS) { now[k] = C(KEYS[4][1][k]); goal[k] = C(KEYS[4][1][k]); }
  for (const k of NUMBERS) { now[k] = KEYS[4][1][k]; goal[k] = now[k]; }
  Object.assign(now, { night: 0, cloud: 0, rain: 0, snow: 0, fog: 0, stars: 0 }); Object.assign(goal, { night: 0, cloud: 0, rain: 0, snow: 0, fog: 0, stars: 0 });
  const dirNow = new THREE.Vector3(-.8, .62, .3).normalize(), dirGoal = dirNow.clone();
  let asked = { time: 'live', weather: 'live' }, storm = false, moon = { phase: .5, lit: 1, up: true }, label = 'day', settleT = 0, bakeAt = 3;
  let t = 0, lookT = 0, paintT = 0, painted = '', flashT = 0, nextFlash = 8, thunderIn = -1, bed = null, soundOn = false;

  // ---- the sky outside, painted on two small pictures (the side window's and the round one's, with the moon)
  const paint = (size, withMoon) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    return { c, x: c.getContext('2d'), tex, size, withMoon };
  };
  const skies = [paint(256, false), paint(128, true)];
  // stars: the same each night (seeded), brighter ones fewer
  const STARS = Array.from({ length: 70 }, (_, i) => { const r = n => { const s = Math.sin(i * 127.1 + n * 311.7) * 43758.5; return s - Math.floor(s); }; return [r(1), r(2) * .75, .4 + r(3) * .9, .35 + r(4) * .65]; });
  const CLOUDS = Array.from({ length: 9 }, (_, i) => { const r = n => { const s = Math.sin(i * 91.3 + n * 47.9) * 24634.6; return s - Math.floor(s); }; return [r(1), .1 + r(2) * .6, .18 + r(3) * .22, .06 + r(4) * .07]; });
  const css = (col, a = 1) => `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
  function paintSky(s) {
    const { x, size: n } = s, top = now.top.clone().convertLinearToSRGB(), low = now.low.clone().convertLinearToSRGB();
    // (cloud and rain wash the sky towards a soft grey of its own brightness; fog towards a pale haze)
    const grey = (col, k) => { const l = col.r * .3 + col.g * .55 + col.b * .15; return col.lerp(new THREE.Color(l, l, l * 1.02), k); };
    const wash = now.cloud * .75, haze = now.fog * .6;
    grey(top, wash).lerp(low, haze); grey(low, wash * .8);
    const dull = 1 - .42 * now.cloud * (1 - now.fog * .6); top.multiplyScalar(dull); low.multiplyScalar(dull + .06 * now.cloud);
    const g = x.createLinearGradient(0, 0, 0, n); g.addColorStop(0, css(top)); g.addColorStop(.75, css(low)); g.addColorStop(1, css(low));
    x.globalAlpha = 1; x.fillStyle = g; x.fillRect(0, 0, n, n);
    const clear = 1 - now.cloud;
    if (now.stars * clear > .02) for (const [sx, sy, r, a] of STARS) { x.globalAlpha = a * now.stars * clear; x.fillStyle = '#f4f6ff'; x.beginPath(); x.arc(sx * n, sy * n, r * n / (s.withMoon ? 128 : 300), 0, 7); x.fill(); }
    if (s.withMoon && now.stars * clear > .02 && moon.up && moon.lit > .03) {
      // the moon's real phase: the lit part of a disc, its edge soft, with a faint glow round it
      const mx = n * .66, my = n * .3, mr = n * .085, a = now.stars * clear;
      const halo = x.createRadialGradient(mx, my, mr, mx, my, mr * 4); halo.addColorStop(0, `rgba(220,228,255,${.25 * a * moon.lit})`); halo.addColorStop(1, 'rgba(220,228,255,0)');
      x.globalAlpha = 1; x.fillStyle = halo; x.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
      x.save(); x.beginPath(); x.arc(mx, my, mr, 0, 7); x.clip();
      x.globalAlpha = a * .25; x.fillStyle = '#3a4466'; x.fillRect(mx - mr, my - mr, mr * 2, mr * 2);   // (the dark part, faintly)
      // the terminator: an ellipse whose width follows the phase; waxing is lit on the right
      const p = moon.phase, waxing = p < .5, k = Math.cos(p * Math.PI * 2);   // (1 new, -1 full)
      x.globalAlpha = a; x.fillStyle = '#eef1fa'; x.beginPath();
      x.arc(mx, my, mr, -Math.PI / 2, Math.PI / 2, !waxing);
      x.ellipse(mx, my, Math.abs(k) * mr, mr, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === waxing);
      x.fill(); x.restore();
    }
    // soft clouds drifting by, lit like the sky
    if (now.cloud > .05) {
      const cc = low.clone().lerp(new THREE.Color(1, 1, 1), now.night > .5 ? .05 : .35).multiplyScalar(now.night > .5 ? .55 : 1);
      for (const [cx, cy, w, h] of CLOUDS) {
        const px = ((cx + t * .0015 * (1 + h * 5)) % 1.3 - .15) * n, py = cy * n, rw = w * n, rh = h * n;
        const gr = x.createRadialGradient(px, py, 0, px, py, rw); gr.addColorStop(0, css(cc, .55 * now.cloud)); gr.addColorStop(1, css(cc, 0));
        x.globalAlpha = 1; x.fillStyle = gr; x.save(); x.translate(px, py); x.scale(1, rh / rw); x.translate(-px, -py); x.fillRect(px - rw, py - rw, rw * 2, rw * 2); x.restore();
      }
    }
    x.globalAlpha = 1; s.tex.needsUpdate = true;
  }
  // the outside's materials take the pictures (before the first frame, so their shaders are built with them)
  for (const [m, s] of [[outside.side, skies[0]], [outside.round, skies[1]]]) { m.emissiveMap = s.tex; m.emissive.set('#ffffff'); m.map = s.tex; m.needsUpdate = true; s.m = m; s.col = m.color.clone(); }

  // ---- rain and snow falling past the windows: a picture of streaks (or flakes) that scrolls down, one layer each
  const fallTex = (flakes) => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 512; const x = c.getContext('2d');
    for (let i = 0; i < (flakes ? 110 : 120); i++) {
      const px = Math.random() * 256, py = Math.random() * 512, near = Math.random();
      if (flakes) { const r = 2 + near * 4; const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(255,255,255,${.7 + near * .3})`); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill(); }
      else { const len = 30 + near * 50; const g = x.createLinearGradient(px, py, px - 4, py + len); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(255,255,255,${.45 + near * .55})`); x.strokeStyle = g; x.lineWidth = 1.2 + near * 1.6; x.lineCap = 'round'; x.beginPath(); x.moveTo(px, py); x.lineTo(px - 4, py + len); x.stroke(); }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const rainTex = fallTex(false), snowTex = fallTex(true);
  const layer = (geo, rep, place) => {
    const tex = rainTex.clone(); tex.repeat.set(...rep); tex.needsUpdate = true;
    const m = reactive(new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, color: '#cfd8e2' }));
    const mesh = new THREE.Mesh(geo, m); place(mesh); mesh.visible = false; mesh.renderOrder = 3; v.scene.add(mesh);
    return { mesh, m, rain: tex, snow: (() => { const s = snowTex.clone(); s.repeat.set(...rep); s.needsUpdate = true; return s; })() };
  };
  const sideW = side.z1 - side.z0, sideH = side.y1 - side.y0;
  const falls = [
    layer(new THREE.PlaneGeometry(sideW + .4, sideH + .3), [1.6, 1], o => { o.position.set(side.x - .35, (side.y0 + side.y1) / 2, (side.z0 + side.z1) / 2); o.rotation.y = Math.PI / 2; }),
    layer(new THREE.CircleGeometry(glass.r, 40), [.55, .35], o => o.position.set(glass.x, glass.y, glass.z + .0015)),
  ];

  // ---- drops on the glass: little lenses of water that bead up, and now and then run down
  const dropTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
    const g = x.createRadialGradient(16, 18, 2, 16, 16, 15); g.addColorStop(0, 'rgba(255,255,255,.18)'); g.addColorStop(.7, 'rgba(210,222,235,.28)'); g.addColorStop(.85, 'rgba(60,72,88,.75)'); g.addColorStop(1, 'rgba(60,72,88,0)');
    x.fillStyle = g; x.beginPath(); x.arc(16, 16, 15, 0, 7); x.fill();
    x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.arc(11, 10, 2.6, 0, 7); x.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const NDROPS = 110, dropMat = reactive(new THREE.MeshBasicMaterial({ map: dropTex, transparent: true, depthWrite: false, opacity: 0 }));
  const drops = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), dropMat, NDROPS); drops.renderOrder = 4; drops.frustumCulled = false; drops.visible = false; v.scene.add(drops);
  // each drop: which pane (0 side, 1 round), where on it (u across, w up, metres from its middle), its size, and how fast it runs
  const D = Array.from({ length: NDROPS }, (_, i) => ({ pane: i < 64 ? 0 : 1, u: 0, w: 0, r: 0, k: 0, run: 0, life: 0 }));
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const qSide = new THREE.Quaternion().setFromAxisAngle(Y, Math.PI / 2), qRound = new THREE.Quaternion();
  function seat(d) {
    if (d.pane === 0) { d.u = (Math.random() - .5) * (sideW - .06); d.w = (Math.random() - .5) * (sideH - .06); }
    else { const a = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * (glass.r - .02); d.u = Math.cos(a) * rr; d.w = Math.sin(a) * rr; }
    d.r = (.004 + Math.random() ** 2 * .01) * (d.pane ? .8 : 1); d.k = 0; d.run = 0; d.life = 0;
  }
  for (const d of D) { seat(d); d.k = 0; }
  function updateDrops(dt) {
    const wet = now.rain;
    for (let i = 0; i < NDROPS; i++) {
      const d = D[i];
      // beads gather while it rains (more the harder it rains), and dry away slowly after
      if (wet > 0 && d.k < 1 && Math.random() < dt * wet * .6) d.k = Math.min(1, d.k + .5);
      else if (wet <= 0) d.k = Math.max(0, d.k - dt * .03);
      // a big one now and then lets go and runs down, wandering a little, and starts again at the top
      if (!d.run && d.k >= 1 && d.r > .008 && Math.random() < dt * .04 * wet) d.run = .06 + Math.random() * .12;
      if (d.run) {
        d.w -= d.run * dt; d.u += Math.sin(d.w * 40 + i) * dt * .01;
        const off = d.pane === 0 ? d.w < -sideH / 2 + .02 : Math.hypot(d.u, d.w) > glass.r - .015;
        if (off) seat(d);
      }
      const s = d.r * 2 * Math.min(1, d.k * 1.5) * (d.run ? 1.1 : 1);
      if (d.pane === 0) { P.set(side.x - .02, (side.y0 + side.y1) / 2 + d.w, (side.z0 + side.z1) / 2 - d.u); Q.copy(qSide); }
      else { P.set(glass.x + d.u, glass.y + d.w, glass.z + .004); Q.copy(qRound); }
      S.set(s, s * (d.run ? 1.35 : 1), 1); M4.compose(P, Q, S); drops.setMatrixAt(i, M4);
    }
    drops.instanceMatrix.needsUpdate = true;
  }

  // ---- where the day is, worked out from the sun where they are (or what was asked for)
  function target() {
    const at = herePlace(), date = new Date();
    let h, morning, sun = null;
    if (asked.time !== 'live') [h, morning] = TIMES[asked.time];
    else {
      try { sun = gs.real.sun(at ? { lat: at.lat, lon: at.lon } : null, date); h = sun.height; morning = sun.noon != null ? (date.getHours() + date.getMinutes() / 60) < sun.noon : date.getHours() < 12; }
      catch { h = 30; morning = true; }
    }
    try { const m = gs.real.moon(at ? { lat: at.lat, lon: at.lon } : null, date); moon = { phase: m.phase, lit: m.lit, up: asked.time !== 'live' ? true : m.up !== false }; } catch { /* no moon: keep the last */ }
    // the keys either side of the sun's height, mixed
    let i = 0; while (i < KEYS.length - 1 && h > KEYS[i + 1][0]) i++;
    const [h0, a] = KEYS[i], [h1, b] = KEYS[Math.min(KEYS.length - 1, i + 1)], k = h1 === h0 ? 0 : clamp((h - h0) / (h1 - h0), 0, 1);
    for (const c of COLOURS) goal[c].copy(C(a[c])).lerp(C(b[c]), k);
    for (const n of NUMBERS) goal[n] = mix(a[n], b[n], k);
    label = h <= -9 ? 'night' : h <= -2 ? (morning ? 'dawn' : 'evening') : h <= 3 ? (morning ? 'sunrise' : 'sunset') : h <= 12 ? (morning ? 'early morning' : 'golden hour') : 'day';
    goal.night = clamp((-h - 2) / 8, 0, 1); goal.stars = clamp((-h - 4) / 6, 0, 1);
    // moonlight: brighter with a fuller moon, and only while it is up
    if (goal.night > 0) goal.sunI *= mix(1, (moon.up ? .3 + .7 * moon.lit : .2), goal.night);
    // the weather: asked for, or where they are
    const live = asked.weather === 'live' ? (() => { const s = skyHere(); return s ? skyOf(s.code, s.cloud) : null; })() : null;
    const w = asked.weather !== 'live' ? WEATHERS[asked.weather] : live || WEATHERS.clear;
    goal.cloud = w.cloud; goal.rain = w.rain; goal.snow = w.snow; goal.fog = w.fog; storm = w.storm;
    // (cloud dims and spreads the sun, the sky lights the room more evenly, and on a grey day the lamp is put on)
    goal.sunI *= 1 - .8 * w.cloud; goal.glow *= 1 - .3 * w.cloud; goal.hemiI *= 1 + .25 * w.cloud;
    goal.lamp += (1 - goal.night) * w.cloud * .7; goal.globe += (1 - goal.night) * w.cloud * .6; goal.exposure += .04 * w.cloud * (1 - goal.night);
    goal.motes *= 1 - w.cloud;
    if (w.cloud > .3) goal.sun.lerp(C('#eef0f4'), w.cloud * .6);
    // the sun's way in: lower towards evening, from the front of the window in the morning and further back later
    const up = goal.up * Math.PI / 180, z = morning ? .45 : -.02;
    dirGoal.set(-.8 * Math.cos(up), Math.sin(up), z * Math.cos(up)).normalize();
    return goal;
  }

  function apply() {
    const s = light.sun;
    s.color.copy(now.sun); s.intensity = now.sunI;
    s.aim(dirNow.x, dirNow.y, dirNow.z);
    v.hemi.color.copy(now.hemi); v.hemi.groundColor.copy(now.ground); v.hemi.intensity = now.hemiI;
    v.envI = now.envI; v.exposure = now.exposure;
    if (v.scene.background) v.scene.background.copy(BG).lerp(now.low, now.night);
    light.lamp.i = now.lamp; light.lamp.reach = now.reach;
    // (at night the lamp is a softer warm white and the core's own light is turned down: the room cosy, not orange)
    light.lamp.col = '#' + LAMP_DAY.clone().lerp(LAMP_NIGHT, now.night).getHexString(); light.coreK = 1 - .25 * now.night; light.night = now.night;
    // (the round room is closed all round, so at night a little more of the soft light by the camera keeps its face read)
    if (v.faceLit) v.faceLit.strength = .16 + .24 * now.night;
    globe.emissiveIntensity = now.globe;
    const lit = flashT > .25 || (flashT > .08 && flashT < .16), fl = lit ? 3.5 : 1;   // (lightning: two quick flickers)
    for (const sk of skies) { sk.m.emissiveIntensity = now.glow * fl; sk.m.color.copy(sk.col).multiplyScalar(.35 + .65 * (1 - now.night)); }
    if (lit) v.hemi.intensity *= 2.5;
    if (motes) motes.rate = now.motes;
    // rain and snow past the windows: grey streaks against a bright sky, pale ones against a dark one
    const falling = Math.max(now.rain, now.snow);
    for (const f of falls) {
      f.mesh.visible = falling > .01; if (!f.mesh.visible) continue;
      const snow = now.snow > now.rain; if (f.m.map !== (snow ? f.snow : f.rain)) { f.m.map = snow ? f.snow : f.rain; }
      f.m.opacity = falling * (snow ? .95 : .8);
      f.m.color.set(snow ? '#ffffff' : '#7d8a99').lerp(C('#c9d6ea'), now.night);
    }
    drops.visible = D.some(d => d.k > 0); dropMat.opacity = .5 + .4 * (1 - now.night * .5);
  }

  function ease(dt, fast) {
    const k = 1 - Math.exp(-dt / (fast ? 1.2 : 6));
    let moved = 0;
    for (const c of COLOURS) { const a = now[c], b = goal[c]; moved += Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b); a.lerp(b, k); }
    for (const n of [...NUMBERS, 'night', 'cloud', 'rain', 'snow', 'fog', 'stars']) { moved += Math.abs(now[n] - goal[n]) * (n === 'up' ? .02 : 1); now[n] += (goal[n] - now[n]) * k; }
    dirNow.lerp(dirGoal, k).normalize();
    return moved;
  }
  const snap = () => { for (const c of COLOURS) now[c].copy(goal[c]); for (const n of [...NUMBERS, 'night', 'cloud', 'rain', 'snow', 'fog', 'stars']) now[n] = goal[n]; dirNow.copy(dirGoal); };
  // how far the light is from what the bounce light and the reflections were baked with
  const drift = () => baked.sunI == null ? 1 : Math.abs(now.sunI - baked.sunI) / 3 + Math.abs(now.lamp - baked.lamp) / 3 + Math.abs(now.glow - baked.glow) + Math.abs(now.hemiI - baked.hemiI) * 3 + (Math.abs(now.sun.r - baked.sun.r) + Math.abs(now.sun.g - baked.sun.g) + Math.abs(now.sun.b - baked.sun.b)) + dirNow.distanceTo(baked.dir) * .6;
  const rebake = () => { light.bounce?.bake?.(); light.room?.bake?.(); Object.assign(baked, { sunI: now.sunI, lamp: now.lamp, glow: now.glow, hemiI: now.hemiI, sun: now.sun.clone(), dir: dirNow.clone() }); };

  function rainSound() {
    const want = soundOn ? Math.max(now.rain, storm ? 1 : 0) : 0;
    if (want > .05 && !bed) bed = gs.sound.bed({ vol: 0, from: 2400, filter: 'bandpass', q: .35, gusts: .3 });
    if (bed) { bed.set({ vol: .012 * want }, 2); if (want <= .05 && now.rain < .02) { bed.stop(); bed = null; } }
  }

  // the first answer at once: the room starts as it is outside, with nothing to fade
  const BG = v.scene.background.clone(), LAMP_DAY = C(light.lamp.col), LAMP_NIGHT = C('#ffe6cc');
  target(); snap(); apply(); for (const s of skies) paintSky(s);
  Object.assign(baked, { sunI: now.sunI, lamp: now.lamp, glow: now.glow, hemiI: now.hemiI, sun: now.sun.clone(), dir: dirNow.clone() });   // (baked by the view on its first frame)

  return {
    /** What it shows now: { label ('day', 'golden hour', 'sunset', 'evening', 'night'...), night 0..1, cloud, rain, snow, fog, asked }. */
    get state() { return { label, night: now.night, cloud: now.cloud, rain: now.rain, snow: now.snow, fog: now.fog, storm, asked: { ...asked } }; },
    update(dt) {
      t += dt;
      if ((lookT -= dt) <= 0) { lookT = 5; target(); }
      const fast = asked.time !== 'live' || asked.weather !== 'live' || settleT > 0; settleT -= dt;
      const moved = ease(dt, fast);
      // storms: lightning every so often, and thunder a moment later
      if (storm && now.rain > .5) { if ((nextFlash -= dt) <= 0) { flashT = .35; nextFlash = 7 + Math.random() * 12; thunderIn = .6 + Math.random() * 2; } }
      if (flashT > 0) flashT = Math.max(0, flashT - dt);
      if (thunderIn > 0 && (thunderIn -= dt) <= 0 && soundOn) gs.sound.sounds.thunder?.(.8 + Math.random() * .3);
      apply();
      // the sky pictures: painted again when what they show has moved on, a few times a second at most while changing
      const key = [now.top.getHexString(), now.low.getHexString(), (now.stars * 20 | 0), (now.cloud * 20 | 0), (now.fog * 10 | 0), (t / 4 | 0) * (now.cloud > .05 ? 1 : 0), moon.phase.toFixed(2)].join();
      if ((paintT -= dt) <= 0 && key !== painted) { painted = key; paintT = .25; for (const s of skies) paintSky(s); }
      for (const f of falls) if (f.mesh.visible) { const map = f.m.map; map.offset.y += dt * (now.snow > now.rain ? .05 : .9); map.offset.x += dt * (now.snow > now.rain ? .01 : 0); }
      if (now.rain > 0 || drops.visible) updateDrops(dt);
      // the bounce light and reflections, baked again once the light has settled somewhere new
      if ((bakeAt -= dt) <= 0 && drift() > .25 && moved < .08) { bakeAt = 3; rebake(); }
      rainSound();
    },
    /** Shows another sky: time ('live', 'sunset', 'night'...) and/or weather ('live', 'rain', 'snow'...). Resolves a sentence. */
    async set({ time, weather } = {}) {
      const tt = String(time || '').toLowerCase().trim(), ww = String(weather || '').toLowerCase().trim();
      if (tt && !TIME_NAMES.includes(tt)) return { text: `Not changed: "${time}" is not a time it knows. Times: ${TIME_NAMES.join(', ')}.`, error: true };
      if (ww && !WEATHER_NAMES.includes(ww)) return { text: `Not changed: "${weather}" is not a weather it knows. Weathers: ${WEATHER_NAMES.join(', ')}.`, error: true };
      if (tt) asked.time = tt; if (ww) asked.weather = ww;
      if (!tt && !ww) asked = { time: 'live', weather: 'live' };
      lookT = 0; settleT = 10; nextFlash = Math.min(nextFlash, 2.5);
      const real = asked.time === 'live' && asked.weather === 'live';
      return real ? 'The window shows the real sky outside again, as it is where they are.'
        : `The window now shows ${asked.time === 'live' ? 'the real time of day' : asked.time}${asked.weather === 'live' ? '' : ` with ${asked.weather === 'clear' ? 'a clear sky' : asked.weather}`}, and the room's light follows. "live" puts the real sky back.`;
    },
    /** A few words on what the window shows, for Claude ('' when it is simply the real day). */
    line() {
      const bits = [];
      if (asked.time !== 'live' || asked.weather !== 'live') bits.push(`your window is showing ${asked.time !== 'live' ? asked.time : 'the real time of day'}${asked.weather !== 'live' ? ` and ${asked.weather}` : ''} because they asked for it`);
      else if (goal.rain > .2) bits.push(storm ? 'there is a thunderstorm outside your window' : 'it is raining outside your window');
      else if (goal.snow > .2) bits.push('it is snowing outside your window');
      else if (goal.fog > .5) bits.push('it is foggy outside your window');
      const late = lateness();
      if (late > .5) bits.push("it is late at night and you are a bit sleepy");
      return bits.join('; ');
    },
    /** The rain's sound (once the page may make sound). */
    sound(on = true) { soundOn = on; },
    /** Bakes the bounce light again now (after the room changed). */
    rebake,
    /** Jumps straight to what it is heading for, with no fade, and bakes the light again (tests, pictures). */
    settle() { target(); snap(); for (const d of D) d.k = now.rain > 0 && Math.random() < .3 + now.rain * .6 ? 1 : 0; apply(); for (const s of skies) paintSky(s); rebake(); },
  };
}
