// Looking around the room: drag to swing the camera around Reverie, pinch or scroll to come closer or step back, and
// the recentre button (or a new game seat) eases it back. The view is kept as offsets from the seat the stage wants
// (home, or a game's seat), so a game's camera still works and recentring is just the offsets easing to nothing.
// A press that hardly moves is still a tap (handed to onTap on release), so poking Reverie and playing games work.

import { SHELL, shellR } from './shell.js';

/** How far you can look around, from the seat. Angles in radians. */
export const LIMITS = { yaw: 1.2, pitchUp: .9, pitchDown: .35, lowest: -.05, highest: 1.25, near: .5, far: 1.6 };

/**
 * The inside of the room the camera stays in, in metres (Reverie stands at 0, 0; the back wall is at z -1.6 and the
 * window wall at x -2.1). A rounded room changes only this: inside(p) moves a point back inside it.
 */
export const ROOM = { min: [-1.85, .15, -1.35], max: [1.95, 2.7, 2.25] };
const WALL_GAP = .3;   // (how near the round wall the camera may come, metres)
export function inside(p, seat = null) {
  // (a seat a game chose is never pulled in: the camera may always go as far out as the seat it sits at)
  for (let i = 0; i < 3; i++) p[i] = Math.min(Math.max(ROOM.max[i], seat?.[i] ?? -Infinity), Math.max(Math.min(ROOM.min[i], seat?.[i] ?? Infinity), p[i]));
  // the room is round (shell.js): a point too near its curved wall or dome is pulled back towards the middle
  const dx = p[0] - SHELL.cx, dz = p[2] - SHELL.cz, d = Math.hypot(dx, dz);
  const r = Math.max(shellR(Math.atan2(dz, dx), p[1]) - WALL_GAP, seat ? Math.hypot(seat[0] - SHELL.cx, seat[2] - SHELL.cz) : 0);
  if (d > Math.max(r, 0) && d > 1e-6) { const k = Math.max(r, 0) / d; p[0] = SHELL.cx + dx * k; p[2] = SHELL.cz + dz * k; }
  return p;
}

const TAP_PX = 8;   // (a press that moves less than this is a tap)

/**
 * makeLook({ el, onTap, onMove }): el is the canvas. onTap(x, y, e) gets a tap in CSS pixels from the canvas's corner;
 * onMove() hears that you started looking around. Returns { view(seat, dt), recentre(), moved, size(w, h), stop() }.
 */
export function makeLook({ el, onTap = () => {}, onMove = () => {} }) {
  const want = { yaw: 0, pitch: 0, zoom: 1 }, now = { yaw: 0, pitch: 0, zoom: 1 }, spin = { yaw: 0, pitch: 0 };
  const downs = new Map();   // pointer id -> { x, y, sx, sy, t }
  let W = 360, H = 640, dragging = false, pinch = null, lastSeat = null;

  const clampWant = () => {
    want.yaw = Math.max(-LIMITS.yaw, Math.min(LIMITS.yaw, want.yaw));
    want.pitch = Math.max(-LIMITS.pitchDown, Math.min(LIMITS.pitchUp, want.pitch));
    want.zoom = Math.max(LIMITS.near, Math.min(LIMITS.far, want.zoom));
  };
  const turn = (dx, dy) => { want.yaw -= dx / Math.max(W, 1) * Math.PI * .9; want.pitch += dy / Math.max(H, 1) * 2.2; clampWant(); };
  const spread = () => { const [a, b] = [...downs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const middle = () => { const p = [...downs.values()]; return { x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length }; };
  const local = e => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  function down(e) {
    if (e.button > 0) return;
    const p = local(e);
    downs.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, t: e.timeStamp });
    try { el.setPointerCapture(e.pointerId); } catch {}
    spin.yaw = spin.pitch = 0;
    if (downs.size === 2) { pinch = { d: spread(), zoom: want.zoom, mid: middle() }; startDrag(); }
  }
  function startDrag() { if (!dragging) { dragging = true; onMove(); } }
  function move(e) {
    const d = downs.get(e.pointerId); if (!d) return;
    const p = local(e), dx = p.x - d.x, dy = p.y - d.y, dt = Math.max(1, e.timeStamp - d.t);
    if (!dragging && Math.hypot(p.x - d.sx, p.y - d.sy) > TAP_PX) startDrag();
    d.x = p.x; d.y = p.y; d.t = e.timeStamp;
    if (!dragging) return;
    if (pinch && downs.size >= 2) {
      const m = middle();
      want.zoom = pinch.zoom * pinch.d / Math.max(20, spread());
      turn(m.x - pinch.mid.x, m.y - pinch.mid.y); pinch.mid = m;
      clampWant();
    } else if (downs.size === 1) {
      turn(dx, dy);
      // (how fast it was going, so a flick carries on a little after you let go)
      spin.yaw = -dx / Math.max(W, 1) * Math.PI * .9 / dt * 1000; spin.pitch = dy / Math.max(H, 1) * 2.2 / dt * 1000;
    }
  }
  function up(e) {
    const d = downs.get(e.pointerId); if (!d) return;
    downs.delete(e.pointerId);
    try { el.releasePointerCapture(e.pointerId); } catch {}
    if (e.type === 'pointerup' && !dragging && downs.size === 0) onTap(d.x, d.y, e);
    if (e.timeStamp - d.t > 80) spin.yaw = spin.pitch = 0;   // (held still before letting go: no flick)
    if (downs.size < 2) pinch = null;
    if (downs.size === 0) dragging = false;
    else for (const q of downs.values()) { q.sx = q.x; q.sy = q.y; }
  }
  function wheel(e) {
    e.preventDefault();
    want.zoom *= Math.exp(e.deltaY * (e.deltaMode === 1 ? .05 : .0015)); clampWant();
    onMove();
  }
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });

  const near = (a, b, e = 1e-3) => Math.abs(a - b) < e;
  return {
    /** True while the view is away from the seat (the recentre button shows then). */
    get moved() { return Math.abs(want.yaw) > .04 || Math.abs(want.pitch) > .04 || Math.abs(want.zoom - 1) > .04; },
    get dragging() { return dragging; },
    size(w, h) { W = w; H = h; },
    /** Back to the seat, eased. */
    recentre() { want.yaw = want.pitch = 0; want.zoom = 1; spin.yaw = spin.pitch = 0; },
    /** For tests: look this far round (radians) and this much closer (zoom: 1 is the seat, under 1 is nearer). */
    set(o) { Object.assign(want, o); clampWant(); },
    get offsets() { return { ...now }; },
    /**
     * Where the camera goes this frame: seat is { pos, look } (arrays, where the stage's camera is now), the result
     * too. goal is the seat it is heading for: a new one (a game starting or ending) recentres, so you arrive at it.
     */
    view(seat, dt, goal = seat) {
      const key = goal;
      if (lastSeat !== null && key !== lastSeat && !dragging) this.recentre();
      lastSeat = key;
      if (!dragging && (spin.yaw || spin.pitch)) {
        want.yaw += spin.yaw * dt; want.pitch += spin.pitch * dt; clampWant();
        const f = Math.exp(-dt * 6); spin.yaw *= f; spin.pitch *= f;
        if (Math.abs(spin.yaw) < .01 && Math.abs(spin.pitch) < .01) spin.yaw = spin.pitch = 0;
      }
      const k = 1 - Math.exp(-dt * (dragging ? 14 : 6));
      for (const n of ['yaw', 'pitch', 'zoom']) { now[n] += (want[n] - now[n]) * k; if (near(now[n], want[n])) now[n] = want[n]; }
      const [px, py, pz] = seat.pos, [lx, ly, lz] = seat.look;
      const dx = px - lx, dy = py - ly, dz = pz - lz, r = Math.hypot(dx, dy, dz) || 1;
      const yaw = Math.atan2(dx, dz) + now.yaw;
      const pitch = Math.max(LIMITS.lowest, Math.min(LIMITS.highest, Math.asin(dy / r) + now.pitch)), d = r * now.zoom;
      const pos = inside([lx + d * Math.cos(pitch) * Math.sin(yaw), ly + d * Math.sin(pitch), lz + d * Math.cos(pitch) * Math.cos(yaw)], seat.pos);
      return { pos, look: seat.look };
    },
    stop() {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('wheel', wheel);
    },
  };
}
