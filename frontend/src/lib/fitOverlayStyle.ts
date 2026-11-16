// How a fit curve is drawn over its data, ONE rule for the canvas
// (lib/uplotSeries.ts) and the vector export (lib/figureSpecOverlays.ts), so
// screen and export agree. A solid fit line the same width as the data line
// sits exactly on top of it and hides it; instead:
//   * the fit is a thinner DASHED line, always a line (never the Scatter
//     default trace's dots), unless the user styled that series themselves;
//   * while a fit is shown, data without a style of its own is drawn with
//     markers as well (the default "Line" trace becomes "Line + markers"), so
//     the points stay visible between the dashes. Scatter / Step defaults and
//     explicitly styled series are left alone.

import { FIT_SERIES_LABEL } from "./overlaySpecShape";
import type { DefaultTrace } from "./types";

/** The canvas dash pattern (px on, px off) of a fit curve. */
export const FIT_DASH: number[] = [6, 4];
/** The thinness of a fit curve against the data line (never below 1 px). */
const FIT_WIDTH_FACTOR = 0.8;

/** A fit curve's line width given the width a plain data line would get. */
export const fitLineWidth = (base: number): number => Math.max(1, Math.round(base * FIT_WIDTH_FACTOR * 100) / 100);

/** True for the series `withFitOverlay` appends (not a band edge). */
export const isFitSeries = (s: { label?: string; overlay?: boolean; band?: number }): boolean =>
  s.overlay === true && s.label === FIT_SERIES_LABEL && !s.band;

/** The default trace data series use while a fit is shown. */
export const traceWithFit = (trace: DefaultTrace | undefined, fitShown: boolean): DefaultTrace | undefined =>
  fitShown && (trace === undefined || trace === "Line") ? "Line + markers" : trace;
