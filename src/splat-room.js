// Photorealistic Gaussian Splat Room Teleporter powered by @sparkjsdev/spark (World Labs' Three.js 3DGS renderer).
// Features:
//   - True anisotropic 3D Gaussian ellipsoids with GPU depth sorting at 1:1 scale (.ply, compressed .ply, .spz, .splat, .sog)
//   - Camera-synced transparent compositing behind Reverie's WebGPU stage (v.clearBg = true + GpuChain rebuild)
//   - WASD / Arrow-key walking (relative to camera look direction, Shift to jog) + click/tap-to-walk anywhere on the floor
//   - Smooth third-person follow camera behind Reverie while still allowing full 360-degree look-around (look.free = true)
//   - Floating alignment HUD: Axis flip, Floor height, Splat Scale, Reverie Scale, Rotate, and Exit
import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import gs from '../engine/src/gamescroll.js';

const AXES = [
  { id: 'opencv', label: 'Y-down', rx: Math.PI },
  { id: 'yup',    label: 'Y-up',   rx: 0 },
  { id: 'zup',    label: 'Z-up',   rx: -Math.PI / 2 },
];

/** Brief white-gold teleport portal flash over the stage. */
function portalFlash() {
  if (typeof document === 'undefined') return;
  let f = document.getElementById('splat-flash');
  if (!f) {
    f = document.createElement('div');
    f.id = 'splat-flash';
    Object.assign(f.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '999',
      background: 'radial-gradient(circle at 50% 55%, rgba(255,248,220,.92), rgba(130,220,255,.55) 55%, rgba(20,30,50,0) 100%)',
      opacity: '0', transition: 'opacity .28s ease-out',
    });
    document.body.appendChild(f);
  }
  f.style.transition = 'opacity .12s ease-in';
  f.style.opacity = '1';
  setTimeout(() => { f.style.transition = 'opacity .55s ease-out'; f.style.opacity = '0'; }, 160);
}

export function makeSplatRoom({ world, stageEl, looking = null, setWorkshopVisible = () => {} }) {
  const hdThree = gs.hd.THREE;
  const hdScene = world.view.scene;

  // Dedicated WebGL2 canvas behind Reverie's stage canvas for @sparkjsdev/spark
  const canvas = document.createElement('canvas');
  canvas.id = 'splat-canvas';
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    zIndex: '-2', pointerEvents: 'none', display: 'none',
  });
  stageEl.prepend(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const splatScene = new THREE.Scene();
  splatScene.background = new THREE.Color('#141820');
  const spark = new SparkRenderer({ renderer });
  splatScene.add(spark);
  const splatCam = new THREE.PerspectiveCamera(45, 1, .05, 500);

  // Invisible shadow catcher that follows under Reverie's feet anywhere in the splat world
  const catcher = new hdThree.Mesh(
    new hdThree.PlaneGeometry(16, 16),
    new hdThree.ShadowMaterial({ opacity: .45 }),
  );
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = .002;
  catcher.receiveShadow = true;
  catcher.visible = false;
  hdScene.add(catcher);

  let splatMesh = null, currentName = '', active = false, savedBg = null;
  let opts = { axisIdx: 0, scale: 1, revScale: 1, xOffset: 0, yOffset: -1.1, zOffset: 0, yaw: 0 };
  let lastW = 0, lastH = 0;

  // Third-person walking & follow-camera state
  const keys = new Set();
  let clickGoal = null;           // { x, z } from tapping the splat floor
  let camHeading = Math.PI;       // behind Reverie initially (+Z looking toward -Z)
  let wasWalking = false;
  const followSeat = { pos: [0, 1.05, 2.2], look: [0, .48, 0] };
  const ray = new hdThree.Raycaster(), ndc = new hdThree.Vector2();
  const floorPlane = new hdThree.Plane(new hdThree.Vector3(0, 1, 0), 0), hitPt = new hdThree.Vector3();
  const fwd = new hdThree.Vector3(), right = new hdThree.Vector3();

  // WASD + Arrow keys listener (ignored while typing in an input/textarea)
  const isTyping = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  addEventListener('keydown', e => {
    if (!active || isTyping(document.activeElement)) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
      keys.add(k);
      if (k !== 'shift') clickGoal = null;
    }
  });
  addEventListener('keyup', e => { keys.delete(e.key.toLowerCase()); });
  addEventListener('blur', () => keys.clear());

  // Compact floating HUD bar for quick 1-tap alignment (Axis, Floor, Splat Scale, Reverie Scale, Rotate, Exit)
  const hud = document.createElement('div');
  hud.id = 'splat-hud';
  Object.assign(hud.style, {
    position: 'absolute', top: '64px', right: '12px', zIndex: '25', display: 'none',
    gap: '4px', flexWrap: 'wrap', alignItems: 'center', maxWidth: 'min(94vw, 520px)',
    padding: '6px 8px', borderRadius: '14px', background: 'rgba(20,16,14,.80)',
    backdropFilter: 'blur(10px)', color: '#f7efe6', font: '500 12px system-ui, sans-serif',
    boxShadow: '0 4px 18px rgba(0,0,0,.35)',
  });
  const mkBtn = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    Object.assign(b.style, {
      border: '0', borderRadius: '8px', padding: '5px 8px', cursor: 'pointer',
      background: 'rgba(255,255,255,.12)', color: '#f7efe6', font: 'inherit',
    });
    b.addEventListener('click', fn);
    hud.appendChild(b);
    return b;
  };
  const axisBtn = mkBtn('Axis: Y-down', () => { opts.axisIdx = (opts.axisIdx + 1) % AXES.length; applyTransform(); });
  mkBtn('Floor −', () => { opts.yOffset -= .3; applyTransform(); });
  mkBtn('Floor +', () => { opts.yOffset += .3; applyTransform(); });
  mkBtn('Room −', () => { opts.scale = Math.max(.1, +(opts.scale / 1.25).toFixed(3)); applyTransform(); });
  mkBtn('Room +', () => { opts.scale = Math.min(10, +(opts.scale * 1.25).toFixed(3)); applyTransform(); });
  mkBtn('Rev −', () => { opts.revScale = Math.max(.25, +(opts.revScale / 1.2).toFixed(3)); applyTransform(); });
  mkBtn('Rev +', () => { opts.revScale = Math.min(3.5, +(opts.revScale * 1.2).toFixed(3)); applyTransform(); });
  mkBtn('⟲', () => { opts.yaw -= Math.PI / 8; applyTransform(); });
  mkBtn('⟳', () => { opts.yaw += Math.PI / 8; applyTransform(); });
  const exitBtn = mkBtn('Exit', () => unload());
  exitBtn.style.background = 'rgba(229,72,77,.82)';
  stageEl.appendChild(hud);

  function applyTransform() {
    axisBtn.textContent = 'Axis: ' + AXES[opts.axisIdx].label;
    if (splatMesh) {
      splatMesh.rotation.set(AXES[opts.axisIdx].rx, opts.yaw, 0, 'YXZ');
      splatMesh.scale.setScalar(opts.scale);
      splatMesh.position.set(opts.xOffset, opts.yOffset, opts.zOffset);
    }
    if (active && world.creature?.root) {
      world.creature.root.scale.setScalar(opts.revScale);
    }
  }

  function clearMesh() {
    if (!splatMesh) return;
    splatScene.remove(splatMesh);
    try { splatMesh.dispose?.(); } catch {}
    splatMesh = null;
  }

  function teleportEffect(entering) {
    portalFlash();
    gs.sound.sounds.whoosh?.();
    gs.sound.sounds.bell?.();
    world.creature?.gesture?.(entering ? 'tada' : 'wave');
    world.creature?.mood?.('excited');
  }

  function rebuildGpuChain() {
    try {
      world.view._gpuChain?.dispose?.();
      world.view._gpuChain = null;
    } catch { world.view._gpuChain = null; }
  }

  function syncFollowSeat(snap = false) {
    const r = world.creature?.root;
    if (!r) return;
    const s = opts.revScale;
    const dist = 2.15 * Math.max(.6, s);
    const height = .98 * Math.max(.65, s);
    const lookY = .45 * s;
    const tx = r.position.x - Math.sin(camHeading) * dist;
    const tz = r.position.z - Math.cos(camHeading) * dist;
    if (snap) {
      followSeat.pos = [tx, height, tz];
      followSeat.look = [r.position.x, lookY, r.position.z];
    } else {
      followSeat.pos[0] = tx; followSeat.pos[1] = height; followSeat.pos[2] = tz;
      followSeat.look[0] = r.position.x; followSeat.look[1] = lookY; followSeat.look[2] = r.position.z;
    }
    catcher.position.set(r.position.x, .002, r.position.z);
  }

  function setActive(on, { silent = false } = {}) {
    const next = !!on && !!splatMesh;
    if (next !== active && !silent) teleportEffect(next);
    active = next;
    canvas.style.display = active ? 'block' : 'none';
    hud.style.display = active ? 'flex' : 'none';
    catcher.visible = active;
    setWorkshopVisible(!active);
    clickGoal = null;
    keys.clear();

    if (active) {
      if (savedBg === null) savedBg = hdScene.background ? hdScene.background.clone() : new hdThree.Color('#e9e3da');
      world.view.clearBg = true;
      hdScene.background = null;
      rebuildGpuChain();
      world.light?.setDof?.(false);
      if (looking) { looking.free = true; looking.recentre(); }
      const r = world.creature?.root;
      if (r) { r.position.set(0, 0, 0); r.scale.setScalar(opts.revScale); }
      camHeading = Math.PI; // camera sits behind Reverie at +Z looking toward -Z
      syncFollowSeat(true);
      world.seat = followSeat;
    } else {
      world.view.clearBg = false;
      if (savedBg) { hdScene.background = savedBg; savedBg = null; }
      rebuildGpuChain();
      world.light?.setDof?.(true);
      if (looking) { looking.free = false; looking.recentre(); }
      world.seat = null;
      const r = world.creature?.root;
      if (r) { r.position.set(0, 0, 0); r.scale.setScalar(1); }
      world.creature?.walk?.(0, null);
    }
  }

  async function loadOptions(meshOpts, name) {
    clearMesh();
    const isSpz = /\.spz$/i.test(name);
    opts = { axisIdx: isSpz ? 1 : 0, scale: 1, revScale: 1, xOffset: 0, yOffset: -1.1, zOffset: 0, yaw: 0 };

    await new Promise((resolve, reject) => {
      try {
        const m = new SplatMesh({
          ...meshOpts,
          fileName: name,
          onLoad: loaded => resolve(loaded),
        });
        splatMesh = m;
        splatScene.add(m);
        applyTransform();
        if (m.initialized && typeof m.initialized.then === 'function') {
          m.initialized.then(() => resolve(m), reject);
        }
      } catch (e) {
        reject(e);
      }
    });

    currentName = name;
    setActive(true);
    return { ok: true, count: splatMesh?.numSplats || 0, name };
  }

  async function loadBuffer(buffer, name = 'room.splat') {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return loadOptions({ fileBytes: bytes }, name);
  }

  async function loadFile(file) {
    if (!file) return { ok: false, error: 'No file selected.' };
    const buf = await file.arrayBuffer();
    return loadBuffer(buf, file.name || 'room.splat');
  }

  async function loadUrl(url) {
    const cleanUrl = String(url || '').trim();
    if (!cleanUrl) return { ok: false, error: 'No URL given.' };
    return loadOptions({ url: cleanUrl }, cleanUrl.split('/').pop() || 'room.splat');
  }

  /** Sync Spark's WebGL2 camera to Reverie's HDView camera and render the anisotropic Gaussian Splats. */
  function render(W, H) {
    if (!active || !splatMesh) return;
    if (W !== lastW || H !== lastH) {
      lastW = W; lastH = H;
      renderer.setSize(W, H, false);
    }
    const src = world.view.cam;
    if (src) {
      splatCam.fov = src.fov;
      splatCam.aspect = W / Math.max(1, H);
      splatCam.near = Math.max(.02, src.near);
      splatCam.far = Math.max(500, src.far);
      splatCam.position.set(src.position.x, src.position.y, src.position.z);
      splatCam.quaternion.set(src.quaternion.x, src.quaternion.y, src.quaternion.z, src.quaternion.w);
      splatCam.updateProjectionMatrix();
    }
    renderer.render(splatScene, splatCam);
  }

  /** Click/tap anywhere on the splat floor to send Reverie walking there! */
  function tap(x, y, W, H) {
    if (!active || world.game) return false;
    ndc.set(x / W * 2 - 1, -(y / H) * 2 + 1);
    ray.setFromCamera(ndc, world.view.cam);
    if (!ray.ray.intersectPlane(floorPlane, hitPt)) return false;
    const r = world.creature?.root;
    if (!r) return false;
    const dx = hitPt.x - r.position.x, dz = hitPt.z - r.position.z;
    const d = Math.hypot(dx, dz);
    if (d > 25) {
      // Clamp super-distant horizon clicks to 12m in that direction
      clickGoal = { x: r.position.x + (dx / d) * 12, z: r.position.z + (dz / d) * 12 };
    } else {
      clickGoal = { x: hitPt.x, z: hitPt.z };
    }
    gs.sound.sounds.pop?.();
    return true;
  }

  /** WASD / Arrow walking + click-to-walk + smooth third-person follow camera behind Reverie. */
  function update(dt) {
    if (!active || world.game) return;
    const r = world.creature?.root;
    if (!r) return;

    // 1. Check WASD / Arrow keys relative to the camera's current horizontal look direction
    let moveFwd = 0, moveRight = 0;
    if (keys.has('w') || keys.has('arrowup')) moveFwd += 1;
    if (keys.has('s') || keys.has('arrowdown')) moveFwd -= 1;
    if (keys.has('d') || keys.has('arrowright')) moveRight += 1;
    if (keys.has('a') || keys.has('arrowleft')) moveRight -= 1;

    const baseSpeed = (keys.has('shift') ? 2.4 : 1.35) * Math.max(.55, opts.revScale);
    let vx = 0, vz = 0;

    if (moveFwd || moveRight) {
      world.view.cam.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); else fwd.normalize();
      right.set(-fwd.z, 0, fwd.x);
      vx = fwd.x * moveFwd + right.x * moveRight;
      vz = fwd.z * moveFwd + right.z * moveRight;
      const len = Math.hypot(vx, vz) || 1;
      vx = (vx / len) * baseSpeed;
      vz = (vz / len) * baseSpeed;
    } else if (clickGoal) {
      const dx = clickGoal.x - r.position.x, dz = clickGoal.z - r.position.z, d = Math.hypot(dx, dz);
      if (d < .08) {
        clickGoal = null;
      } else {
        const sp = Math.min(d / Math.max(dt, .016), baseSpeed);
        vx = (dx / d) * sp;
        vz = (dz / d) * sp;
      }
    }

    const speed = Math.hypot(vx, vz);
    if (speed > .02) {
      r.position.x += vx * dt;
      r.position.z += vz * dt;
      const heading = Math.atan2(vx, vz);
      world.creature.walk(Math.min(1, speed / Math.max(.5, baseSpeed)), heading);
      // Smoothly swing follow camera behind Reverie when walking (unless user is actively dragging to look around)
      if (!looking?.dragging && moveFwd >= 0) {
        let diff = heading - camHeading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        camHeading += diff * (1 - Math.exp(-dt * 2.2));
      }
      wasWalking = true;
    } else if (wasWalking) {
      world.creature.walk(0, null);
      wasWalking = false;
    }

    syncFollowSeat(false);
  }

  function adjust(patch = {}) {
    if (patch.scale != null) opts.scale = Math.max(.1, Math.min(10, +patch.scale || 1));
    if (patch.revScale != null) opts.revScale = Math.max(.25, Math.min(3.5, +patch.revScale || 1));
    if (patch.yOffset != null) opts.yOffset = Math.max(-20, Math.min(20, +patch.yOffset || 0));
    if (patch.yaw != null) opts.yaw = +patch.yaw || 0;
    if (patch.axisIdx != null) opts.axisIdx = ((patch.axisIdx | 0) % AXES.length + AXES.length) % AXES.length;
    applyTransform();
  }

  function unload() {
    setActive(false);
    clearMesh();
    currentName = '';
  }

  return {
    get active() { return active; },
    get name() { return currentName; },
    loadFile, loadBuffer, loadUrl, setActive, adjust, unload, tap, update, render,
    line: () => active ? ` Teleported into their photorealistic Gaussian Splat room ("${currentName}"), where you can walk around with WASD or by tapping the floor.` : '',
  };
}
