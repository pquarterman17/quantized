// Analysis overlays never drive the Y autoscale (UX audit 7 #8, lane UX-I).
//
// A fit curve, an estimated or fitted baseline, peak markers and a fit band's
// edges (`PlotSeriesSpec.overlay` / `.band`, appended by
// `lib/plotdata.composeDisplayPayload`) are drawn against the data; they are
// not the data. Before this rule they entered uPlot's autoscale like any
// series, so a fitted linear background that dives through zero dragged a
// log-Y view down to 10^-3 and squashed the pattern into the top decade. Now
// an overlay is left out of its scale's auto range whenever a VISIBLE data
// series shares that axis: the range is the data's, and the overlay is
// clipped to it (on a log axis its values <= 0 already draw as gaps,
// `lib/logGaps.ts`). An overlay alone on its axis (the ROI gadget's dy/dx on
// the secondary Y) still ranges that axis, or it would have no range at all.
//
// Two consumers: `uplotSeries.buildSeriesDefs` (uPlot's own scan, via
// `series.auto = false`) and `uplotErrorRange.fullYExtents` (the full-scan
// path for a non-monotonic X, which also feeds `lib/canvasLims.ts`).

import type { PlotSeriesSpec } from "./plotdata";

type AxisSeries = Pick<PlotSeriesSpec, "overlay" | "band" | "axis">;

const isOverlay = (s: AxisSeries): boolean => !!(s.overlay || s.band);

/** Per display series: true when it is kept OUT of its Y scale's autoscale. */
export function offAutoscale(series: readonly AxisSeries[], hidden?: readonly boolean[]): boolean[] {
  const dataAxes = new Set<number>();
  series.forEach((s, i) => {
    if (!isOverlay(s) && !hidden?.[i]) dataAxes.add(s.axis ?? 0);
  });
  return series.map((s) => isOverlay(s) && dataAxes.has(s.axis ?? 0));
}
