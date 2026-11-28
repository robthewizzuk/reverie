// Pure Node-testable Gaussian Splat (.splat, .ply, .spz) parser for Reverie's Splat Room teleporter.
// Supports:
//   1. Standard 32-byte binary `.splat` format (position f32x3, scale f32x3, rgba u8x4, rot u8x4)
//   2. Standard 3DGS `.ply` format (ASCII or binary_little_endian)
//   3. Niantic / Scaniverse / WorldLabs `.spz` v2 format (gzipped packed splats)
// Uses 5th–95th percentile bounds so distant outlier splats never shrink or shift the room off-camera.

const SH_C0 = 0.28209479177387814;
const sigmoid = x => 1 / (1 + Math.exp(-Math.max(-16, Math.min(16, x))));
const clamp01 = x => Math.max(0, Math.min(1, x));

/** Computes robust 5th–95th percentile bounds so stray outlier splats don't blow up auto-scaling. */
function computeRobustBounds(positions, count) {
  if (!count) return { min: [-1, 0, -1], max: [1, 2, 1], center: [0, 0, 0], floorY: 0, span: 2 };
  const sampleN = Math.min(count, 4096);
  const step = Math.max(1, Math.floor(count / sampleN));
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < count; i += step) {
    xs.push(positions[i * 3]);
    ys.push(positions[i * 3 + 1]);
    zs.push(positions[i * 3 + 2]);
  }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * p)))];
  const minX = pct(xs, .05), maxX = pct(xs, .95);
  const minY = pct(ys, .05), maxY = pct(ys, .95);
  const minZ = pct(zs, .05), maxZ = pct(zs, .95);
  const cx = pct(xs, .5), cz = pct(zs, .5);
  const span = Math.max(.25, Math.hypot(maxX - minX, maxZ - minZ));
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [cx, minY, cz],
    floorY: pct(ys, .08),
    span,
  };
}

/**
 * Parses a standard 32-byte-per-splat binary `.splat` ArrayBuffer.
 */
export function parseDotSplat(buffer, { maxSplats = 65_000 } = {}) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const total = Math.floor(bytes.byteLength / 32);
  if (total <= 0) throw new Error('Empty .splat file');
  const stride = Math.max(1, Math.ceil(total / maxSplats));
  const count = Math.ceil(total / stride);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  const sizes = new Float32Array(count);

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

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || a < .03) continue;
    positions[out * 3] = x; positions[out * 3 + 1] = y; positions[out * 3 + 2] = z;
    colors[out * 4] = r; colors[out * 4 + 1] = g; colors[out * 4 + 2] = b; colors[out * 4 + 3] = a;
    sizes[out] = Math.max(.008, Math.min(.4, (Math.abs(sx) + Math.abs(sy) + Math.abs(sz)) / 3));
    out++;
  }
  const pos = positions.subarray(0, out * 3);
  return {
    count: out,
    positions: pos,
    colors: colors.subarray(0, out * 4),
    sizes: sizes.subarray(0, out),
    bounds: computeRobustBounds(pos, out),
  };
}

const TYPE_SIZE = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };

/**
 * Parses a 3DGS `.ply` file (ASCII or binary_little_endian).
 */
export function parsePlySplat(buffer, { maxSplats = 65_000 } = {}) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const headText = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 16384)));
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
  let out = 0;

  const pushSplat = (x, y, z, r, g, b, a, sz) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || a < .03) return;
    positions[out * 3] = x; positions[out * 3 + 1] = -y; positions[out * 3 + 2] = -z;
    colors[out * 4] = clamp01(r); colors[out * 4 + 1] = clamp01(g); colors[out * 4 + 2] = clamp01(b); colors[out * 4 + 3] = clamp01(a);
    sizes[out] = Math.max(.008, Math.min(.4, sz));
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
      const sz = idx.scale_0 != null ? (Math.exp(get('scale_0')) + Math.exp(get('scale_1')) + Math.exp(get('scale_2'))) / 3 : 0.035;
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
      if (m.type === 'char' || m.type === 'int8') return view.getInt8(o);
      if (m.type === 'short' || m.type === 'int16') return view.getInt16(o, true);
      if (m.type === 'ushort' || m.type === 'uint16') return view.getUint16(o, true);
      if (m.type === 'int' || m.type === 'int32') return view.getInt32(o, true);
      if (m.type === 'uint' || m.type === 'uint32') return view.getUint32(o, true);
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
      const sz = offsets.scale_0 ? (Math.exp(read(base, 'scale_0')) + Math.exp(read(base, 'scale_1')) + Math.exp(read(base, 'scale_2'))) / 3 : 0.035;
      pushSplat(x, y, z, r, g, b, a, sz);
    }
  } else {
    throw new Error(`Unsupported PLY format: ${format}`);
  }

  const pos = positions.subarray(0, out * 3);
  return {
    count: out,
    positions: pos,
    colors: colors.subarray(0, out * 4),
    sizes: sizes.subarray(0, out),
    bounds: computeRobustBounds(pos, out),
  };
}

/**
 * Parses an already-gunzipped Niantic/WorldLabs `.spz` v2 buffer (magic 0x5053474e 'NGSP').
 */
export function parseSpzUncompressed(buffer, { maxSplats = 65_000 } = {}) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (bytes.byteLength < 16) throw new Error('Invalid SPZ file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== 0x5053474e) throw new Error('Not a valid SPZ header');
  const version = view.getUint32(4, true);
  const numPoints = view.getUint32(8, true);
  const fractionalBits = bytes[13] || 12;
  const posScale = 1 / (1 << fractionalBits);
  if (!numPoints) throw new Error('SPZ has no splats');

  const posBytes = version >= 2 ? 9 : 6; // v2: 24-bit signed fixed-point x3
  const posOff = 16;
  const alphaOff = posOff + numPoints * posBytes;
  const colorOff = alphaOff + numPoints;
  const scaleOff = colorOff + numPoints * 3;
  if (scaleOff + numPoints * 3 > bytes.byteLength) throw new Error('Truncated SPZ data');

  const readInt24 = o => {
    let v = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
    if (v & 0x800000) v |= 0xff000000;
    return v * posScale;
  };

  const stride = Math.max(1, Math.ceil(numPoints / maxSplats));
  const count = Math.ceil(numPoints / stride);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  const sizes = new Float32Array(count);
  let out = 0;

  for (let i = 0; i < numPoints; i += stride) {
    const a = bytes[alphaOff + i] / 255;
    if (a < .03) continue;
    let x, y, z;
    if (version >= 2) {
      const po = posOff + i * 9;
      x = readInt24(po); y = readInt24(po + 3); z = readInt24(po + 6);
    } else {
      const po = posOff + i * 6;
      x = view.getInt16(po, true) * posScale;
      y = view.getInt16(po + 2, true) * posScale;
      z = view.getInt16(po + 4, true) * posScale;
    }
    const co = colorOff + i * 3;
    const shScale = 0.15;
    const r = clamp01(0.5 + SH_C0 * ((bytes[co] / 255 - 0.5) / shScale));
    const g = clamp01(0.5 + SH_C0 * ((bytes[co + 1] / 255 - 0.5) / shScale));
    const b = clamp01(0.5 + SH_C0 * ((bytes[co + 2] / 255 - 0.5) / shScale));
    const so = scaleOff + i * 3;
    const sx = Math.exp(bytes[so] / 16 - 10);
    const sy = Math.exp(bytes[so + 1] / 16 - 10);
    const sz = Math.exp(bytes[so + 2] / 16 - 10);

    positions[out * 3] = x; positions[out * 3 + 1] = y; positions[out * 3 + 2] = z;
    colors[out * 4] = r; colors[out * 4 + 1] = g; colors[out * 4 + 2] = b; colors[out * 4 + 3] = a;
    sizes[out] = Math.max(.008, Math.min(.4, (sx + sy + sz) / 3));
    out++;
  }
  const pos = positions.subarray(0, out * 3);
  return {
    count: out,
    positions: pos,
    colors: colors.subarray(0, out * 4),
    sizes: sizes.subarray(0, out),
    bounds: computeRobustBounds(pos, out),
  };
}

/** Auto-detects `.spz`, `.ply`, or `.splat` from header magic or filename and parses it (sync for .splat/.ply, async-safe via parseSplatAsync for gzipped .spz). */
export function parseSplatBuffer(buffer, filename = '') {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (bytes[0] === 0x4e && bytes[1] === 0x47 && bytes[2] === 0x53 && bytes[3] === 0x50) return parseSpzUncompressed(bytes);
  const isPly = /\.ply$/i.test(filename) || (bytes[0] === 112 && bytes[1] === 108 && bytes[2] === 121); // 'ply'
  return isPly ? parsePlySplat(bytes) : parseDotSplat(bytes);
}

/** Async parser that also transparently gunzips `.spz` files in browsers & Node 18+. */
export async function parseSplatAsync(buffer, filename = '') {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (isGzip && typeof DecompressionStream === 'function') {
    const ds = new DecompressionStream('gzip');
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return parseSplatBuffer(out, filename);
  }
  return parseSplatBuffer(bytes, filename);
}
