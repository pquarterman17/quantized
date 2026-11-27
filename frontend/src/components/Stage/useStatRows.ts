// The rows a statistics stage reads: the dataset's analysis view (exclusions and the Data Filter pruned, guard #11),
// narrowed first to the plot's row window (`PlotView.rowRange`) when it has one. `rowIds` are SOURCE worksheet rows
// either way, so a point's jitter and every row number stay the sheet's. A window that does not fit the sheet is not
// applied (every row draws; the chip says so), never clamped.

import { useMemo } from "react";

import { rangedAnalysisView } from "../../lib/rangedView";
import type { RowRange } from "../../lib/rowRange";
import { analysisView } from "../../lib/rowstate";
import type { Dataset } from "../../lib/types";

export function useStatRows(active: Dataset | null, rowRange: RowRange | null | undefined): ReturnType<typeof analysisView> {
  const { from, to } = rowRange ?? {}; // by value: a window's view is a fresh object
  return useMemo(() => {
    const ranged = from === undefined ? null : rangedAnalysisView(active, { from, to: to! });
    return ranged && !ranged.refusal ? ranged : analysisView(active);
  }, [active, from, to]);
}
