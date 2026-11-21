// Axis padding for bubble (size-by) series: an autoscaled axis runs exactly to
// the data, so an edge bubble is cut in half by the plot frame; Origin pads
// the axis to fit the largest bubble (measured: X [0, 10] -> [-0.68, 10.46]).
// Lazy: reached only through `marksImpl.padBubbleScales` (the size-by chunk).
//
// A bubble's diameter is in CSS px, so the data-space margin depends on the
// plot's pixel size: the margin `m` (data units) must satisfy
// `m = radiusPx * (span + 2m) / sizePx`, solved by fixed-point iteration.
// Only an AUTOSCALED, non-log axis is padded: a fixed limit stays what the
// user typed, and a zoom (a range that does not cover every bubble centre)
// keeps its bounds.

import type uPlot from "uplot";

import type { ColorScatterSpec } from "./colorscatter";
import { uplotDefault } from "./uplotErrorRange";

/** The largest bubble radius (CSS px) among `specs`. */
export function maxBubbleRadius(specs: Iterable<ColorScatterSpec>): number {
  let d = 0;
  for (const s of specs) for (const v of s.diam ?? []) if (v != null && v > d) d = v;
  return d / 2;
}

/** `[lo, hi]` widened until every bubble centre in [dmin, dmax] has `radiusPx`
 *  of room, on a plot `sizePx` long. Unchanged when it cannot fit. */
export function padForRadius(lo: number, hi: number, dmin: number, dmax: number, radiusPx: number, sizePx: number): [number, number] {
  if (!(sizePx > 4 * radiusPx) || !(radiusPx > 0)) return [lo, hi];
  for (let i = 0; i < 8; i++) {
    const m = (radiusPx * (hi - lo)) / sizePx;
    lo = Math.min(lo, dmin - m);
    hi = Math.max(hi, dmax + m);
  }
  return [lo, hi];
}

/** Wrap `scales.x` / `scales.y` so their autoscale leaves room for the biggest
 *  bubble. `padX` / `padY` are false for a fixed limit. Mutates `scales`. */
export function padBubbleScales(
  scales: uPlot.Scales,
  columns: Map<number, ColorScatterSpec> | undefined,
  padX: boolean,
  padY: boolean,
): void {
  const sized = new Map([...(columns ?? [])].filter(([, s]) => s.diam));
  const radius = maxBubbleRadius(sized.values());
  if (!sized.size || radius <= 0) return;
  for (const key of ["x", "y"] as const) {
    const sc = scales[key];
    if (!sc || (key === "x" ? !padX : !padY) || sc.distr === 3) continue;
    const inner = sc.range;
    sc.range = (u, min, max, k) => {
      const base: uPlot.Range.MinMax =
        typeof inner === "function" ? inner(u, min, max, k) : Array.isArray(inner) ? (inner as uPlot.Range.MinMax) : uplotDefault(u, min as number, max as number, k, key === "x");
      const [lo, hi] = base;
      if (lo == null || hi == null) return base;
      // The data extent of the visible sized series on this scale.
      let dmin = Infinity;
      let dmax = -Infinity;
      for (const col of sized.keys()) {
        const s = u.series[col];
        if (!s || s.show === false || (key === "y" && (s.scale ?? "y") !== "y")) continue;
        const ys = u.data[col];
        const vs = key === "x" ? u.data[0] : ys;
        vs?.forEach((v, r) => {
          if (v == null || !Number.isFinite(v) || ys?.[r] == null) return;
          if (v < dmin) dmin = v;
          if (v > dmax) dmax = v;
        });
      }
      if (dmin > dmax || lo > dmin || hi < dmax) return base; // none drawn, or a zoomed view
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const bb = u.bbox as { width?: number; height?: number } | undefined;
      const px = key === "x" ? (bb?.width ? bb.width / dpr : u.width - 80) : bb?.height ? bb.height / dpr : u.height - 70;
      return padForRadius(lo, hi, dmin, dmax, radius, px);
    };
  }
}
