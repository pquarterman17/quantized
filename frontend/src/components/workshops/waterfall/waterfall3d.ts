// A 3-D waterfall of N SEPARATE curves (gap-5 lane F, audit 3c): each included
// dataset's channel is one curve, placed along a third (depth) axis by its
// position or by the number in its name (`lib/depthFromName`). Each curve goes
// to the SAME `/api/export/map-figure` route as its own polyline -- its points in
// ORIGINAL order, at its own depth (`contour_source: "curves"`): no shared x
// grid, no union, no sort, so a hysteresis loop stays a loop and the request is
// O(total points). The preview is that request as a PNG, the export the same
// request in the chosen format. Pure.

import type { MapFigureSpec } from "../../../lib/api/mapFigure";
import { depthFromName } from "../../../lib/depthFromName";
import type { WaterfallSeries } from "../../../lib/waterfall";

export type DepthBy = "index" | "number";

export interface Curve3dOptions {
  channel: string;
  depth: DepthBy;
  elev: number;
  azim: number;
  cmap: string;
  style: string;
  title: string;
  /** Axis labels with their units ("H (T)", "M (emu)"); blank falls back. */
  xLabel?: string;
  zLabel?: string;
}

export type Curve3dResult = { ok: true; body: MapFigureSpec } | { ok: false; error: string };

export function curveWaterfallBody(series: readonly WaterfallSeries[], o: Curve3dOptions, fmt: string, filename: string): Curve3dResult {
  if (!Number.isFinite(o.elev) || Math.abs(o.elev) > 90) return { ok: false, error: "elevation must be from -90 to 90 degrees" };
  if (!Number.isFinite(o.azim) || Math.abs(o.azim) > 360) return { ok: false, error: "azimuth must be from -360 to 360 degrees" };
  const curves: { x: number[]; z: number[]; depth: number }[] = [];
  const seen = new Map<number, string>();
  for (const [i, s] of series.entries()) {
    const x: number[] = [];
    const z: number[] = [];
    s.x.forEach((xv, j) => {
      if (Number.isFinite(xv) && Number.isFinite(s.y[j])) {
        x.push(xv);
        z.push(s.y[j]);
      }
    });
    if (x.length < 2) continue; // nothing to draw; the count check below says so
    const depth = o.depth === "index" ? i : depthFromName(s.label);
    if (depth === null) return { ok: false, error: `"${s.label}" has no number in its name to place it by; use the curve order instead` };
    const clash = seen.get(depth);
    if (clash !== undefined) return { ok: false, error: `"${clash}" and "${s.label}" both sit at depth ${depth}; rename them or use the curve order` };
    seen.set(depth, s.label);
    curves.push({ x, z, depth });
  }
  if (curves.length < 2) return { ok: false, error: `a 3-D waterfall needs at least 2 curves with 2 or more points; found ${curves.length}` };
  return {
    ok: true,
    body: {
      contour_source: "curves",
      curves,
      kind: "waterfall",
      view_elev: o.elev,
      view_azim: o.azim,
      cmap: o.cmap,
      fmt,
      style: o.style,
      title: o.title,
      x_label: o.xLabel || "x",
      y_label: o.depth === "index" ? "Curve" : "Number in name",
      z_label: o.zLabel || o.channel,
      filename,
    },
  };
}
