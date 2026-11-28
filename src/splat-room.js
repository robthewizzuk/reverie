// Gaussian Splat Room Teleporter (src/splat-room.js):
// Renders `.splat`, `.ply`, and `.spz` 3D Gaussian Splat scans via WebGPU + WebGL compatible InstancedMesh quads
// (unlike PointsMaterial, which WebGPU clamps to 1px), teleports Reverie cleanly out of the procedural workshop
// (hiding all workshop furniture/shelves/props so nothing floats), adds an invisible shadow-catcher floor,
// and lets Reverie walk around autonomously or wherever you tap on the splat floor!
import gs from '../engine/src/gamescroll.js';
import { parseSplatAsync } from './splat-parse.js';

let gaussianSprite = null;
function getGaussianSprite(THREE) {
  if (gaussianSprite) return gaussianSprite;
  const S = 64, c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d'), img = ctx.createImageData(S, S), d = img.data;
  const half = S / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x - half + .5) / half, dy = (y - half + .5) / half;
      const r2 = dx * dx + dy * dy;
      const a = r2 >= 1 ? 0 : Math.exp(-3.0 * r2);
      const i = (y * S + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  gaussianSprite = new THREE.CanvasTexture(c);
  gaussianSprite.needsUpdate = true;
  return gaussianSprite;
}

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

export function makeSplatRoom({ world, setWorkshopVisible = () => {} }) {
  const { THREE } = gs.hd;
  const scene = world.view.scene;
  const holder = new THREE.Group();
  holder.name = 'splat-room';
  holder.visible = false;
  scene.add(holder);

  // Invisible shadow catcher floor so Reverie, pets, and thrown props cast real shadows onto the splat floor
  const catcher = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.ShadowMaterial({ opacity: .45 }),
  );
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = .002;
  catcher.receiveShadow = true;
  holder.add(catcher);

  let mesh = null, currentName = '', active = false;
  let opts = { scale: 1, yOffset: 0, yaw: 0, splatScale: 1.65 };
  let roamTimer = 8;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitPt = new THREE.Vector3();

  function clearMesh() {
    if (!mesh) return;
    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
    holder.remove(mesh);
    mesh = null;
  }

  function applyTransform() {
    if (!mesh) return;
    mesh.scale.setScalar(opts.scale);
    mesh.position.y = opts.yOffset;
    mesh.rotation.y = opts.yaw;
  }

  function teleportEffect(entering) {
    portalFlash();
    gs.sound.sounds.whoosh?.();
    gs.sound.sounds.bell?.();
    world.creature?.gesture?.(entering ? 'tada' : 'wave');
    world.creature?.mood?.('excited');
  }

  function setActive(on, { silent = false } = {}) {
    const next = !!on && !!mesh;
    if (next !== active && !silent) teleportEffect(next);
    active = next;
    holder.visible = active;
    setWorkshopVisible(!active);
    world.light?.setDof?.(!active);
    if (active) {
      roamTimer = 7;
      world.goHome?.();
    } else {
      world.goHome?.();
    }
  }

  async function loadBuffer(buffer, name = 'room.splat') {
    const parsed = await parseSplatAsync(buffer, name);
    if (!parsed.count) throw new Error('No visible splats found in file.');
    clearMesh();

    // Auto-center X/Z and snap the 8th-percentile floor near y = 0 using robust percentile bounds
    const [cx, , cz] = parsed.bounds.center;
    const floorY = parsed.bounds.floorY;
    const span = parsed.bounds.span;
    // Scale room so its 5th–95th percentile diameter is ~5.2m around Reverie
    const autoScale = +(5.2 / Math.max(.4, span)).toFixed(4);

    // Crossed billboarded-style quad geometry (two perpendicular planes so splats stay full from every viewing angle)
    const g1 = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: getGaussianSprite(THREE),
      transparent: true,
      alphaTest: .08,
      side: THREE.DoubleSide,
      depthWrite: true,
      toneMapped: false,
    });

    const inst = new THREE.InstancedMesh(g1, mat, parsed.count);
    inst.frustumCulled = false;

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const camPos = world.view.cam?.position || new THREE.Vector3(0, .95, 2.5);

    for (let i = 0; i < parsed.count; i++) {
      const x = (parsed.positions[i * 3] - cx) * autoScale;
      const y = (parsed.positions[i * 3 + 1] - floorY) * autoScale;
      const z = (parsed.positions[i * 3 + 2] - cz) * autoScale;
      // Compute generous splat quad diameter so neighboring Gaussians overlap smoothly into a solid room
      const s = Math.max(.032, Math.min(.42, parsed.sizes[i] * autoScale * 2.4 * opts.splatScale));
      dummy.position.set(x, y, z);
      dummy.lookAt(camPos);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);

      col.setRGB(parsed.colors[i * 4], parsed.colors[i * 4 + 1], parsed.colors[i * 4 + 2]);
      inst.setColorAt(i, col);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;

    mesh = inst;
    holder.add(mesh);
    currentName = name;
    opts = { scale: 1, yOffset: 0, yaw: 0, splatScale: 1.65 };
    applyTransform();
    setActive(true);
    return { ok: true, count: parsed.count, name };
  }

  async function loadFile(file) {
    if (!file) return { ok: false, error: 'No file selected.' };
    const buf = await file.arrayBuffer();
    return loadBuffer(buf, file.name || 'room.splat');
  }

  async function loadUrl(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not fetch splat (${res.status})`);
    const buf = await res.arrayBuffer();
    return loadBuffer(buf, url.split('/').pop() || 'room.splat');
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
    if (patch.scale != null) opts.scale = Math.max(.25, Math.min(4, +patch.scale || 1));
    if (patch.yOffset != null) opts.yOffset = Math.max(-2, Math.min(2, +patch.yOffset || 0));
    if (patch.yaw != null) opts.yaw = +patch.yaw || 0;
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
    loadFile, loadBuffer, loadUrl, setActive, adjust, unload, tap, update,
    line: () => active ? ` Teleported into their Gaussian Splat room ("${currentName}"), where you can walk around and explore.` : '',
  };
}
