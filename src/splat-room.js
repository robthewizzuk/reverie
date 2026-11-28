// Photorealistic Gaussian Splat Room Teleporter powered by @sparkjsdev/spark (World Labs' Three.js 3DGS renderer).
// Renders true anisotropic 3D Gaussian ellipsoids with GPU depth sorting at 1:1 human scale — supporting
// `.ply`, SuperSplat compressed `.ply`, `.spz`, `.splat`, `.sog`, and `.ksplat` — on a dedicated WebGL2 canvas
// composited directly behind Reverie's transparent WebGPU stage (v.clearBg = true), camera-synced every frame.
import * as THREE from 'three';
import { SplatMesh } from '@sparkjsdev/spark';
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

export function makeSplatRoom({ world, stageEl, setWorkshopVisible = () => {} }) {
  const hdThree = gs.hd.THREE;
  const hdScene = world.view.scene;

  // Dedicated WebGL2 canvas behind Reverie's stage canvas for @sparkjsdev/spark
  const canvas = document.createElement('canvas');
  canvas.id = 'splat-canvas';
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    zIndex: '0', pointerEvents: 'none', display: 'none',
  });
  stageEl.prepend(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const splatScene = new THREE.Scene();
  splatScene.background = new THREE.Color('#141820');
  const splatCam = new THREE.PerspectiveCamera(45, 1, .05, 500);

  // Invisible shadow catcher in Reverie's scene so Reverie, pets, and props cast real shadows onto the splat floor
  const catcher = new hdThree.Mesh(
    new hdThree.PlaneGeometry(14, 14),
    new hdThree.ShadowMaterial({ opacity: .45 }),
  );
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = .002;
  catcher.receiveShadow = true;
  catcher.visible = false;
  hdScene.add(catcher);

  let splatMesh = null, currentName = '', active = false, savedBg = null;
  let opts = { axisIdx: 0, scale: 1, yOffset: -1.1, yaw: 0 };
  let roamTimer = 8, lastW = 0, lastH = 0;
  const ray = new hdThree.Raycaster(), ndc = new hdThree.Vector2();
  const floorPlane = new hdThree.Plane(new hdThree.Vector3(0, 1, 0), 0), hitPt = new hdThree.Vector3();

  // Compact floating HUD bar for quick 1-tap alignment (Axis flip, Floor height, Scale, Rotate, Exit)
  const hud = document.createElement('div');
  hud.id = 'splat-hud';
  Object.assign(hud.style, {
    position: 'absolute', top: '64px', right: '12px', zIndex: '25', display: 'none',
    gap: '4px', flexWrap: 'wrap', alignItems: 'center', maxWidth: 'min(92vw, 420px)',
    padding: '6px 8px', borderRadius: '14px', background: 'rgba(20,16,14,.78)',
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
  mkBtn('Floor −', () => { opts.yOffset -= .25; applyTransform(); });
  mkBtn('Floor +', () => { opts.yOffset += .25; applyTransform(); });
  mkBtn('Scale −', () => { opts.scale = Math.max(.1, +(opts.scale / 1.25).toFixed(3)); applyTransform(); });
  mkBtn('Scale +', () => { opts.scale = Math.min(10, +(opts.scale * 1.25).toFixed(3)); applyTransform(); });
  mkBtn('⟲', () => { opts.yaw -= Math.PI / 8; applyTransform(); });
  mkBtn('⟳', () => { opts.yaw += Math.PI / 8; applyTransform(); });
  const exitBtn = mkBtn('Exit', () => unload());
  exitBtn.style.background = 'rgba(229,72,77,.82)';
  stageEl.appendChild(hud);

  function applyTransform() {
    axisBtn.textContent = 'Axis: ' + AXES[opts.axisIdx].label;
    if (!splatMesh) return;
    splatMesh.rotation.set(AXES[opts.axisIdx].rx, opts.yaw, 0, 'YXZ');
    splatMesh.scale.setScalar(opts.scale);
    splatMesh.position.set(0, opts.yOffset, 0);
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

  function setActive(on, { silent = false } = {}) {
    const next = !!on && !!splatMesh;
    if (next !== active && !silent) teleportEffect(next);
    active = next;
    canvas.style.display = active ? 'block' : 'none';
    hud.style.display = active ? 'flex' : 'none';
    catcher.visible = active;
    setWorkshopVisible(!active);

    // Switch Reverie's HDView to transparent background so Spark's photorealistic WebGL2 splat shows behind it
    if (active) {
      if (savedBg === null) savedBg = hdScene.background ? hdScene.background.clone() : new hdThree.Color('#e9e3da');
      world.view.clearBg = true;
      hdScene.background = null;
      world.light?.setDof?.(false);
      roamTimer = 7;
      world.goHome?.();
    } else {
      world.view.clearBg = false;
      if (savedBg) { hdScene.background = savedBg; savedBg = null; }
      world.light?.setDof?.(true);
      world.goHome?.();
    }
  }

  async function loadOptions(meshOpts, name) {
    clearMesh();
    const isSpz = /\.spz$/i.test(name);
    opts = { axisIdx: isSpz ? 1 : 0, scale: 1, yOffset: -1.1, yaw: 0 };

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
        // Fallback resolve if SplatMesh initializes synchronously or onLoad isn't awaited
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

  /** Tap on the splat floor to send Reverie walking over to explore that spot! */
  function tap(x, y, W, H) {
    if (!active || world.game) return false;
    ndc.set(x / W * 2 - 1, -(y / H) * 2 + 1);
    ray.setFromCamera(ndc, world.view.cam);
    if (!ray.ray.intersectPlane(floorPlane, hitPt)) return false;
    const tx = Math.max(-1.6, Math.min(1.6, hitPt.x));
    const tz = Math.max(-1.0, Math.min(1.0, hitPt.z));
    if (Math.hypot(tx, tz) > 2.2) return false;
    roamTimer = 14;
    world.walkTo?.(tx, tz);
    gs.sound.sounds.pop?.();
    return true;
  }

  /** Autonomous gentle strolling inside the splat room while idle. */
  function update(dt) {
    if (!active || world.game || world.walking) return;
    const st = world.creature?.state;
    if (st?.listening || st?.speaking || st?.thinking) { roamTimer = Math.max(roamTimer, 6); return; }
    roamTimer -= dt;
    if (roamTimer > 0) return;
    roamTimer = 12 + Math.random() * 10;
    const angle = Math.random() * Math.PI * 2;
    const dist = .35 + Math.random() * .95;
    const tx = Math.max(-1.4, Math.min(1.4, Math.cos(angle) * dist));
    const tz = Math.max(-.8, Math.min(.8, Math.sin(angle) * dist));
    world.walkTo?.(tx, tz);
  }

  function adjust(patch = {}) {
    if (patch.scale != null) opts.scale = Math.max(.1, Math.min(10, +patch.scale || 1));
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
    line: () => active ? ` Teleported into their photorealistic Gaussian Splat room ("${currentName}"), where you can walk around and explore.` : '',
  };
}
