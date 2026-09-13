// Item 11 (snapshot-as-window): publish the CURRENT composed display bundle
// through the module-scope seam (lib/plotsnapshot) so the "Snapshot to New
// Window" command can freeze exactly what's on screen — an imperative ref
// write, not store state, zero re-renders/store churn. Extracted out of
// PlotStage to keep that component under its line ceiling (MAIN #27's
// shape-editing hooks needed the offset — same reasoning as
// useShapeEdit/useShapeDraw's own extraction).

import { useEffect, useMemo } from "react";
import type { ColorScatterSpec } from "../../lib/colorscatter";
import type { FacetPanel } from "../../lib/facet";
import type { SpatialPanel } from "../../lib/multipanel";
import type { PlotPayload } from "../../lib/plotdata";
import { publishLivePlotSnapshot } from "../../lib/plotsnapshot";
import { resolveSeriesStyle, type SeriesCycle } from "../../lib/seriesStyleCycle";
import type { Dataset, SeriesStyle } from "../../lib/types";

export interface LiveSnapshotArgs {
  active: Dataset | null;
  polarMode: boolean;
  statMode: boolean;
  stackMode: boolean;
  plottedCount: number;
  spatialPanels: SpatialPanel[] | null;
  facetPanels: FacetPanel[] | null;
  displayPayload: PlotPayload | null;
  // Matches usePlotPayload's own return type exactly (each `| undefined`
  // while the payload is still being composed) — PlotStage passes these
  // straight through from that hook.
  styleList: (SeriesStyle | undefined)[] | undefined;
  labelList: (string | undefined)[] | undefined;
  errorBars: Map<number, (number | null)[]>;
  plotted: number[];
  colorByColumns: Map<number, ColorScatterSpec>;
  hidden: boolean[] | undefined;
  /** P3.3: the cycle positions the Stage canvas was built with, or null. See
   *  `resolvedStyles` below — this hook RESOLVES the styles before publishing
   *  rather than passing the cycle on, because a snapshot must stay frozen. */
  seriesCycle: SeriesCycle;
}

/** Whether an alternate render mode (polar/stats/multi-panel stack) is
 *  ACTUALLY showing right now — the XY bundle `usePlotPayload` computed
 *  isn't what's on screen then, so the snapshot publish below must no-op
 *  instead of freezing the wrong thing. Also gates PlotStage's own early
 *  returns to the alternate-mode components. */
function altModeShowing(
  a: Pick<LiveSnapshotArgs, "active" | "polarMode" | "statMode" | "stackMode" | "plottedCount" | "spatialPanels" | "facetPanels">,
): boolean {
  return (
    (!!a.active && (a.polarMode || a.statMode)) ||
    (a.stackMode && (a.plottedCount >= 2 || (a.spatialPanels?.length ?? 0) >= 2 || (a.facetPanels?.length ?? 0) >= 1))
  );
}

/** Runs the publish effect (cleared on unmount — the Plot tab switching
 *  away). PlotStage's own early-return gates to the alternate-mode
 *  components recompute this same condition inline from `nPlotted`/
 *  `spatialPanels`/`facetPanels` directly — this hook doesn't need to hand
 *  it back out. */
export function useLiveSnapshotPublish(args: LiveSnapshotArgs): void {
  const alt = altModeShowing(args);
  const { displayPayload, styleList, labelList, errorBars, plotted, colorByColumns, hidden, seriesCycle } = args;
  // P3.3: the bundle carries the RESOLVED styles — the cycle applied, not the
  // cycle itself. A snapshot window has no export and no live view; its whole
  // contract (this module's header, and `plotsnapshot.ts`'s) is "freezes exactly
  // what's on screen". Passing the raw styles and a cycle would have made the
  // frozen plot re-derive its dashes from whatever the preference happens to be
  // later, so a snapshot of a dashed plot rendered solid once the preference was
  // turned off — a frozen figure silently changing after the fact. Resolving
  // here freezes the dashes with the data. With no cycle `resolveSeriesStyle` is
  // the identity function and returns each caller's own entry, so this is
  // byte-identical to before the feature whenever the preference is off.
  const resolvedStyles = useMemo(
    () => (seriesCycle && styleList ? styleList.map((st, i) => resolveSeriesStyle(st, i, seriesCycle)) : styleList),
    [styleList, seriesCycle],
  );
  useEffect(() => {
    publishLivePlotSnapshot(
      displayPayload && !alt
        ? { payload: displayPayload, styleList: resolvedStyles, labelList, errorBars, plotted, colorByColumns, hidden }
        : null,
    );
    return () => publishLivePlotSnapshot(null);
  }, [displayPayload, resolvedStyles, labelList, errorBars, plotted, colorByColumns, hidden, alt]);
}
