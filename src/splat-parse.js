// Pure Node-testable Gaussian Splat (.splat and .ply) parser for Bring-Your-Own Splat Rooms.
// Supports:
//   1. Standard 32-byte binary `.splat` format (position f32x3, scale f32x3, rgba u8x4, rot u8x4)
//   2. Standard 3DGS `.ply` format (ASCII or binary_little_endian) with x/y/z, f_dc_0/1/2 (or red/green/blue), opacity, scale_0/1/2
// Caps splat count cleanly (default 150,000 via uniform stride) so mobile/laptop GPUs stay at a smooth 30 fps.

const SH_C0 = 0.28209479177387814;
const sigmoid = x => 1 / (1 + Math.exp(-Math.max(-16, Math.min(16, x))));
const clamp01 = x => Math.max(0, Math.min(1, x));

/**
 * Parses a standard 32-byte-per-splat binary `.splat` ArrayBuffer.
 * Returns { count, positions: Float32Array, colors: Float32Array, sizes: Float32Array, bounds }.
 */
export function parseDotSplat(buffer, { maxSplats = 150_000 } = {}) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const total = Math.floor(bytes.byteLength / 32);
  if (total <= 0) throw new Error('Empty .splat file');
  const stride = Math.max(1, Math.ceil(total / maxSplats));
  const count = Math.ceil(total / stride);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  const sizes = new Float32Array(count);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  let out = 0;
  for (let i = 0; i < total; i += stride) {
    const off = i * 32;
    const x = view.getFloat32(off, true);
    const y = -view.getFloat32(off + 4, true);   // OpenCV Y-down -> Three.js Y-up
    const z = -view.getFloat32(off + 8, true);
    const sx = view.getFloat32(off + 12, true);
    const sy = view.getFloat32(off + 16, true);
    const sz = view.getFloat32(off + 20, true);
    const r = bytes[off + 24] / 255;
    const g = bytes[off + 25] / 255;
    const b = bytes[off + 26] / 255;
    const a = bytes[off + 27] / 255;

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    positions[out * 3] = x; positions[out * 3 + 1] = y; positions[out * 3 + 2] = z;
    colors[out * 4] = r; colors[out * 4 + 1] = g; colors[out * 4 + 2] = b; colors[out * 4 + 3] = a;
    sizes[out] = Math.max(.004, Math.min(.35, (Math.abs(sx) + Math.abs(sy) + Math.abs(sz)) / 3));
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    out++;
  }
  return {
    count: out,
    positions: positions.subarray(0, out * 3),
    colors: colors.subarray(0, out * 4),
    sizes: sizes.subarray(0, out),
    bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  };
}

const TYPE_SIZE = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };

/**
 * Parses a 3DGS `.ply` file (ASCII or binary_little_endian).
 */
export function parsePlySplat(buffer, { maxSplats = 150_000 } = {}) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const headText = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 8192)));
  const endMarker = 'end_header';
  const endIdx = headText.indexOf(endMarker);
  if (endIdx < 0) throw new Error('Invalid PLY header');
  let dataStart = endIdx + endMarker.length;
  if (bytes[dataStart] === 13) dataStart++;
  if (bytes[dataStart] === 10) dataStart++;

  const lines = headText.slice(0, endIdx).split(/\r?\n/);
  let format = 'ascii', vertexCount = 0, inVertex = false;
  const props = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('format ')) format = t.split(/\s+/)[1];
    else if (t.startsWith('element ')) {
      const [, name, n] = t.split(/\s+/);
      inVertex = name === 'vertex';
      if (inVertex) vertexCount = parseInt(n, 10) || 0;
    } else if (inVertex && t.startsWith('property ')) {
      const parts = t.split(/\s+/);
      if (parts[1] !== 'list') props.push({ type: parts[1], name: parts[2] });
    }
  }
  if (!vertexCount) throw new Error('PLY has no vertices');

  const stride = Math.max(1, Math.ceil(vertexCount / maxSplats));
  const count = Math.ceil(vertexCount / stride);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  const sizes = new Float32Array(count);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let out = 0;

  const pushSplat = (x, y, z, r, g, b, a, sz) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    positions[out * 3] = x; positions[out * 3 + 1] = -y; positions[out * 3 + 2] = -z;
    colors[out * 4] = clamp01(r); colors[out * 4 + 1] = clamp01(g); colors[out * 4 + 2] = clamp01(b); colors[out * 4 + 3] = clamp01(a);
    sizes[out] = Math.max(.004, Math.min(.35, sz));
    const yy = -y, zz = -z;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (yy < minY) minY = yy; if (yy > maxY) maxY = yy;
    if (zz < minZ) minZ = zz; if (zz > maxZ) maxZ = zz;
    out++;
  };

  if (format === 'ascii') {
    const idx = Object.fromEntries(props.map((p, i) => [p.name, i]));
    const body = new TextDecoder('ascii').decode(bytes.subarray(dataStart)).split(/\r?\n/);
    for (let i = 0; i < vertexCount && i < body.length; i += stride) {
      const cols = body[i].trim().split(/\s+/);
      if (cols.length < 3) continue;
      const get = (n, d = 0) => idx[n] != null ? parseFloat(cols[idx[n]]) : d;
      const x = get('x'), y = get('y'), z = get('z');
      const r = idx.f_dc_0 != null ? 0.5 + SH_C0 * get('f_dc_0') : (idx.red != null ? get('red') / 255 : 0.75);
      const g = idx.f_dc_1 != null ? 0.5 + SH_C0 * get('f_dc_1') : (idx.green != null ? get('green') / 255 : 0.72);
      const b = idx.f_dc_2 != null ? 0.5 + SH_C0 * get('f_dc_2') : (idx.blue != null ? get('blue') / 255 : 0.68);
      const a = idx.opacity != null ? sigmoid(get('opacity')) : 0.9;
      const sz = idx.scale_0 != null ? (Math.exp(get('scale_0')) + Math.exp(get('scale_1')) + Math.exp(get('scale_2'))) / 3 : 0.025;
      pushSplat(x, y, z, r, g, b, a, sz);
    }
  } else if (format === 'binary_little_endian') {
    let rowBytes = 0;
    const offsets = {};
    for (const p of props) {
      offsets[p.name] = { off: rowBytes, type: p.type };
      rowBytes += TYPE_SIZE[p.type] || 4;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset + dataStart, bytes.byteLength - dataStart);
    const read = (base, name, d = 0) => {
      const m = offsets[name]; if (!m) return d;
      const o = base + m.off;
      if (m.type === 'float' || m.type === 'float32') return view.getFloat32(o, true);
      if (m.type === 'double' || m.type === 'float64') return view.getFloat64(o, true);
      if (m.type === 'uchar' || m.type === 'uint8') return view.getUint8(o);
      if (m.type === 'int' || m.type === 'int32') return view.getInt32(o, true);
      return d;
    };
    for (let i = 0; i < vertexCount; i += stride) {
      const base = i * rowBytes;
      if (base + rowBytes > view.byteLength) break;
      const x = read(base, 'x'), y = read(base, 'y'), z = read(base, 'z');
      const r = offsets.f_dc_0 ? 0.5 + SH_C0 * read(base, 'f_dc_0') : (offsets.red ? read(base, 'red') / 255 : 0.75);
      const g = offsets.f_dc_1 ? 0.5 + SH_C0 * read(base, 'f_dc_1') : (offsets.green ? read(base, 'green') / 255 : 0.72);
      const b = offsets.f_dc_2 ? 0.5 + SH_C0 * read(base, 'f_dc_2') : (offsets.blue ? read(base, 'blue') / 255 : 0.68);
      const a = offsets.opacity ? sigmoid(read(base, 'opacity')) : 0.9;
      const sz = offsets.scale_0 ? (Math.exp(read(base, 'scale_0')) + Math.exp(read(base, 'scale_1')) + Math.exp(read(base, 'scale_2'))) / 3 : 0.025;
      pushSplat(x, y, z, r, g, b, a, sz);
    }
  } else {
    throw new Error(`Unsupported PLY format: ${format}`);
  }

  return {
    count: out,
    positions: positions.subarray(0, out * 3),
    colors: colors.subarray(0, out * 4),
    sizes: sizes.subarray(0, out),
    bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  };
}

/** Auto-detects `.ply` vs `.splat` from header magic or filename and parses it. */
export function parseSplatBuffer(buffer, filename = '') {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const isPly = /\.ply$/i.test(filename) || (bytes[0] === 112 && bytes[1] === 108 && bytes[2] === 121); // 'ply'
  return isPly ? parsePlySplat(bytes) : parseDotSplat(bytes);
}
