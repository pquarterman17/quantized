// Drop lines (gap audit 3, N6): a dotted segment from each point to the X axis
// (down to the bottom edge of the plot area) and/or the Y axis (left to the
// left edge). The export counterpart is `calc/figure_marks.apply_drop_lines`
// (axis bottom / left after the limits are final) — the same edges.
//
// The sibling of `errorBarsPlugin`/`colorScatterPlugin` in uplotOverlays.ts
// (kept in its own module: that file is over the god-module ceiling and only
// ever shrinks). `drops` is keyed by uPlot data-column index (1-based).

import type uPlot from "uplot";

import type { DropLines, SeriesStyle } from "./seriesStyleTypes";

/** A series' resolved stroke: uPlot turns the configured string into a function once initialised. */
export function seriesStrokeColor(u: uPlot, col: number): string {
  const st = u.series[col]?.stroke as unknown;
  const c = typeof st === "function" ? (st as (u: uPlot, i: number) => unknown)(u, col) : st;
  return typeof c === "string" ? c : "#888";
}

/** Draw each series' drop lines behind nothing in particular: uPlot's `draw`
 *  hook runs after the series, so these sit over the line — thin and dotted. */
export function dropLinesPlugin(drops: Map<number, DropLines>): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        if (drops.size === 0) return;
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const xs = u.data[0];
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        for (const [col, mode] of drops) {
          const ys = u.data[col];
          if (!ys || u.series[col]?.show === false) continue;
          ctx.strokeStyle = seriesStrokeColor(u, col);
          const scaleKey = u.series[col]?.scale ?? "y";
          ctx.beginPath();
          for (let i = 0; i < xs.length; i++) {
            const x = xs[i];
            const y = ys[i];
            if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
            const px = u.valToPos(x, "x", true);
            const py = u.valToPos(y, scaleKey, true);
            if (mode === "x" || mode === "both") {
              ctx.moveTo(px, py);
              ctx.lineTo(px, top + height);
            }
            if (mode === "y" || mode === "both") {
              ctx.moveTo(px, py);
              ctx.lineTo(left, py);
            }
          }
          ctx.stroke();
        }
        ctx.restore();
      },
    },
  };
}

/** The plugin list for `buildOpts`: one `dropLinesPlugin` over every display
 *  series whose style asks for drop lines (`styles[i]` is display series i,
 *  uPlot column i + 1), or none. */
export function dropLinePlugins(styles: readonly (SeriesStyle | undefined)[] | undefined): uPlot.Plugin[] {
  const drops = new Map<number, DropLines>();
  styles?.forEach((st, i) => {
    if (st?.dropLines) drops.set(i + 1, st.dropLines);
  });
  return drops.size > 0 ? [dropLinesPlugin(drops)] : [];
}
