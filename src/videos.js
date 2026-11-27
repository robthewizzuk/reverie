// Small pure helpers for watching videos together (watch.js), apart so tests can run them without the engine.

/** A video someone pasted or said: { kind: 'youtube', id, start } or null. Bare ids only when `bare`. */
export function videoOf(text, bare = false) {
  const s = String(text || '').trim();
  const m = /(?:youtube\.com\/(?:watch\?(?:[^ ]*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([A-Za-z0-9_-]{11})/i.exec(s);
  const id = m?.[1] || (bare && /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null);
  if (!id) return null;
  const t = /[?&#](?:t|start)=(\d+h)?(\d+m)?(\d+)s?\b/.exec(s);
  const start = t ? (parseInt(t[1]) || 0) * 3600 + (parseInt(t[2]) || 0) * 60 + (+t[3] || 0) : 0;
  return { kind: 'youtube', id, start };
}

export const clock = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
// ---- fitting the player onto the screen in the room: a CSS matrix3d from the screen's four corners on the canvas
/** The CSS transform that maps a w x h box onto the four points (top left, top right, bottom right, bottom left). */
export function fitQuad(w, h, [p0, p1, p2, p3]) {
  const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], dx3 = p0[0] - p1[0] + p2[0] - p3[0];
  const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1], dy3 = p0[1] - p1[1] + p2[1] - p3[1];
  const den = dx1 * dy2 - dx2 * dy1;
  const g = den ? (dx3 * dy2 - dx2 * dy3) / den : 0, k = den ? (dx1 * dy3 - dx3 * dy1) / den : 0;
  const a = p1[0] - p0[0] + g * p1[0], b = p3[0] - p0[0] + k * p3[0], c = p0[0];
  const d = p1[1] - p0[1] + g * p1[1], e = p3[1] - p0[1] + k * p3[1], f = p0[1];
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.map(x => +x.toPrecision(9)).join(',')})`;
}

