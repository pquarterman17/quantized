// The lazy seam for the waterfall X offset (Origin's waterfall X step,
// `PlotView.waterfallDx`). `lib/waterfallX.ts` lays the composed display
// payload — and its row-aligned companions — out as one x block per series;
// it is loaded with a dynamic import the first time a non-zero step is shown,
// so a plot that never uses it pays nothing for it on first paint. Until the
// chunk lands (one fetch, once per session) the canvas draws unshifted.
// A failed load leaves the plot unshifted rather than breaking it.

import { useEffect, useMemo, useState } from "react";

import type { PlotPayload } from "../../lib/plotdata";
import { waterfallXApplies, waterfallXSpanOf } from "../../lib/waterfallOffset";
import type { WaterfallXCompanions } from "../../lib/waterfallX";

type Lib = typeof import("../../lib/waterfallX");
let loaded: Lib | undefined;

/** `fetched`: the payload before compose — its series count is the slot
 *  count, its `waterfallXSpanOf` the step's basis (the full range even after a
 *  zoom re-fetch); `fraction`: the step (0 when the caller refuses it — a group
 *  split or an encoding). Returns the payload + companions to draw, keyed as
 *  `usePlotPayload` returns them. */
export function useWaterfallX(
  display: PlotPayload | null,
  fetched: PlotPayload | null,
  fraction: number,
  { errorBars, errorSpans, colorByColumns }: WaterfallXCompanions,
): WaterfallXCompanions & { displayPayload: PlotPayload | null } {
  const base = fetched?.series.length ?? 0;
  const on = !!display && base > 1 && waterfallXApplies(fraction);
  const [lib, setLib] = useState(loaded);
  useEffect(() => {
    if (on) import("../../lib/waterfallX").then((m) => setLib((loaded = m)), () => {});
  }, [on]);
  return useMemo(() => {
    const c = { errorBars, errorSpans, colorByColumns };
    return on && lib ? lib.expandWaterfallX(display!, base, fraction, c, waterfallXSpanOf(fetched!)) : { displayPayload: display, ...c };
  }, [on, lib, display, fetched, base, fraction, errorBars, errorSpans, colorByColumns]);
}
