// Where a saved fit may be DRAWN on a resolved plot: the fit-draw half of I4
// (lib/overlayPlacement.ts). Pure, so the reopen gate
// (store/analysisResultPlotOpen) and the result card's buttons
// (analysisresults/AnalysisResultFigures) ask the SAME question.

import { curveX } from "./perSeriesX";
import type { Dataset, FitSpec, OverlayBinding } from "./types";

/** Why `fitDrawBinding` refused `spec`, as a status suffix / card note (I4):
 *  the gate and the result card say the same thing. */
export function fitDrawRefusal(spec: Pick<FitSpec, "xKey">): string {
  return spec.xKey === undefined
    ? "the saved fit never recorded its X; use Edit / Re-fit first"
    : "the saved fit does not match the plot's X/Y channels; use Edit / Re-fit first";
}

/** Where the fit is drawn on the resolved plot (`channels[0]` against
 *  `xChannel`) -- the X and Y it was computed on -- or null when that plot is
 *  not them (refused: re-fit). */
export function fitDrawBinding(
  ds: Pick<Dataset, "data" | "columnDesignations" | "channelRoles">,
  plot: { channels: readonly number[]; xChannel?: number | null },
  spec: Pick<FitSpec, "xKey" | "yKey">,
): OverlayBinding | null {
  const x = spec.xKey;
  if (x === undefined || x !== plot.xChannel) return null; // no recorded X, or the plot is on another X
  const y = plot.channels[0];
  if (y === undefined || (spec.yKey !== undefined && spec.yKey !== y)) return null;
  // The Y must be a curve whose OWN X is that X (placement draws it nowhere
  // else): never an X-designated, role or plot-X column, never R2 against T1.
  if (curveX(ds, x)[y] !== x || ds.channelRoles?.[y]) return null;
  return { yKey: y, xKey: x };
}
