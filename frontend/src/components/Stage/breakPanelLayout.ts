// How an x-break row shares its width out (batch 34), split from
// `breakPanelRender.ts` so the rules are pure and tested on their own.
//
// The problem, measured at an 800x600 window: the stage is ~294 px wide, and
// every panel used to draw its OWN y axis — a >=60 px tick gutter, a ~34 px
// title band and a ~29 px right pad, ~128 px in all — so two or three panels
// left 0-1 px of plot. Two rules fix it:
//
//  1. Right-of-seam panels share panel 0's y axis, as the export already does
//     (`calc/figure_break.py`: `sharey`, `tick_params(left=False)`, one
//     `set_ylabel` on `axes[0]`). They draw no y title, tick labels or tick
//     marks — only the grid, which reads straight across from panel 0 because
//     the y scale is shared. A seam side keeps a small pad, and an x tick
//     label that would cross that edge is blanked (`seamXValues`) instead of
//     being clipped in half by the canvas.
//  2. Plot areas stay span-proportional (the export's `width_ratios`) while
//     every one clears `MIN_BREAK_PLOT_W`; if any would fall below it, all
//     panels get EQUAL widths (`breakPlotWidths`). Equal rather than clamped:
//     a clamped row keeps no ratio at all, while equal widths are the
//     predictable "too narrow to scale" answer and give the narrowest panel
//     the most room the row has.

import type uPlot from "uplot";

import type { BreakPanel } from "../../lib/facet";

/** Smallest plot-area width (CSS px) span-proportional sizing may give a
 *  break panel before the row falls back to equal widths. */
export const MIN_BREAK_PLOT_W = 48;

/** The pad (CSS px) between a plot area and a seam glyph. */
export const SEAM_PAD = 4;

/** uPlot's own auto top pad, `round(50 / 3)`. */
const TOP_PAD = 17;

type XValues = (u: uPlot, splits: number[], axisIdx: number, space: number, incr: number) => (string | number | null)[];

/** Each panel's plot-area width out of `free` px: proportional to its x span
 *  while every width is at least `min`, else equal. */
export function breakPlotWidths(free: number, spans: readonly number[], min = MIN_BREAK_PLOT_W): number[] {
  const total = spans.reduce((a, b) => a + b, 0);
  const prop = spans.map((s) => (free * s) / total);
  return prop.every((w) => w >= min) ? prop : spans.map(() => free / spans.length);
}

/** Everything `uplotOpts`' y title (`soloLabel`) is derived from for a break
 *  panel: its series' label, unit and axis, and each one's channel rename.
 *  Two panels with the same key draw the same y title, so a right-of-seam
 *  panel whose key matches panel 0's would only REPEAT it and drops it; one
 *  holding other channels (BUG-014 round 5) keeps its own. */
export function yTitleKey(p: BreakPanel, seriesLabels: Record<number, string>): string {
  return JSON.stringify(p.payload.series.map((s, k) => [s.label, s.unit, s.axis ?? 0, seriesLabels[p.channels[k]] ?? null]));
}

/** Wrap an x tick formatter so a label that would cross a seam side of the
 *  plot area (beyond its `pad`) is not drawn (null). Width is estimated as 0.6 em
 *  per character, the monospace rule `lib/uplotRightPad.ts` uses. */
export function seamXValues(base: XValues, seams: { left: boolean; right: boolean }, fontPx: number, pad: number): XValues {
  return (u, splits, axisIdx, space, incr) => {
    const out = base(u, splits, axisIdx, space, incr);
    const { min, max } = u.scales.x;
    if (min == null || max == null) return out;
    const [a, b] = [u.valToPos(min, "x"), u.valToPos(max, "x")];
    const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
    return out.map((s, k) => {
      if (s == null || s === "") return s;
      const half = (String(s).length * fontPx * 0.6) / 2;
      const at = u.valToPos(splits[k], "x");
      if ((seams.left && at - half < lo - pad) || (seams.right && at + half > hi + pad)) return null;
      return s;
    });
  };
}

/** Turn a built panel's options into a seam-side panel's: no y tick labels
 *  or tick marks left of a seam, a small pad on each seam side, and x tick
 *  labels kept clear of those sides. Mutates and returns `opts`. (Titles are
 *  settled at build time — `yAxisLabel`/`xAxisLabel: null` — so a rich
 *  title's plugin draw goes with them.) */
export function applySeamSides(opts: uPlot.Options, seams: { left: boolean; right: boolean }): uPlot.Options {
  if (!seams.left && !seams.right) return opts;
  const axes = opts.axes ?? [];
  const pad = [...(opts.padding ?? [null, null, null, null])] as uPlot.Padding;
  if (seams.left && axes[1]) {
    axes[1] = {
      ...axes[1],
      size: 0,
      ticks: { ...axes[1].ticks, show: false },
      values: (_u: uPlot, splits: number[]) => splits.map(() => null),
    };
    pad[3] = SEAM_PAD;
  }
  // uPlot's auto top pad (a third of ITS default x axis size) applies only
  // beside a y axis; pin it on every panel so the plot areas line up and the
  // shared y grid reads straight across.
  pad[0] ??= TOP_PAD;
  // A y2 axis owns the right side; leave its pad to uPlot.
  if (seams.right && axes.length < 3) pad[1] = SEAM_PAD;
  const x = axes[0];
  if (x && typeof x.values === "function") {
    const fontPx = Number(/(\d+(?:\.\d+)?)px/.exec(String(x.font ?? ""))?.[1] ?? 12);
    axes[0] = { ...x, values: seamXValues(x.values as XValues, seams, fontPx, SEAM_PAD) };
  }
  opts.padding = pad;
  return opts;
}
