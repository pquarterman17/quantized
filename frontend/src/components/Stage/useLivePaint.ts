// PlotViewport's display-only repaint: a legend hide or a colour / width /
// dash edit patches the LIVE uPlot instance through the same series builder a
// rebuild runs (lib/uplotLivePaint.ts), instead of tearing it down (~125 ms at
// the 1M-point benchmark scale, docs/performance_envelope.md).

import { type RefObject, useEffect } from "react";
import type uPlot from "uplot";

import type { PlotPayload } from "../../lib/plotdata";
import type { Lim } from "../../lib/plotLimApply";
import { applyLivePaint, livePaintOf, type LivePaintRef } from "../../lib/uplotLivePaint";
import { seriesColorsFor, type BuildOptsArgs } from "../../lib/uplotOpts";
import { buildSeriesDefs, type SeriesDefArgs } from "../../lib/uplotSeries";

/** Re-runs only when `hidden` / `seriesStyles` change; every other input is a
 *  create-effect dep, so it rebuilds instead. Call it AFTER the create effect:
 *  a same-commit rebuild has then already bound the fresh paint, and this
 *  finds nothing to change. A structural mismatch calls `rebuild`. */
export function useLivePaint(
  plotRef: RefObject<uPlot | null>,
  paintRef: LivePaintRef,
  displayPayload: PlotPayload | null,
  args: SeriesDefArgs & Pick<BuildOptsArgs, "bg">,
  xAscending: boolean,
  limsRef: RefObject<{ y: Lim; y2: Lim }>,
  rebuild: () => void,
): void {
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot || !displayPayload) return;
    const { series, bands } = buildSeriesDefs(displayPayload, args, [], xAscending, seriesColorsFor(args.bg));
    if (!applyLivePaint(plot, paintRef, livePaintOf(series, bands), limsRef.current)) rebuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the display-only inputs re-run this; every other input rebuilds PlotViewport's instance.
  }, [args.hidden, args.seriesStyles]);
}
