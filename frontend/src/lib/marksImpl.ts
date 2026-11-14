// The lazy half of the data-driven marks (see `marksLoader.ts`): everything a
// plot that uses none of them must not pay for.

import type { ColorScatterSpec } from "./colorscatter";
import { fmtNum } from "./format";
import { buildSizeKey, sizeDiameter, sizeLegendEntries } from "./sizescatter";
import type { DataStruct, SeriesStyle } from "./types";

export { SPLINE_PATHS } from "./uplotSpline";
import { colorScatterFill, paintColorPoint } from "./colorscatter";
import { dropLinePlugins, seriesStrokeColor } from "./uplotDropLines";
import type uPlot from "uplot";

/** The canvas draw of size-by series (the eager `colorScatterPlugin` skips them): each point at its
 *  own diameter, in its colour-by colour or the series' stroke. */
export function sizeScatterPlugin(specs: Map<number, ColorScatterSpec>): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const xs = u.data[0];
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        for (const [col, spec] of specs) {
          const ys = u.data[col];
          if (!ys || !spec.diam) continue;
          const scaleKey = u.series[col]?.scale ?? "y";
          const flat = seriesStrokeColor(u, col);
          for (let i = 0; i < xs.length; i++) {
            const x = xs[i];
            const y = ys[i];
            const d = spec.diam[i];
            if (x == null || y == null || d == null) continue;
            const fill = spec.flat ? flat : colorScatterFill(spec, i);
            if (fill === null) continue;
            paintColorPoint(ctx, u.valToPos(x, "x", true), u.valToPos(y, scaleKey, true), d / 2, fill, spec.shape, spec.hollow);
          }
        }
        drawSizeKey(u, [...specs.values()]);
        ctx.restore();
      },
    },
  };
}

/** The size key, bottom right of the plot area (the export's second legend sits there too):
 *  the channel's label, then three discs at its min / middle / max with their values. */
function drawSizeKey(u: uPlot, specs: ColorScatterSpec[]): void {
  const { ctx } = u;
  const k = window.devicePixelRatio || 1;
  const { left, top, width, height } = u.bbox;
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--text-faint").trim() || "#888";
  ctx.font = `${11 * k}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let y = top + height - 6 * k;
  for (const e of sizeLegendEntries(specs).reverse()) {
    for (const m of [...e.marks].reverse()) {
      const r = (m.px / 2) * k;
      y -= r;
      ctx.beginPath();
      ctx.arc(left + width - 40 * k, y, r, 0, Math.PI * 2);
      ctx.fillStyle = ink;
      ctx.fill();
      ctx.fillText(fmtNum(m.value), left + width - 30 * k, y);
      y -= r + 4 * k;
    }
    ctx.fillText(e.label, left + width - 40 * k - ctx.measureText(e.label).width / 2, y);
    y -= 14 * k;
  }
}

/** Everything `buildOpts` registers for the marks: drop lines and the size-by points. */
export function marksPlugins(
  styles: readonly (SeriesStyle | undefined)[] | undefined,
  columns?: Map<number, ColorScatterSpec>,
): uPlot.Plugin[] {
  const sized = new Map([...(columns ?? [])].filter(([, s]) => s.diam));
  return [...dropLinePlugins(styles), ...(sized.size ? [sizeScatterPlugin(sized)] : [])];
}

/** Add N5 size-by to the colour-by columns: a size-only series gets a flat spec
 *  (its own stroke), a colour-by one keeps its colours; both gain the per-row
 *  diameters and the size key. A column with no finite size value is left as
 *  it was (the series then draws normally). Keyed like `buildColorByColumns`. */
export function withSizes(
  base: Map<number, ColorScatterSpec>,
  ds: DataStruct,
  plotted: readonly number[],
  styles: Record<number, SeriesStyle>,
): Map<number, ColorScatterSpec> {
  let out = base;
  plotted.forEach((ch, p) => {
    const style = styles[ch];
    const sizeCh = style?.sizeBy;
    if (sizeCh == null) return;
    const key = buildSizeKey(ds, sizeCh, style?.sizeRange);
    if (!key) return;
    const have = base.get(p + 1);
    if (!have && style?.colorBy != null) return; // its colour column is empty: nothing drawn here
    const spec: ColorScatterSpec = have
      ? { ...have }
      : {
          channel: sizeCh, z: [], colormap: "viridis", lo: 0, hi: 1, flat: true,
          ...(style?.markerFill === "hollow" ? { hollow: true } : {}),
          ...(style?.markerShape ? { shape: style.markerShape } : {}),
        };
    spec.size = key;
    spec.diam = ds.values.map((row) => sizeDiameter(key, row[sizeCh]));
    if (out === base) out = new Map(base);
    out.set(p + 1, spec);
  });
  return out;
}
