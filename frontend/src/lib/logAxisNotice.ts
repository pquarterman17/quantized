// A log axis cannot draw a value <= 0: uPlot drops those points silently. This
// counts them so the Stage can say so ("N non-positive points hidden on the log
// axis"). Lazy: only loaded once an axis is log (`Stage/useLogAxisNotice`).

import type { PlotPayload } from "./plotdata";

export interface LogAxisView {
  xScale: string;
  yScale: string;
  y2Scale: string | null | undefined;
  y2Keys: readonly number[] | null | undefined;
}

const bad = (v: number | null | undefined): boolean => v != null && Number.isFinite(v) && v <= 0;

/** Points hidden by log axes, as a status note (null when nothing is hidden).
 *  A point counts once even when both its X and Y are off a log axis. */
export function logHiddenNote(payload: PlotPayload | null, plotted: readonly number[], view: LogAxisView): string | null {
  if (!payload || payload.data.length < 2) return null;
  const xs = payload.data[0] as (number | null)[];
  const logX = view.xScale === "log";
  let n = 0;
  for (let k = 1; k < payload.data.length; k++) {
    const ys = payload.data[k] as (number | null)[];
    const onY2 = view.y2Keys?.includes(plotted[k - 1]) ?? false;
    const logY = (onY2 ? (view.y2Scale ?? view.yScale) : view.yScale) === "log";
    if (!logX && !logY) continue;
    for (let i = 0; i < ys.length; i++) {
      if (ys[i] == null) continue; // a gap is not a hidden point
      if ((logX && bad(xs[i])) || (logY && bad(ys[i]))) n++;
    }
  }
  return n > 0 ? `${n} non-positive point${n === 1 ? "" : "s"} hidden on the log axis` : null;
}
