// How the Curve Fit panel's fit curve is drawn over its data, ONE rule for the
// canvas (lib/uplotSeries.ts) and the vector export (lib/figureSpecOverlays.ts),
// so screen and export agree. A solid fit line the same width as the data line
// sits exactly on top of it and hides it; instead:
//   * the fit is a thinner DASHED line, always a line (never the Scatter
//     default trace's dots), unless the user styled that series themselves;
//   * while that fit is shown, data without a style of its own is drawn with
//     markers as well (the default "Line" trace becomes "Line + markers"), so
//     the points stay visible between the dashes -- up to FIT_MARKER_MAX_POINTS
//     rows, past which markers would only smear into a thick line. Scatter /
//     Step defaults and explicitly styled series are left alone.
// ONLY the Curve Fit panel's own overlay opts in (`FitOverlay.curveFit`, carried
// to the plot series as `fit`): Quick Fit, the peak envelope, reflectivity and
// an analysis result's plot share the `fitOverlay` slot and keep the plain look.

import type { DefaultTrace } from "./types";

/** The canvas dash pattern (px on, px off) of a fit curve. */
export const FIT_DASH: number[] = [6, 4];

/** Above this many plotted rows the data does not gain markers. */
export const FIT_MARKER_MAX_POINTS = 2000;

/** A fit curve's line width given the width a plain data line would get. */
export const fitLineWidth = (base: number): number => Math.max(1, base * 0.8);

/** True for the Curve Fit's curve `withFitOverlay` appends (not a band edge). */
export const isFitSeries = (s: { fit?: boolean; band?: number }): boolean => !!s.fit && !s.band;

/** The default trace data series use while a Curve Fit curve over `rows` rows is shown. */
export const traceWithFit = (trace: DefaultTrace | undefined, fitShown: boolean, rows = 0): DefaultTrace | undefined =>
  fitShown && rows <= FIT_MARKER_MAX_POINTS && (trace === undefined || trace === "Line") ? "Line + markers" : trace;
