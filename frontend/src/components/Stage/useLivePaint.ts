// PlotViewport's display-only repaint: a legend hide or a colour / width /
// dash edit patches the LIVE uPlot instance through the same series builder a
// rebuild runs (lib/uplotLivePaint.ts), instead of tearing it down (~125 ms at
// the 1M-point benchmark scale, docs/performance_envelope.md). The patch code
// loads lazily; the mount-time run fetches it before the first edit.

import { type RefObject, useEffect } from "react";
import type uPlot from "uplot";

import type { PlotPayload } from "../../lib/plotdata";
import type { Lim } from "../../lib/plotLimApply";
import type { LivePaintArgs, LivePaintRef } from "../../lib/uplotLivePaint";
import { seriesColorsFor } from "../../lib/uplotOpts";
import { buildSeriesDefs } from "../../lib/uplotSeries";

/** Re-runs only when `hidden` / `seriesStyles` / `baseLineWidth` change;
 *  every other input is a create-effect dep, so it rebuilds instead. Call it
 *  AFTER the create effect. The patch is skipped when the instance was
 *  replaced meanwhile (a rebuild already painted the latest inputs). It calls
 *  `rebuild` on a structural mismatch, and when the patch code fails to load. */
export function useLivePaint(
  plotRef: RefObject<uPlot | null>,
  paintRef: LivePaintRef,
  displayPayload: PlotPayload | null,
  args: LivePaintArgs,
  xAscending: boolean,
  limsRef: RefObject<{ y: Lim; y2: Lim }>,
  rebuild: () => void,
): void {
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot || !displayPayload) return;
    let current = true;
    import("../../lib/uplotLivePaint").then(
      ({ livePatch }) => {
        if (!current || plotRef.current !== plot) return;
        // `bg` is a create-effect dep, so every paint of this instance reads the same colours.
        const defsOf = (a: LivePaintArgs) => buildSeriesDefs(displayPayload, a, [], xAscending, seriesColorsFor(a.bg));
        if (!livePatch(plot, paintRef, args, defsOf, limsRef.current)) rebuild();
      },
      () => current && rebuild(),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the display-only inputs re-run this; every other input rebuilds PlotViewport's instance.
  }, [args.hidden, args.seriesStyles, args.baseLineWidth]);
}
