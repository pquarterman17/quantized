// A 3-D waterfall of N SEPARATE curves (gap-5 lane F, audit 3c): each included
// dataset's channel is one curve, offset along a third (depth) axis by its
// position or by the number in its name ("300K" -> 300, `lib/firstNumber`, the
// reader the series gradient and the worksheet's order-by-parameter share).
// The curves are put on one x grid with the workshop's own `alignToUnionX` and
// sent to the SAME `/api/export/map-figure` route as a `waterfall` over
// (x, depth) -- the preview is that request as a PNG, the export the same
// request in the chosen format. Pure.

import type { MapFigureSpec } from "../../../lib/api/mapFigure";
import { firstNumber } from "../../../lib/firstNumber";
import { alignToUnionX, type WaterfallSeries } from "../../../lib/waterfall";

export type DepthBy = "index" | "number";

export interface Curve3dOptions {
  channel: string;
  depth: DepthBy;
  elev: number;
  azim: number;
  cmap: string;
  style: string;
  title: string;
}

export type Curve3dResult = { ok: true; body: MapFigureSpec } | { ok: false; error: string };

export function curveWaterfallBody(series: readonly WaterfallSeries[], o: Curve3dOptions, fmt: string, filename: string): Curve3dResult {
  if (series.length < 2) return { ok: false, error: "a 3-D waterfall needs at least 2 curves; include more datasets" };
  if (!Number.isFinite(o.elev) || Math.abs(o.elev) > 90) return { ok: false, error: "elevation must be from -90 to 90 degrees" };
  if (!Number.isFinite(o.azim) || Math.abs(o.azim) > 360) return { ok: false, error: "azimuth must be from -360 to 360 degrees" };
  const depths: number[] = [];
  for (const [i, s] of series.entries()) {
    const d = o.depth === "index" ? i : firstNumber(s.label);
    if (d === null) return { ok: false, error: `"${s.label}" has no number in its name to place it by; use the curve order instead` };
    depths.push(d);
  }
  const { x, ys } = alignToUnionX(series.map((s) => ({ id: s.id, label: s.label, x: s.x, y: s.y.map((v) => (Number.isFinite(v) ? v : null)), offset: 0 })));
  if (x.length < 2) return { ok: false, error: "the curves share fewer than 2 x values" };
  return {
    ok: true,
    body: {
      x_axis: x,
      y_axis: depths,
      z_grid: ys,
      kind: "waterfall",
      view_elev: o.elev,
      view_azim: o.azim,
      cmap: o.cmap,
      fmt,
      style: o.style,
      title: o.title,
      x_label: "x",
      y_label: o.depth === "index" ? "Curve" : "Number in name",
      z_label: o.channel,
      filename,
    },
  };
}
