// A plot window's opt-in to the P3.3 auto dash/marker cycle
// (`lib/seriesStyleCycle.ts`) — a named hook rather than a store read and a
// `useMemo` written inline in `PlotStage.tsx`, which sits on the 400-line
// component ceiling, and again in `BackgroundPlotWindow.tsx`.
//
// Neither hook decides anything itself: both call
// `seriesStyleCycle.windowCyclesSeriesStyles`, the one function the Stage export
// and the Publication Preview gate also call, and turn its boolean into memoised
// display positions. What differs between them is only WHICH view they hand it.
//
// It exists as a NAMED opt-in on purpose. `buildOpts` cycles only for a caller
// that hands it display positions, so every other canvas — the waterfall, the
// reflectometry panel, faceted/stacked/x-break panels, the snapshot and
// composite-panel windows — is uncycled by simply not calling this, and a NEW
// render path is uncycled until someone deliberately wires its export and opts
// in.
//
// FOCUS IS NOT A STYLING INPUT. Both the focused Stage and an unfocused
// background window of the same plot go through the same decision here, from
// the same view fields, so a window does not change appearance when focus
// moves — the "silently changing preview" class `BackgroundPlotWindow.tsx`'s own
// header names. Before this, series 2 and 3 were dashed in the focused window
// and solid in the one tiled next to it for comparison, and clicking either
// window swapped which was which.

import { useMemo } from "react";

import type { FigureDocument } from "../../lib/figureDocument";
import {
  displayPositions,
  windowCyclesSeriesStyles,
  type CycleView,
  type SeriesCycle,
} from "../../lib/seriesStyleCycle";
import { useApp, type AppState } from "../../store/useApp";

/** Does the FOCUSED window cycle right now? ONE boolean-returning selector, so
 *  it re-renders nothing unless the answer changes, over the live view
 *  singletons `PlotStage` actually draws from (a window record's own `view` copy
 *  can lag them) plus that window's document.
 *
 *  `AppState` satisfies `CycleView` structurally (`groupKey`, `facetKey`,
 *  `stackMode`, `polarMode`, `statMode`, `xKey`, `yKeys` are all live
 *  singletons), so nothing is assembled to ask. */
function selectFocusedWindowCycles(s: AppState): boolean {
  const win = s.plotWindows.find((w) => w.id === s.focusedWindowId);
  return windowCyclesSeriesStyles(
    s.autoSeriesStyles,
    s,
    win?.kind === "plot" ? win.document : undefined,
  );
}

/**
 * The cycle positions for one plot window's plain single-panel overlay, or
 * `null` when it must not cycle.
 *
 * `lib/figureSpec.buildStageFigureSpec` — the export the FOCUSED window
 * produces (Copy figure, Copy figure (vector), Export figure…), and the one a
 * background window produces the moment it is focused — makes the SAME
 * `windowCyclesSeriesStyles` call, so a grouped, faceted, stacked, polar or stat
 * view, a document that sets `publication.seriesStyles`, or an X channel that is
 * also in `yKeys` all cycle on neither side rather than dashing a curve the PDF
 * renders solid.
 *
 * `count` is `plotted.length`, NOT `payload.series.length`: the fit / baseline /
 * peak / derivative overlays are spliced on past the plotted channels and no
 * export draws them at all, so positions stop short and leave them undashed.
 *
 * Memoised because `PlotViewport` keys its uPlot-rebuild effect on this
 * reference — a fresh array every render would tear the plot down every render.
 */
export function useWindowSeriesCycle(
  view: CycleView,
  doc: FigureDocument | undefined,
  count: number,
): SeriesCycle {
  const autoSeriesStyles = useApp((s) => s.autoSeriesStyles);
  const on = windowCyclesSeriesStyles(autoSeriesStyles, view, doc);
  return useMemo(() => displayPositions(on, count), [on, count]);
}

/** The FOCUSED Stage's opt-in: `seriesStyleCycle.windowCyclesSeriesStyles` over
 *  the live view, which is the same call `useWindowSeriesCycle` makes for a
 *  background window, read as ONE boolean subscription rather than seven. */
export function useStageSeriesCycle(count: number): SeriesCycle {
  const on = useApp(selectFocusedWindowCycles);
  return useMemo(() => displayPositions(on, count), [on, count]);
}
