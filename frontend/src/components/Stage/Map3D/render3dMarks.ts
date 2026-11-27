// The interactive 3-D view's marks. Pure apart from drawing.
//
//   * surface: one quad per grid cell, coloured by its corners' mean z (as
//     matplotlib's plot_surface), HIDDEN-SURFACE ORDERED by the painter's
//     algorithm -- quads sorted far to near by mean depth and painted in that
//     order. A quad touching a gap is not drawn.
//   * points: a z-buffer splat into one ImageData (1e5 points in a few ms; one
//     fillStyle change per point would take ~100x longer), with an optional
//     drop line from each point to the floor under it.
//   * lines: one polyline per waterfall curve, painted far to near.
//
// LIMITS of the painter's algorithm (recorded, not hidden): quads are ordered
// by MEAN depth, so two quads that interpenetrate, or a long thin quad behind a
// short one, can paint in the wrong order -- matplotlib's own `zsort="average"`
// makes the same choice, so screen and export err alike. Points use a true
// z-buffer and have no such case; waterfall curves are ordered whole, by mean
// depth.
//
// INTERACTION BUDGET: while the view is moving (`fast`), a surface is drawn on
// a grid strided to at most FAST_CELLS cells a side and a cloud to at most
// FAST_POINTS points; the full scene is drawn once the view settles. Both are
// counted in the returned stats (the load-invariant thing tests assert).

import { colormap, type ColormapName } from "../../../lib/colormap";
import { project } from "../../../lib/project3d";
import type { Frame } from "./render3dAxes";
import { drawBars, drawVectors, extPickPoints } from "./renderExt3d";
import { drawScatterBack, pointColors, pointRadii } from "./renderScatter3d";
import type { LineScene, PointScene, Scene3d, SurfaceScene } from "./scene3d";

export const FAST_CELLS = 64;
export const FAST_POINTS = 20_000;
/** Drop lines on more points are thinned evenly (every k-th point), as the
 *  export thins them (`calc/figure_map3d.py` DROP_LINES_MAX). */
export const DROP_LINES_MAX = 5_000;

/** Every pickable vertex as drawn: screen px, depth, and its data index. */
export interface PickSet {
  sx: Float32Array;
  sy: Float32Array;
  depth: Float32Array;
  /** Data value at each pickable vertex. */
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
}

export interface DrawStats {
  /** Quads, points or line vertices actually painted. */
  drawn: number;
}

const LUT_N = 256;
const lutCache = new Map<ColormapName, { css: string[]; abgr: Uint32Array }>();
function lut(name: ColormapName) {
  let l = lutCache.get(name);
  if (!l) {
    const css: string[] = [];
    const abgr = new Uint32Array(LUT_N);
    for (let i = 0; i < LUT_N; i++) {
      const [r, g, b] = colormap(name, i / (LUT_N - 1));
      css.push(`rgb(${r},${g},${b})`);
      abgr[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
    l = { css, abgr };
    lutCache.set(name, l);
  }
  return l;
}

const lutIndex = (v: number, lo: number, hi: number) =>
  Math.max(0, Math.min(LUT_N - 1, Math.round(((v - lo) / (hi - lo || 1)) * (LUT_N - 1))));

/** Grid indices stepped by `s`, the last one always kept. */
function stepped(n: number, s: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n - 1; i += s) out.push(i);
  out.push(n - 1);
  return out;
}

/** The surface's quads as painted: the (possibly strided) projected grid, the
 *  drawable quads (no gap corner) and their paint order, FAR TO NEAR by mean
 *  depth -- the painter's algorithm. Pure. */
export function surfaceQuads(f: Frame, s: SurfaceScene, fast: boolean) {
  const nx = s.xs.length, ny = s.ys.length;
  const step = fast ? Math.max(1, Math.ceil(Math.max(nx, ny) / FAST_CELLS)) : 1;
  const gi = stepped(nx, step), gj = stepped(ny, step);
  const mx = gi.length, my = gj.length;
  const px = new Float64Array(mx * my), py = new Float64Array(mx * my), pd = new Float64Array(mx * my);
  const pz = new Float64Array(mx * my);
  for (let b = 0; b < my; b++) for (let a = 0; a < mx; a++) {
    const z = s.zs[gj[b] * nx + gi[a]];
    const k = b * mx + a;
    pz[k] = z;
    if (!Number.isFinite(z)) continue;
    const p = project(f.cam, f.map[0](s.xs[gi[a]]), f.map[1](s.ys[gj[b]]), f.map[2](z));
    px[k] = p[0];
    py[k] = p[1];
    pd[k] = p[2];
  }
  const quads: number[] = [];
  const depth: number[] = [];
  for (let b = 0; b < my - 1; b++) for (let a = 0; a < mx - 1; a++) {
    const k = b * mx + a;
    if (!(Number.isFinite(pz[k]) && Number.isFinite(pz[k + 1]) && Number.isFinite(pz[k + mx]) && Number.isFinite(pz[k + mx + 1]))) continue;
    quads.push(k);
    depth.push((pd[k] + pd[k + 1] + pd[k + mx + 1] + pd[k + mx]) / 4);
  }
  const order = Uint32Array.from(quads.keys()).sort((p, q) => depth[p] - depth[q]);
  return { mx, my, px, py, pz, quads, depth, order };
}

function drawSurface(ctx: CanvasRenderingContext2D, f: Frame, s: SurfaceScene, fast: boolean, mesh: string): DrawStats {
  const { mx, my, px, py, pz, quads, order } = surfaceQuads(f, s, fast);
  const { css } = lut(s.cmap);
  const [lo, hi] = s.clim;
  // A coarse grid shows its mesh (shape reads better); a fine one hides the
  // antialiasing seams between quads with a hairline of the quad's own colour.
  const showMesh = Math.max(mx, my) <= 70;
  ctx.lineWidth = showMesh ? 0.6 : 0.5;
  ctx.lineJoin = "round";
  for (const q of order) {
    const k = quads[q];
    const c = [k, k + 1, k + mx + 1, k + mx];
    const col = css[lutIndex((pz[c[0]] + pz[c[1]] + pz[c[2]] + pz[c[3]]) / 4, lo, hi)];
    ctx.beginPath();
    ctx.moveTo(px[c[0]], py[c[0]]);
    ctx.lineTo(px[c[1]], py[c[1]]);
    ctx.lineTo(px[c[2]], py[c[2]]);
    ctx.lineTo(px[c[3]], py[c[3]]);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    if (showMesh) {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = mesh;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = col;
      ctx.stroke();
    }
  }
  return { drawn: order.length };
}

/** Every `pointStride`-th point is drawn: all of them once the view is still. */
export const pointStride = (n: number, fast: boolean): number => (fast ? Math.max(1, Math.ceil(n / FAST_POINTS)) : 1);

/** The splat buffers, per drawn canvas: freed with the canvas when the view unmounts. */
const splats = new WeakMap<HTMLCanvasElement, { w: number; h: number; img: ImageData; depth: Float32Array; canvas: HTMLCanvasElement }>();

function drawPoints(ctx: CanvasRenderingContext2D, f: Frame, s: PointScene, fast: boolean, dpr: number, drop: string): DrawStats {
  const n = s.px.length;
  const step = pointStride(n, fast);
  const W = ctx.canvas.width, H = ctx.canvas.height;
  let splat = splats.get(ctx.canvas);
  if (!splat || splat.w !== W || splat.h !== H) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    splat = { w: W, h: H, img: new ImageData(W, H), depth: new Float32Array(W * H), canvas };
    splats.set(ctx.canvas, splat);
  }
  const buf = new Uint32Array(splat.img.data.buffer);
  buf.fill(0);
  const zb = splat.depth;
  zb.fill(-Infinity);
  const { abgr } = lut(s.cmap);
  const [lo, hi] = s.clim;
  // Marker radius (device px): smaller for dense clouds.
  const r0 = Math.max(1, Math.round((n > 20_000 ? 1.5 : n > 2_000 ? 2.2 : 3) * dpr));
  // Extras: a colour per point (column or group) and a radius per point (size column).
  const colors = pointColors(s, abgr);
  const radii = pointRadii(s, r0, dpr);
  const floor = f.map[2](s.z.lo);
  const dropStep = Math.ceil(n / DROP_LINES_MAX);
  if (s.drop) ctx.beginPath();
  let drawn = 0;
  for (let i = 0; i < n; i += step) {
    const bx = f.map[0](s.px[i]), by = f.map[1](s.py[i]);
    const [sx, sy, d] = project(f.cam, bx, by, f.map[2](s.pz[i]));
    if (s.drop && i % dropStep === 0) {
      const g = project(f.cam, bx, by, floor);
      ctx.moveTo(g[0], g[1]);
      ctx.lineTo(sx, sy);
    }
    const cx = Math.round(sx * dpr), cy = Math.round(sy * dpr);
    const col = colors ? colors[i] : abgr[lutIndex(s.pz[i], lo, hi)];
    const r = radii ? radii[i] : r0, r2 = r * r, rin2 = (r - 1) * (r - 1);
    // The marker's rim is darkened 30%, so overlapping markers stay distinct.
    const rim = (255 << 24) | ((((col >> 16) & 255) * 0.7) << 16) | ((((col >> 8) & 255) * 0.7) << 8) | ((col & 255) * 0.7);
    for (let dy = -r; dy <= r; dy++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -r; dx <= r; dx++) {
        const q = dx * dx + dy * dy;
        if (q > r2) continue;
        const xx = cx + dx;
        if (xx < 0 || xx >= W) continue;
        const o = yy * W + xx;
        if (d <= zb[o]) continue;
        zb[o] = d;
        buf[o] = q > rin2 ? rim : col;
      }
    }
    drawn++;
  }
  if (s.drop) {
    ctx.strokeStyle = drop;
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  const octx = splat.canvas.getContext("2d");
  if (octx) {
    octx.putImageData(splat.img, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(splat.canvas, 0, 0);
    ctx.restore();
  }
  return { drawn };
}

function drawLines(ctx: CanvasRenderingContext2D, f: Frame, s: LineScene): DrawStats {
  const { css } = lut(s.cmap);
  const proj = s.lines.map((l) => {
    const pts: number[] = [];
    let dsum = 0;
    for (let i = 0; i < l.x.length; i++) {
      const p = project(f.cam, f.map[0](l.x[i]), f.map[1](l.y[i]), f.map[2](l.z[i]));
      pts.push(p[0], p[1]);
      dsum += p[2];
    }
    return { pts, depth: dsum / Math.max(1, l.x.length), col: css[Math.round(l.t * (LUT_N - 1))] };
  });
  proj.sort((a, b) => a.depth - b.depth);
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  let drawn = 0;
  for (const l of proj) {
    ctx.beginPath();
    ctx.moveTo(l.pts[0], l.pts[1]);
    for (let i = 2; i < l.pts.length; i += 2) ctx.lineTo(l.pts[i], l.pts[i + 1]);
    ctx.strokeStyle = l.col;
    ctx.stroke();
    drawn += l.pts.length / 2;
  }
  return { drawn };
}

export function drawMarks(
  ctx: CanvasRenderingContext2D, f: Frame, s: Scene3d, fast: boolean, dpr: number, ink: { mesh: string; drop: string },
): DrawStats {
  if (s.kind === "surface") return drawSurface(ctx, f, s, fast, ink.mesh);
  if (s.kind === "points") {
    if (s.extras) drawScatterBack(ctx, f, s, pointStride(s.px.length, fast));
    return drawPoints(ctx, f, s, fast, dpr, ink.drop);
  }
  if (s.kind === "bars") return { drawn: drawBars(ctx, f, s, ink.mesh) };
  if (s.kind === "vectors") return { drawn: drawVectors(ctx, f, s) };
  return drawLines(ctx, f, s);
}

/** Every vertex the scene draws, projected for the current frame (built once
 *  the view settles; hover reads it). */
export function pickSet(f: Frame, s: Scene3d): PickSet {
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  if (s.kind === "surface") {
    const nx = s.xs.length;
    for (let j = 0; j < s.ys.length; j++) for (let i = 0; i < nx; i++) {
      const z = s.zs[j * nx + i];
      if (!Number.isFinite(z)) continue;
      xs.push(s.xs[i]);
      ys.push(s.ys[j]);
      zs.push(z);
    }
  } else if (s.kind === "points") {
    return withProjection(f, s.px, s.py, s.pz);
  } else if (s.kind === "bars" || s.kind === "vectors") {
    return withProjection(f, ...extPickPoints(s));
  } else {
    for (const l of s.lines) for (let i = 0; i < l.x.length; i++) {
      xs.push(l.x[i]);
      ys.push(l.y[i]);
      zs.push(l.z[i]);
    }
  }
  return withProjection(f, Float64Array.from(xs), Float64Array.from(ys), Float64Array.from(zs));
}

function withProjection(f: Frame, x: Float64Array, y: Float64Array, z: Float64Array): PickSet {
  const n = x.length;
  const sx = new Float32Array(n), sy = new Float32Array(n), depth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = project(f.cam, f.map[0](x[i]), f.map[1](y[i]), f.map[2](z[i]));
    sx[i] = p[0];
    sy[i] = p[1];
    depth[i] = p[2];
  }
  return { sx, sy, depth, x, y, z };
}

/** The vertex under (px, py): among those within `radius` px, the nearest on
 *  screen of the ones at the FRONT (within 0.03 box units of the nearest
 *  depth), so a hover never reads a point hidden behind the surface. A
 *  HEURISTIC, not a ray cast: it picks vertices, not the surface between them
 *  (a hover mid-quad reads its nearest front corner), and a near-vertical fold
 *  thinner than 0.03 box units can read either sheet. A linear scan, fine to
 *  ~1e6 vertices; it is rebuilt only when the view settles. */
export function pick(set: PickSet, px: number, py: number, radius = 10): number | null {
  const r2 = radius * radius;
  let front = -Infinity;
  for (let i = 0; i < set.sx.length; i++) {
    const dx = set.sx[i] - px, dy = set.sy[i] - py;
    if (dx * dx + dy * dy <= r2 && set.depth[i] > front) front = set.depth[i];
  }
  if (front === -Infinity) return null;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < set.sx.length; i++) {
    if (set.depth[i] < front - 0.03) continue;
    const dx = set.sx[i] - px, dy = set.sy[i] - py, q = dx * dx + dy * dy;
    if (q <= r2 && q < bestD) {
      bestD = q;
      best = i;
    }
  }
  return best >= 0 ? best : null;
}
