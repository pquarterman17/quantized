// The interactive 3-D view's frame: the layout (plot area, colour bar), the
// back panes with their grid (matplotlib's look: the three faces farthest from
// the viewer), the axis lines with ticks, tick labels and titles, and the
// colour bar. Theme colours come in as `Ink` (read from the design tokens by
// the caller). Canvas2D; pure apart from drawing.

import { colormapCss } from "../../../lib/colormap";
import { niceTicks } from "../../../lib/niceTicks";
import { axisEdges, backFaces, BOX, boxScale, camera, project, type Camera, type Side, type View3d } from "../../../lib/project3d";
import { fmt } from "../mapColorbar";
import type { Axis3, Scene3d } from "./scene3d";

export interface Ink {
  text: string;
  dim: string;
  grid: string;
  pane: string;
  border: string;
  /** The UI font family (`--font-ui`), for titles; numbers stay JetBrains Mono. */
  ui: string;
}

export interface Frame {
  cam: Camera;
  /** Data -> box coordinate, per axis. */
  map: [(v: number) => number, (v: number) => number, (v: number) => number];
  /** The colour bar's rectangle (CSS px), or null (a waterfall has none). */
  bar: { x: number; y: number; w: number; h: number } | null;
}

const FONT = "11px 'JetBrains Mono', monospace";

/** Lay the view out in a w x h px canvas: the box centred in what the colour
 *  bar and title leave, fitted so tick labels stay inside at zoom 1. */
export function frameFor(scene: Scene3d, view: View3d, w: number, h: number): Frame {
  const barW = scene.kind === "lines" ? 0 : 96;
  const top = scene.title ? 26 : 6;
  const pw = Math.max(40, w - barW), ph = Math.max(40, h - top);
  const cam = camera(view, Math.max(40, pw - 120), Math.max(40, ph - 90), pw / 2, top + ph / 2);
  const map: Frame["map"] = [
    boxScale(scene.x.lo, scene.x.hi, BOX[0]),
    boxScale(scene.y.lo, scene.y.hi, BOX[1]),
    boxScale(scene.z.lo, scene.z.hi, BOX[2]),
  ];
  const bh = Math.min(320, ph * 0.7);
  return { cam, map, bar: barW ? { x: w - barW + 8, y: top + (ph - bh) / 2, w: 14, h: bh } : null };
}

interface Tick {
  v: number;
  label: string;
}

/** Ticks inside [lo, hi]: round 1-2-5 values, or decades (labelled by value)
 *  when the axis holds log10 of the quantity and spans one or more decades. */
export function axisTicks(a: Axis3, log10: boolean, target: number): Tick[] {
  if (log10) {
    const k0 = Math.ceil(a.lo), k1 = Math.floor(a.hi);
    if (k1 - k0 >= 1) {
      const step = Math.max(1, Math.ceil((k1 - k0 + 1) / target));
      const out: Tick[] = [];
      for (let k = k0; k <= k1; k += step) out.push({ v: k, label: Math.abs(k) >= 3 ? `1e${k}` : fmt(10 ** k) });
      return out;
    }
    return niceTicks(a.lo, a.hi, target).filter((v) => v >= a.lo && v <= a.hi).map((v) => ({ v, label: fmt(10 ** v) }));
  }
  return niceTicks(a.lo, a.hi, target).filter((v) => v >= a.lo - 1e-12 * (a.hi - a.lo) && v <= a.hi + 1e-12 * (a.hi - a.lo)).map((v) => ({ v, label: fmt(v) }));
}

const H = BOX.map((s) => s / 2) as [number, number, number];

/** A box point from per-axis box coordinates. */
const P = (c: Camera, x: number, y: number, z: number) => project(c, x, y, z);

/** The three back panes, each with grid lines at the other two axes' ticks. */
export function drawPanes(ctx: CanvasRenderingContext2D, f: Frame, scene: Scene3d, ink: Ink): void {
  const { cam, map } = f;
  const back = backFaces(cam);
  const ticks = [axisTicks(scene.x, false, 5), axisTicks(scene.y, false, 5), axisTicks(scene.z, scene.log10, 5)];
  for (let ax = 0; ax < 3; ax++) {
    const o = [(ax + 1) % 3, (ax + 2) % 3];
    const corner = (s1: number, s2: number) => {
      const p = [0, 0, 0];
      p[ax] = back[ax] * H[ax];
      p[o[0]] = s1 * H[o[0]];
      p[o[1]] = s2 * H[o[1]];
      return P(cam, p[0], p[1], p[2]);
    };
    const quad = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    ctx.beginPath();
    quad.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = ink.pane;
    ctx.fill();
    ctx.strokeStyle = ink.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    // Grid: lines across this pane at each in-plane axis' ticks.
    ctx.beginPath();
    for (const [k, other] of [[0, 1], [1, 0]] as const) {
      const a = o[k];
      for (const t of ticks[a]) {
        const b = map[a](t.v);
        const p0 = [0, 0, 0], p1 = [0, 0, 0];
        p0[ax] = p1[ax] = back[ax] * H[ax];
        p0[a] = p1[a] = b;
        p0[o[other]] = -H[o[other]];
        p1[o[other]] = H[o[other]];
        const s0 = P(cam, p0[0], p0[1], p0[2]), s1 = P(cam, p1[0], p1[1], p1[2]);
        ctx.moveTo(s0[0], s0[1]);
        ctx.lineTo(s1[0], s1[1]);
      }
    }
    ctx.strokeStyle = ink.grid;
    ctx.lineWidth = 0.75;
    ctx.stroke();
  }
}

function unit(dx: number, dy: number): [number, number] {
  const n = Math.hypot(dx, dy);
  return n > 1e-6 ? [dx / n, dy / n] : [0, 1];
}

/** Axis lines on their edges, with ticks, tick labels and the axis titles. */
export function drawAxes(ctx: CanvasRenderingContext2D, f: Frame, scene: Scene3d, ink: Ink): void {
  const { cam, map } = f;
  const edges = axisEdges(cam);
  const axes: [Axis3, [Side, Side], boolean][] = [[scene.x, edges.x, false], [scene.y, edges.y, false], [scene.z, edges.z, scene.log10]];
  ctx.font = FONT;
  axes.forEach(([a, sides, log], ax) => {
    const o = [(ax + 1) % 3, (ax + 2) % 3];
    const at = (b: number): [number, number, number] => {
      const p = [0, 0, 0];
      p[ax] = b;
      if (ax === 2) {
        p[0] = sides[0] * H[0];
        p[1] = sides[1] * H[1];
      } else {
        p[o[0]] = (ax === 0 ? sides[0] : sides[1]) * H[o[0]];
        p[o[1]] = (ax === 0 ? sides[1] : sides[0]) * H[o[1]];
      }
      return P(cam, p[0], p[1], p[2]);
    };
    const s0 = at(-H[ax]), s1 = at(H[ax]);
    // Outward: from the box's centre through this edge, on screen (z: sideways).
    const mid = at(0);
    const centre = P(cam, 0, 0, 0);
    const [ux, uy] = unit(mid[0] - centre[0], ax === 2 ? 0 : mid[1] - centre[1]);
    ctx.strokeStyle = ink.dim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s0[0], s0[1]);
    ctx.lineTo(s1[0], s1[1]);
    const len = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]);
    const ticks = axisTicks(a, log, Math.max(2, Math.min(6, Math.round(len / 70))));
    for (const t of ticks) {
      const p = at(map[ax](t.v));
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[0] + ux * 5, p[1] + uy * 5);
    }
    ctx.stroke();
    ctx.fillStyle = ink.text;
    const align = (x: number, y: number) => {
      ctx.textAlign = x > 0.35 ? "left" : x < -0.35 ? "right" : "center";
      ctx.textBaseline = y > 0.35 ? "top" : y < -0.35 ? "bottom" : "middle";
    };
    align(ux, uy);
    let reach = 0;
    // Tick labels too close together on a foreshortened edge are thinned.
    let last: [number, number] | null = null;
    for (const t of ticks) {
      const p = at(map[ax](t.v));
      const q: [number, number] = [p[0] + ux * 8, p[1] + uy * 8];
      if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 14 + t.label.length * 3) continue;
      ctx.fillText(t.label, q[0], q[1]);
      last = q;
      reach = Math.max(reach, ctx.measureText(t.label).width);
    }
    if (!a.label || len < 20) return;
    // The title clears the tick labels: their extent along the outward direction.
    const off = 8 + Math.abs(ux) * reach + Math.abs(uy) * 13 + 10;
    ctx.save();
    ctx.font = `12px ${ink.ui}`;
    ctx.fillStyle = ink.text;
    if (ax === 2) {
      // z reads vertically, beside its ticks.
      ctx.translate(mid[0] + ux * (off + 6), mid[1]);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.textBaseline = ux < 0 ? "bottom" : "top";
      ctx.fillText(a.label, 0, 0);
    } else {
      align(ux, uy);
      ctx.fillText(a.label, mid[0] + ux * off, mid[1] + uy * off);
    }
    ctx.restore();
  });
  if (scene.title) {
    ctx.save();
    ctx.font = `600 13px ${ink.ui}`;
    ctx.fillStyle = ink.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(scene.title, cam.cx, 6);
    ctx.restore();
  }
}

/** The colour bar over the scene's colour range, labelled like the z axis. */
export function drawColorbar3d(ctx: CanvasRenderingContext2D, f: Frame, scene: Scene3d, ink: Ink): void {
  const r = f.bar;
  if (!r) return;
  const grad = ctx.createLinearGradient(0, r.y + r.h, 0, r.y);
  for (let s = 0; s <= 8; s++) grad.addColorStop(s / 8, colormapCss(scene.cmap, s / 8));
  ctx.fillStyle = grad;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = ink.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
  const [lo, hi] = scene.clim;
  ctx.font = FONT;
  ctx.fillStyle = ink.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.beginPath();
  for (const t of axisTicks({ lo, hi, label: "" }, scene.log10, 6)) {
    const y = r.y + r.h - ((t.v - lo) / (hi - lo)) * r.h;
    ctx.moveTo(r.x + r.w - 3, y);
    ctx.lineTo(r.x + r.w, y);
    ctx.fillText(t.label, r.x + r.w + 4, y);
  }
  ctx.strokeStyle = ink.text;
  ctx.stroke();
  if (scene.z.label) {
    ctx.save();
    ctx.font = `12px ${ink.ui}`;
    ctx.translate(r.x + r.w + 42, r.y + r.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(scene.z.label, 0, 0);
    ctx.restore();
  }
}
