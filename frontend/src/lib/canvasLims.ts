// The canvas' resolution of committed X/Y limits — possibly HALF-OPEN, one
// side `null` = auto for that side (P2.8 residual (b), `lib/axisLim.ts`) —
// into the concrete [min, max] pairs uPlot is handed. Pure; the mounted
// viewport's hook is `components/Stage/useResolvedLims.ts`, and the screen
// legs of the regression fixtures call this directly so they cannot drift.
//
// The blank side comes from the canvas' OWN autoscale extent: the same
// scanned, padded extents `buildOpts` falls back to for a non-monotonic x
// (`fullXExtents` / `fullYExtents`, which cover drawn error bars too, as the
// autoscale does). A fully fixed pair passes through as the same reference.
// When the typed side would land on or past the auto side, the axis goes back
// to full auto (`range: null`) and `crossed` says so.

import { fixedLim, resolveHalfLim, type HalfLim, type ResolvedLim } from "./axisLim";
import type { ErrorSpan } from "./errorbars";
import type { PlotPayload } from "./plotdata";
import type { AxisScale } from "./types";
import { errorReach, fullYExtents, withXBarRows } from "./uplotErrorRange";
import { fullXExtents } from "./uplotXRange";

export interface LimResolveInputs {
  xLim?: HalfLim | null;
  yLim?: HalfLim | null;
  xScale: AxisScale;
  yScale: AxisScale;
  hidden?: boolean[];
  errorBars?: Map<number, (number | null)[]>;
  errorSpans?: Map<number, ErrorSpan[]>;
}

const positiveOnly = (s: AxisScale): boolean => s === "log" || s === "reciprocal";

/** The concrete X/Y pairs for `payload`, plus whether each one crossed. The
 *  data is scanned only for a half-open side — the common fixed/auto limit
 *  costs nothing here. */
export function resolveCanvasLims(
  payload: PlotPayload | null,
  { xLim, yLim, xScale, yScale, hidden, errorBars, errorSpans }: LimResolveInputs,
): { x: ResolvedLim; y: ResolvedLim } {
  const openX = !!payload && !!xLim && !fixedLim(xLim);
  const openY = !!payload && !!yLim && !fixedLim(yLim);
  const reach = openX || openY ? errorReach(payload!, errorBars, errorSpans) : null;
  return {
    x: resolveHalfLim(xLim, openX ? fullXExtents(withXBarRows(payload!, reach, hidden), hidden, positiveOnly(xScale)) : null),
    y: resolveHalfLim(yLim, openY ? fullYExtents(payload!, hidden, 0, positiveOnly(yScale), reach) : null),
  };
}
