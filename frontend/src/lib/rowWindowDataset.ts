// A worksheet reduced to a plot's row window (ROW_RANGE_CONTRACT 3.3): the ONE place that cuts a dataset to the
// rows of a `PlotView.rowRange`, for every plot kind that builds its panels from the sheet's rows (a facet grid,
// an axis break, a spatial panel, the figure export). The window's rows are re-based to positions 0..n-1 with
// their exclusions, row styles and text sidecars, so everything downstream (the exclusion prune, the facet
// split, the break segments) runs on the window's own rows exactly as it does on a whole sheet. Row labels the
// user sees stay SOURCE rows because the plain plot and the export keep their own source-row bookkeeping; a
// facet or break panel names no rows.
//
// The window the screen applies and the one the export applies are the SAME function, so they cannot disagree
// about which rows a panel holds (tests/fixtures/wire/row_range_figure.json pins the flat plot; the facet and
// break cases pin these). Pure: no store, no React.

import type { RowRange } from "./rowRange";
import { rowRangeRefusal } from "./rowRange";
import { sliceRowSidecars } from "./rowSidecars";
import { windowedExclusions } from "./rowstate";
import type { DataStruct, Dataset } from "./types";

/** The rows `keep` of `data`, its row-indexed sidecars following. */
export const cutRows = (data: DataStruct, keep: readonly number[]): DataStruct => ({
  ...data,
  time: keep.map((r) => data.time[r]),
  values: keep.map((r) => data.values[r]),
  metadata: sliceRowSidecars(data.metadata, keep),
});

export const rowsOf = (range: RowRange): number[] => Array.from({ length: Math.max(0, range.to - range.from + 1) }, (_v, i) => range.from + i);

/** The live dataset `live` reduced to the rows of `range`, `data` being the already cut data: its exclusions
 *  re-based to the window's own positions, its row styles dropped (they are indexed by the whole sheet's rows; the
 *  figure export re-bases them itself, `lib/figureRowRange`, because this module is eager and the style code is not).
 *  `range` must fit the sheet (checked by the caller). */
export function windowedWithData(live: Dataset, data: DataStruct, range: RowRange): Dataset {
  return { ...live, data, excludedRows: windowedExclusions(live, range.from, range.to), rowStyle: undefined };
}

/** `ds` reduced to the rows of the plot's window, as the plot draws them:
 *   - no window, a worksheet still loading, or a window that does not fit the sheet (the plot then draws every row
 *     and its chip says "not applied"): `ds` itself;
 *   - a named link that cannot be read (`refused`, never widened): `ds` with NO rows;
 *   - otherwise the window's rows. */
export function windowedDataset<T extends Dataset | null | undefined>(ds: T, range: RowRange | null | undefined): T {
  if (!ds || !range || ds.pending != null) return ds;
  if (range.refused !== undefined) return { ...ds, data: cutRows(ds.data, []), excludedRows: undefined, rowStyle: undefined } as T;
  if (rowRangeRefusal(range, ds.data.time.length)) return ds;
  return windowedWithData(ds, cutRows(ds.data, rowsOf(range)), range) as T;
}
