// The rows a per-channel stack draws (plot audit round 4): the dataset's
// analysis view, with manually excluded and filtered-out rows pruned, as the
// flat plot leaves them out and every export of the view carries them. The
// stack used to fetch the raw rows and drew an excluded row as ordinary data.
// Shared by the focused stack (`MultiPanelStage`) and a background stack
// window (`windows/BackgroundAltModes`), both lazily loaded.

import { rangedAnalysisView } from "../../lib/rangedView";
import type { RowRange } from "../../lib/rowRange";
import { analysisData } from "../../lib/rowstate";
import type { Dataset } from "../../lib/types";

/** `ds` with its analysis rows as `data` (no exclusion or filter left to
 *  re-apply), or `ds` itself when nothing is dropped. The plot's row window
 *  (`range`) narrows them first, as on the flat plot; one that does not fit the
 *  sheet is not applied (every row, and the chip says so). */
export function stackDataset<T extends Dataset | null | undefined>(ds: T, range?: RowRange | null): T {
  const data = (range ? rangedAnalysisView(ds, range).data : null) ?? analysisData(ds);
  return ds && data && data !== ds.data ? ({ ...ds, data, excludedRows: [], filter: [] } as T) : ds;
}
