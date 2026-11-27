// The interactive view's 3-D BAR and VECTOR marks (`render3dMarks.drawMarks`
// dispatches here).
//
//   * bars: every VISIBLE face of every box (a face is visible when its outward
//     normal points at the viewer), the faces of ALL bars sorted far to near by
//     their mean depth and painted in that order -- the painter's algorithm, as
//     matplotlib's `bar3d` (a `Poly3DCollection`, `zsort="average"`) paints. A
//     face is shaded by its direction as `bar3d(shade=True)` does (light from
//     azimuth 225, altitude 19.47: the front-left faces light, the right dark),
//     so a screen and an export read alike (not to the digit).
//   * vectors: one stroked path of every shaft and head barb.
//
// Pure apart from drawing.

import { colormap, type ColormapName } from "../../../lib/colormap";
import { project } from "../../../lib/project3d";
import type { Frame } from "./render3dAxes";
import type { BarScene, VectorScene } from "./scene3d";

const LUT_N = 256;

/** A box face: its outward normal axis/sign and its four corners as (ix, iy, iz) 0|1 bits. */
interface Face {
  axis: 0 | 1 | 2;
  sign: -1 | 1;
  corners: [number, number, number][];
  /** bar3d's shade of this normal, 0.5..1. */
  shade: number;
}

// bar3d's light direction (azdeg 225, altdeg 19.4712) dotted with each normal,
// then 0.5 + 0.5 * normalised over the six faces' range [-2/3, 2/3].
const LIGHT = [-2 / 3, -2 / 3, 1 / 3];
const shadeOf = (axis: number, sign: number) => 0.5 + 0.5 * ((sign * LIGHT[axis] + 2 / 3) / (4 / 3));

const ring = (axis: number, v: number): [number, number, number][] => {
  const a = (axis + 1) % 3, c = (axis + 2) % 3;
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([p, q]) => {
    const o: [number, number, number] = [0, 0, 0];
    o[axis] = v;
    o[a] = p;
    o[c] = q;
    return o;
  });
};

export const FACES: Face[] = ([0, 1, 2] as const).flatMap((axis) =>
  ([-1, 1] as const).map((sign) => ({ axis, sign, corners: ring(axis, sign < 0 ? 0 : 1), shade: shadeOf(axis, sign) })),
);

/** A bar's two z levels and its box corner in data coordinates. */
export function barBox(s: BarScene, i: number) {
  const z0 = Math.min(s.base, s.bz[i]), z1 = Math.max(s.base, s.bz[i]);
  return { x0: s.bx[i] - s.dx / 2, x1: s.bx[i] + s.dx / 2, y0: s.by[i] - s.dy / 2, y1: s.by[i] + s.dy / 2, z0, z1 };
}

function rgbOf(s: BarScene, i: number): [number, number, number] {
  if (s.fixed) return [1, 3, 5].map((k) => parseInt(s.fixed!.slice(k, k + 2), 16)) as [number, number, number];
  const [lo, hi] = s.clim;
  const t = Math.max(0, Math.min(1, (s.bz[i] - lo) / (hi - lo || 1)));
  return colormap(s.cmap as ColormapName, Math.round(t * (LUT_N - 1)) / (LUT_N - 1)) as [number, number, number];
}

/** The painted faces, far to near: `[bar, face]` pairs with their mean depth. */
export function barFaces(f: Frame, s: BarScene) {
  const out: { bar: number; face: number; depth: number; pts: number[] }[] = [];
  const e = f.cam.eye;
  for (let i = 0; i < s.bx.length; i++) {
    const b = barBox(s, i);
    const lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
    FACES.forEach((face, fi) => {
      if (face.sign * e[face.axis] <= 0) return;
      const pts: number[] = [];
      let depth = 0;
      for (const c of face.corners) {
        const v = c.map((bit, k) => f.map[k](bit ? hi[k] : lo[k]));
        const p = project(f.cam, v[0], v[1], v[2]);
        pts.push(p[0], p[1]);
        depth += p[2] / 4;
      }
      out.push({ bar: i, face: fi, depth, pts });
    });
  }
  return out.sort((p, q) => p.depth - q.depth);
}

export function drawBars(ctx: CanvasRenderingContext2D, f: Frame, s: BarScene, edge: string): number {
  const faces = barFaces(f, s);
  const rgb = new Map<number, [number, number, number]>();
  ctx.lineWidth = 0.5;
  ctx.lineJoin = "round";
  for (const q of faces) {
    let c = rgb.get(q.bar);
    if (!c) rgb.set(q.bar, (c = rgbOf(s, q.bar)));
    const k = FACES[q.face].shade;
    ctx.beginPath();
    ctx.moveTo(q.pts[0], q.pts[1]);
    for (let j = 2; j < 8; j += 2) ctx.lineTo(q.pts[j], q.pts[j + 1]);
    ctx.closePath();
    ctx.fillStyle = `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = edge;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  return faces.length;
}

export function drawVectors(ctx: CanvasRenderingContext2D, f: Frame, s: VectorScene): number {
  ctx.beginPath();
  const g = s.segs;
  for (let i = 0; i < g.length; i += 6) {
    const a = project(f.cam, f.map[0](g[i]), f.map[1](g[i + 1]), f.map[2](g[i + 2]));
    const b = project(f.cam, f.map[0](g[i + 3]), f.map[1](g[i + 4]), f.map[2](g[i + 5]));
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.strokeStyle = s.color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.stroke();
  return g.length / 30;
}

/** The vertices hover reads: a bar's top centre, a vector's tail. */
export function extPickPoints(s: BarScene | VectorScene): [Float64Array, Float64Array, Float64Array] {
  if (s.kind === "bars") return [s.bx, s.by, s.bz];
  const n = s.tails.length / 3;
  return [0, 1, 2].map((k) => Float64Array.from({ length: n }, (_, i) => s.tails[3 * i + k])) as [Float64Array, Float64Array, Float64Array];
}

/** The line under the preview saying what is drawn and what was left out. */
export function extCaption(s: BarScene | VectorScene): string {
  const n = (v: number) => v.toLocaleString("en-US");
  if (s.kind === "bars") return `Drawing ${n(s.bx.length)} bars.`;
  const drawn = s.segs.length / 30;
  return `Drawing ${n(drawn)} vectors${s.hidden ? `; ${n(s.hidden)} rows not drawn (non-finite or zero length)` : ""}.`;
}
