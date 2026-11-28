// Bring-Your-Own Gaussian Splat Room (src/splat-room.js):
// Renders any standard `.splat` or `.ply` 3D Gaussian Splat scan (e.g. from Luma, Polycam, Scaniverse, or WorldLabs)
// as Reverie's room backdrop using WebGPU + WebGL compatible Gaussian-falloff sprites, paired with an invisible
// Three.js ShadowMaterial floor so Reverie, pets, and props cast real shadows onto your photographed room!
import gs from '../engine/src/gamescroll.js';
import { parseSplatBuffer } from './splat-parse.js';

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
      const a = r2 >= 1 ? 0 : Math.exp(-3.2 * r2);
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

export function makeSplatRoom({ world, roomGroup }) {
  const { THREE } = gs.hd;
  const scene = world.view.scene;
  const holder = new THREE.Group();
  holder.name = 'splat-room';
  holder.visible = false;
  scene.add(holder);

  // Invisible shadow catcher so Reverie, pets, and thrown props cast real shadows onto the Gaussian Splat floor
  const catcher = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.ShadowMaterial({ opacity: .42 }),
  );
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = .002;
  catcher.receiveShadow = true;
  holder.add(catcher);

  let points = null, currentName = '', active = false;
  let opts = { scale: 1, yOffset: 0, yaw: 0, pointSize: .055 };

  function clearPoints() {
    if (!points) return;
    points.geometry?.dispose?.();
    points.material?.dispose?.();
    holder.remove(points);
    points = null;
  }

  function applyTransform() {
    if (!points) return;
    points.scale.setScalar(opts.scale);
    points.position.y = opts.yOffset;
    points.rotation.y = opts.yaw;
    points.material.size = opts.pointSize * opts.scale;
  }

  function setActive(on) {
    active = !!on && !!points;
    holder.visible = active;
    if (roomGroup) roomGroup.visible = !active;
  }

  async function loadBuffer(buffer, name = 'room.splat') {
    const parsed = parseSplatBuffer(buffer, name);
    clearPoints();
    const geom = new THREE.BufferGeometry();
    // Auto-center X/Z and snap the 5th-percentile floor near y = 0 so Reverie stands naturally inside the scan
    const [minX, minY, minZ] = parsed.bounds.min;
    const [maxX, maxY, maxZ] = parsed.bounds.max;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const span = Math.max(.5, Math.hypot(maxX - minX, maxZ - minZ));
    const autoScale = span > 8 || span < 1.5 ? +(4.2 / span).toFixed(3) : 1;

    const pos = new Float32Array(parsed.positions.length);
    const rgb = new Float32Array(parsed.count * 3);
    for (let i = 0; i < parsed.count; i++) {
      pos[i * 3]     = (parsed.positions[i * 3] - cx) * autoScale;
      pos[i * 3 + 1] = (parsed.positions[i * 3 + 1] - minY) * autoScale;
      pos[i * 3 + 2] = (parsed.positions[i * 3 + 2] - cz) * autoScale;
      // Weight RGB by opacity slightly for clean soft splat blending
      const a = Math.max(.15, parsed.colors[i * 4 + 3]);
      rgb[i * 3]     = parsed.colors[i * 4] * a;
      rgb[i * 3 + 1] = parsed.colors[i * 4 + 1] * a;
      rgb[i * 3 + 2] = parsed.colors[i * 4 + 2] * a;
    }
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    geom.computeBoundingSphere();

    const mat = new THREE.PointsMaterial({
      size: opts.pointSize,
      sizeAttenuation: true,
      map: getGaussianSprite(THREE),
      vertexColors: true,
      transparent: true,
      opacity: .92,
      alphaTest: .04,
      depthWrite: true,
    });
    points = new THREE.Points(geom, mat);
    points.frustumCulled = false;
    holder.add(points);
    currentName = name;
    opts = { scale: 1, yOffset: 0, yaw: 0, pointSize: .055 };
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

  function adjust(patch = {}) {
    if (patch.scale != null) opts.scale = Math.max(.25, Math.min(4, +patch.scale || 1));
    if (patch.yOffset != null) opts.yOffset = Math.max(-2, Math.min(2, +patch.yOffset || 0));
    if (patch.yaw != null) opts.yaw = +patch.yaw || 0;
    if (patch.pointSize != null) opts.pointSize = Math.max(.015, Math.min(.2, +patch.pointSize || .055));
    applyTransform();
  }

  function unload() {
    setActive(false);
    clearPoints();
    currentName = '';
  }

  return {
    get active() { return active; },
    get name() { return currentName; },
    loadFile, loadBuffer, loadUrl, setActive, adjust, unload,
    line: () => active ? ` Room backdrop: photo-scanned Gaussian Splat room ("${currentName}").` : '',
  };
}
