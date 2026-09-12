// The focused Stage's opt-in to the P3.3 auto dash/marker cycle
// (`lib/seriesStyleCycle.ts`) — one store-reading hook rather than four reads
// and a `useMemo` inline in `PlotStage.tsx`, which sits on the 400-line
// component ceiling.
//
// It exists as a NAMED opt-in on purpose. `buildOpts` cycles only for a caller
// that hands it display positions, so every other canvas — the waterfall, the
// reflectometry panel, faceted/stacked/x-break panels, background, snapshot and
// panel windows — is uncycled by simply not calling this, and a NEW render path
// is uncycled until someone deliberately wires its export and opts in.

import { useMemo } from "react";

import { displayPositions, overlayExportsSeriesStyles, type SeriesCycle } from "../../lib/seriesStyleCycle";
import { useApp } from "../../store/useApp";

/**
 * The cycle positions for the focused Stage's plain single-panel overlay, or
 * `null` when it must not cycle.
 *
 * `lib/figureSpec.buildStageFigureSpec` — the export this canvas produces (Copy
 * figure, Copy figure (vector), Export figure…) — applies the SAME preference
 * behind the SAME `overlayExportsSeriesStyles` view test, so a grouped, faceted
 * or stacked view cycles on neither side rather than dashing a curve the PDF
 * renders solid.
 *
 * `count` is `plotted.length`, NOT `payload.series.length`: the fit / baseline /
 * peak / derivative overlays are spliced on past the plotted channels and no
 * export draws them at all, so positions stop short and leave them undashed.
 *
 * Memoised because `PlotViewport` keys its uPlot-rebuild effect on this
 * reference — a fresh array every render would tear the plot down every render.
 */
export function useStageSeriesCycle(groupKey: number | null, count: number): SeriesCycle {
  const facetKey = useApp((s) => s.facetKey);
  const stackMode = useApp((s) => s.stackMode);
  const autoSeriesStyles = useApp((s) => s.autoSeriesStyles);
  const on = autoSeriesStyles && overlayExportsSeriesStyles({ groupKey, facetKey, stackMode });
  return useMemo(() => displayPositions(on, count), [on, count]);
}
