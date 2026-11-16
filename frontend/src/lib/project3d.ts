// The interactive 3-D view's camera (gap audit 5, item 3d): a hand-rolled
// ORTHOGRAPHIC projection, no dependency. Pure.
//
// The convention is matplotlib's, measured, not approximated: with
// `ax.view_init(elev, azim)`, `ax.set_proj_type("ortho")` and the default
// 4:4:3 box (`set_box_aspect((4, 4, 3))`), the screen direction of each data
// axis is exactly
//     right = (-sin a, cos a, 0)             (screen x)
//     up    = (-sin e cos a, -sin e sin a, cos e)   (screen y, up)
// times the box side, with the viewer at eye = (cos e cos a, cos e sin a, sin e).
// `tests/test_export_map3d_view.py` checks this against `ax.get_proj()` for the
// shared fixture's views, so the static export (calc/figure_map3d.set_view) is
// the picture on screen from the same angle.
//
// Coordinates: data -> BOX coordinates (each axis' range onto [-side/2,
// side/2]) -> screen px. The scale does not depend on the angles, so the box
// keeps its size while it turns (matplotlib does the same).

export type Vec3 = readonly [number, number, number];

export interface View3d {
  /** Degrees, -90..90 (looking up from below .. down from above). */
  elev: number;
  /** Degrees; stored wrapped to -180..180 (the export accepts -360..360). */
  azim: number;
  /** Magnification of the fitted box, ZOOM_RANGE. */
  zoom: number;
}

/** matplotlib's default box aspect (4:4:3), as box-coordinate side lengths. */
export const BOX: Vec3 = [1, 1, 0.75];
/** The zoom the view and the export accept (calc/figure_map3d ZOOM_MIN/MAX). */
export const ZOOM_RANGE: readonly [number, number] = [0.5, 3];
/** The box's bounding-sphere radius: the fit that never clips at zoom 1. */
const RADIUS = 0.5 * Math.hypot(BOX[0], BOX[1], BOX[2]);

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 100) / 100;

/** -180 < azim <= 180, two decimals (a stored angle should read cleanly). */
export function wrapAzim(a: number): number {
  const w = ((((a + 180) % 360) + 360) % 360) - 180;
  return round(w === -180 ? 180 : w);
}

export function clampView(v: View3d): View3d {
  return { elev: round(clamp(v.elev, -90, 90)), azim: wrapAzim(v.azim), zoom: round(clamp(v.zoom, ZOOM_RANGE[0], ZOOM_RANGE[1])) };
}

/** Degrees per dragged pixel: a 360-px drag turns the plot half way round. */
export const DRAG_DEG_PER_PX = 0.5;

/** A drag of (dx, dy) px: the plot follows the pointer (drag right turns it
 *  right = azimuth down; drag down tips the top toward you = elevation up). */
export function orbit(v: View3d, dx: number, dy: number): View3d {
  return clampView({ ...v, azim: v.azim - dx * DRAG_DEG_PER_PX, elev: v.elev + dy * DRAG_DEG_PER_PX });
}

/** One wheel notch (deltaY): about 10% per 100 px of scroll. */
export function zoomBy(v: View3d, deltaY: number): View3d {
  return clampView({ ...v, zoom: v.zoom * Math.exp(-deltaY / 1000) });
}

/** Keyboard rotation (a11y): arrows turn 5° (Shift 15°), +/- zoom. Returns
 *  null for any other key, so the caller leaves it alone. */
export function keyStep(v: View3d, key: string, shift: boolean): View3d | null {
  const s = shift ? 15 : 5;
  switch (key) {
    case "ArrowLeft": return clampView({ ...v, azim: v.azim + s });
    case "ArrowRight": return clampView({ ...v, azim: v.azim - s });
    case "ArrowUp": return clampView({ ...v, elev: v.elev + s });
    case "ArrowDown": return clampView({ ...v, elev: v.elev - s });
    case "+": case "=": return clampView({ ...v, zoom: v.zoom * 1.1 });
    case "-": case "_": return clampView({ ...v, zoom: v.zoom / 1.1 });
    default: return null;
  }
}

export interface Camera {
  /** Screen x / screen y (up) / toward-the-viewer unit vectors in box space. */
  right: Vec3;
  up: Vec3;
  eye: Vec3;
  /** px per box unit, and the screen centre (px, y down). */
  scale: number;
  cx: number;
  cy: number;
}

/** The camera for `v`, fitted into a w x h px area centred at (cx, cy). */
export function camera(v: View3d, w: number, h: number, cx = w / 2, cy = h / 2): Camera {
  const e = v.elev * DEG;
  const a = v.azim * DEG;
  const se = Math.sin(e), ce = Math.cos(e), sa = Math.sin(a), ca = Math.cos(a);
  return {
    right: [-sa, ca, 0],
    up: [-se * ca, -se * sa, ce],
    eye: [ce * ca, ce * sa, se],
    scale: (v.zoom * Math.max(1, Math.min(w, h))) / (2 * RADIUS),
    cx,
    cy,
  };
}

/** Box point -> [screen x px, screen y px (down), depth (larger = nearer)]. */
export function project(c: Camera, x: number, y: number, z: number): [number, number, number] {
  const r = c.right, u = c.up, e = c.eye;
  return [
    c.cx + c.scale * (r[0] * x + r[1] * y + r[2] * z),
    c.cy - c.scale * (u[0] * x + u[1] * y + u[2] * z),
    e[0] * x + e[1] * y + e[2] * z,
  ];
}

/** Data range -> box coordinate along one axis (a flat range sits mid-box). */
export function boxScale(lo: number, hi: number, side: number): (v: number) => number {
  const span = hi - lo;
  if (!(span > 0)) return () => 0;
  return (v) => ((v - lo) / span - 0.5) * side;
}

/** The two box sides an axis may sit on: -1 = the low face, +1 = the high one. */
export type Side = -1 | 1;

/** For each axis, the face of the box FARTHER from the viewer: the pane that
 *  is drawn (with its grid) behind the data, matplotlib's back panes. */
export function backFaces(c: Camera): [Side, Side, Side] {
  return [c.eye[0] > 0 ? -1 : 1, c.eye[1] > 0 ? -1 : 1, c.eye[2] > 0 ? -1 : 1];
}

/** Where each axis' ticks go, as the box edge (the other two coordinates'
 *  sides): x and y on the BOTTOM edge nearest the viewer (the top one when
 *  looking from below); z on the vertical edge farthest RIGHT on screen that
 *  is not the front-most corner's. */
export function axisEdges(c: Camera): { x: [Side, Side]; y: [Side, Side]; z: [Side, Side] } {
  const [bx, by, floor] = backFaces(c); // the back z face is the floor seen from above
  // A vertical edge (sx, sy): its screen x is right . (sx*X/2, sy*Y/2).
  const cand: [Side, Side][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const front: [Side, Side] = [(-bx) as Side, (-by) as Side];
  const sx = (e: [Side, Side]) => c.right[0] * e[0] * BOX[0] + c.right[1] * e[1] * BOX[1];
  const zEdge = cand.filter((e) => e[0] !== front[0] || e[1] !== front[1]).sort((p, q) => sx(q) - sx(p))[0]; // matplotlib's side
  return { x: [(-by) as Side, floor], y: [(-bx) as Side, floor], z: zEdge };
}
