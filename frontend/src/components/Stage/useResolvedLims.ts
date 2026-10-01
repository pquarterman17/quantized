// PlotViewport's half-open limit resolution (P2.8 residual (b)): the committed
// X/Y limits, either side possibly `null` = auto for that side, become the
// concrete [min, max] pairs everything downstream (`classifyLimChange`,
// `buildOpts`' fixed ranges, decimation's window) already expects. The rule
// itself is the pure `lib/canvasLims.resolveCanvasLims`; this hook adds the
// mounted-viewport concerns. Split out of PlotViewport.tsx (400-line ceiling).

import { useEffect, useMemo } from "react";

import { resolveCanvasLims, type LimResolveInputs } from "../../lib/canvasLims";
import type { PlotPayload } from "../../lib/plotdata";
import type { Lim } from "../../lib/plotLimApply";

/** The resolved pairs, recomputed only when an input changes (a fully fixed
 *  or auto limit keeps its own reference, so only a half-open one can hand
 *  the lim-tracking effect a fresh — and then "noop" — pair), plus
 *  `onCrossed(axis)` once per commit whose typed side crossed the auto side,
 *  so the caller can put one sentence on the status line. */
export function useResolvedLims(
  payload: PlotPayload | null,
  inp: LimResolveInputs,
  onCrossed?: (axis: "x" | "y") => void,
): { x: Lim; y: Lim } {
  const r = useMemo(
    () => resolveCanvasLims(payload, inp),
    // `inp` is a fresh object every render (PlotViewport's rest props); its fields are the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payload, inp.xLim, inp.yLim, inp.xScale, inp.yScale, inp.hidden, inp.errorBars, inp.errorSpans],
  );
  // Keyed by the committed values, so a re-render never repeats the note but
  // a new crossing commit does. `onCrossed` is a notifier, not an input.
  const key = (r.x.crossed || r.y.crossed) && JSON.stringify([inp.xLim, inp.yLim]);
  useEffect(() => {
    if (r.x.crossed) onCrossed?.("x");
    if (r.y.crossed) onCrossed?.("y");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { x: r.x.range, y: r.y.range };
}
