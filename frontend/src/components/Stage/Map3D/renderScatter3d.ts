// The interactive view's 3-D SCATTER extras: per-point colours and radii for the
// marker splat (`render3dMarks.drawPoints` reads them), the wall shadows and
// error bars drawn behind the markers, and the group legend. Rules and
// constants are `scatterExtras3d.ts`'s (the export's own). Canvas2D; pure
// apart from drawing.

import { project } from "../../../lib/project3d";
import type { Frame, Ink } from "./render3dAxes";
import { ERROR_COLOR, GROUP_COLORS, WALL_ALPHA, WALL_COLOR } from "./scatterExtras3d";
import type { PointScene } from "./scene3d";

const abgrOf = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  return (255 << 24) | (b << 16) | (g << 8) | r;
};
const GROUP_ABGR = GROUP_COLORS.map(abgrOf);

/** The packed colour of every drawn point when a column or a group sets it; null = by z. */
export function pointColors(s: PointScene, lut: Uint32Array): Uint32Array | null {
  const e = s.extras;
  if (!e) return null;
  if (e.codes) return Uint32Array.from(e.codes, (c) => GROUP_ABGR[c]);
  if (!e.color) return null;
  const [lo, hi] = s.clim;
  return Uint32Array.from(e.color, (v) => lut[Math.max(0, Math.min(lut.length - 1, Math.round(((v - lo) / (hi - lo || 1)) * (lut.length - 1))))]);
}

/** Marker radius per point (device px): a diameter of d pt is d * 4/3 CSS px across. */
export function pointRadii(s: PointScene, fallback: number, dpr: number): Int32Array | null {
  const d = s.extras?.diameter;
  if (!d) return null;
  return Int32Array.from(d, (v) => Math.max(1, Math.round(((v * 2) / 3) * dpr))).map((r) => (Number.isFinite(r) ? r : fallback));
}

/** Wall shadows (back panes) then error bars, behind the markers. */
export function drawScatterBack(ctx: CanvasRenderingContext2D, f: Frame, s: PointScene, step: number): void {
  const e = s.extras;
  if (!e) return;
  const eye = f.cam.eye;
  const wall = [s.x, s.y, s.z].map((a, k) => (eye[k] > 0 ? a.lo : a.hi));
  const n = s.px.length;
  const at = (i: number, k: number) => [s.px, s.py, s.pz][k][i];
  const rad = (i: number) => (e.diameter ? (e.diameter[i] * 2) / 3 : 2.2);
  ctx.save();
  // Walls: xy (z fixed), xz (y fixed), yz (x fixed).
  [2, 1, 0].forEach((fixed, w) => {
    if (!e.walls[w]) return;
    ctx.beginPath();
    for (let i = 0; i < n; i += step) {
      const v = [at(i, 0), at(i, 1), at(i, 2)];
      v[fixed] = wall[fixed];
      const p = project(f.cam, f.map[0](v[0]), f.map[1](v[1]), f.map[2](v[2]));
      const r = rad(i);
      ctx.moveTo(p[0] + r, p[1]);
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    }
    ctx.globalAlpha = WALL_ALPHA;
    ctx.fillStyle = WALL_COLOR;
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  e.err.forEach((c, k) => {
    if (!c) return;
    ctx.beginPath();
    for (let i = 0; i < n; i += step) {
      if (!Number.isFinite(c[i])) continue;
      const lo = [at(i, 0), at(i, 1), at(i, 2)], hi = [...lo];
      lo[k] -= c[i];
      hi[k] += c[i];
      const a = project(f.cam, f.map[0](lo[0]), f.map[1](lo[1]), f.map[2](lo[2]));
      const b = project(f.cam, f.map[0](hi[0]), f.map[1](hi[1]), f.map[2](hi[2]));
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.strokeStyle = ERROR_COLOR;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  });
  ctx.restore();
}

/** The group legend: a swatch and the name of each group with a drawn point, top left of the plot. */
export function drawLegend3d(ctx: CanvasRenderingContext2D, f: Frame, s: PointScene, ink: Ink): void {
  const e = s.extras;
  if (!e || !e.codes) return;
  ctx.save();
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let y = f.plot.y + 12;
  const x = f.plot.x + 12;
  ctx.fillStyle = ink.text;
  if (e.groupLabel) {
    ctx.fillText(e.groupLabel, x, y);
    y += 16;
  }
  for (const g of e.used) {
    ctx.fillStyle = GROUP_COLORS[g];
    ctx.beginPath();
    ctx.arc(x + 5, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ink.text;
    ctx.fillText(e.names[g], x + 16, y);
    y += 16;
  }
  ctx.restore();
}
