// Rug marks on an XY series (plan item 20): a short tick for every finite point
// along the X axis (up from the bottom edge), the Y axis (right from the left
// edge) or both, in the series colour. The export counterpart is
// `calc/figure_series_rug.py` (same edges, same length rule: a fraction of the
// plot height for X ticks and of its width for Y ticks). Lazy with the other
// marks (`marksImpl`), keyed by uPlot data-column index (1-based).

import type uPlot from "uplot";

import { RUG_LENGTH, RUG_OPACITY } from "./statCdf";
import type { DropLines, SeriesStyle } from "./seriesStyleTypes";
import { seriesStrokeColor } from "./uplotDropLines";

interface SeriesRug {
  mode: DropLines;
  length: number;
  opacity: number;
}

const within = (v: number | undefined, r: { min: number; max: number; default: number }) =>
  typeof v === "number" && v >= r.min && v <= r.max ? v : r.default;

export function rugPlugin(rugs: Map<number, SeriesRug>): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        if (rugs.size === 0) return;
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const xs = u.data[0];
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.lineWidth = 1;
        for (const [col, rug] of rugs) {
          const ys = u.data[col];
          if (!ys || u.series[col]?.show === false) continue;
          ctx.strokeStyle = seriesStrokeColor(u, col);
          ctx.globalAlpha = rug.opacity;
          const scaleKey = u.series[col]?.scale ?? "y";
          ctx.beginPath();
          for (let i = 0; i < xs.length; i++) {
            const x = xs[i];
            const y = ys[i];
            if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
            if (rug.mode === "x" || rug.mode === "both") {
              const px = u.valToPos(x, "x", true);
              ctx.moveTo(px, top + height);
              ctx.lineTo(px, top + height - rug.length * height);
            }
            if (rug.mode === "y" || rug.mode === "both") {
              const py = u.valToPos(y, scaleKey, true);
              ctx.moveTo(left, py);
              ctx.lineTo(left + rug.length * width, py);
            }
          }
          ctx.stroke();
        }
        ctx.restore();
      },
    },
  };
}

/** The plugin list for `buildOpts`: one `rugPlugin` over every display series
 *  whose style asks for a rug (`styles[i]` is uPlot column i + 1), or none. */
export function rugPlugins(styles: readonly (SeriesStyle | undefined)[] | undefined): uPlot.Plugin[] {
  const rugs = new Map<number, SeriesRug>();
  styles?.forEach((st, i) => {
    if (st?.rug && st.bars !== "horizontal") {
      rugs.set(i + 1, { mode: st.rug, length: within(st.rugLength, RUG_LENGTH), opacity: within(st.rugOpacity, RUG_OPACITY) });
    }
  });
  return rugs.size > 0 ? [rugPlugin(rugs)] : [];
}
