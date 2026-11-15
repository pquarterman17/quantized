// The colour-mapped scatter DRAWING (MAIN #14), moved out of the eager bundle
// for the budget (origin gap audit 4): `uplotOverlays.colorScatterPlugin`
// keeps its options and calls this through the region-decor startup chunk
// (`lib/regionDecorLoader.ts`, re-exported by `lib/uplotRegionShades.ts`). A
// plot drawn before the chunk lands rebuilds once it settles
// (`Stage/useLazyPlotParts.startupOverlayCount` counts colour-mapped columns).

import type uPlot from "uplot";

import { colorScatterFill, paintColorPoint, type ColorScatterSpec } from "./colorscatter";

/** Default colour-mapped-scatter point diameter (CSS px) — matches the
 *  default marker size the regular per-series marker styling uses
 *  (`SeriesStyleCard`'s `NumberField` placeholder). */
const COLOR_SCATTER_SIZE = 5;

/** `colorScatterPlugin`'s draw: every colour-mapped column's points. */
export function drawColorScatter(u: uPlot, specs: Map<number, ColorScatterSpec>): void {
  if (specs.size === 0) return;
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const xs = u.data[0];
  const r = COLOR_SCATTER_SIZE / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  for (const [col, spec] of specs) {
    const ys = u.data[col];
    if (!ys || spec.diam || u.series[col]?.show === false) continue; // a size-by series is the lazy `sizeScatterPlugin`'s
    const scaleKey = u.series[col]?.scale ?? "y";
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i];
      const y = ys[i];
      if (x == null || y == null) continue;
      const fill = colorScatterFill(spec, i); // the one colour rule (P1.4 gradient shares it)
      if (fill === null) continue;
      paintColorPoint(ctx, u.valToPos(x, "x", true), u.valToPos(y, scaleKey, true), r, fill, spec.shape, spec.hollow);
    }
  }
  ctx.restore();
}
