// A plot's row window on the export wire (ROW_RANGE_CONTRACT 3.3): the figure
// holds exactly the rows the canvas draws. The screen hides rows outside
// `PlotView.rowRange` (`lib/plotRowWindow.ts`); the export REMOVES them, so the
// matplotlib axes range over the window alone, as the canvas' do
// (`tests/fixtures/wire/row_range_figure.json` pins the two together).
//
// Done once, up front: the window is cut out of the data AND of the live
// dataset's row state (exclusions, row styles, text sidecars), and everything
// downstream (`pruneToLiveDataset`'s exclusion and filter prune, facets, point
// labels, row states) then works on the window's own rows, positions 0..n-1,
// exactly as it does on a whole sheet. So the exclusion prune lands "after" the
// window, on the window's rows, and a row excluded outside it never reaches the
// wire either way.

import { rowRangeRefusal, type RowRange } from "./rowRange";
import { sliceRowSidecars } from "./rowSidecars";
import { sliceRowStyle } from "./rowStyle";
import { windowedExclusions } from "./rowstate";
import type { DataStruct, Dataset } from "./types";

const cut = (data: DataStruct, keep: readonly number[]): DataStruct => ({
  ...data,
  time: keep.map((r) => data.time[r]),
  values: keep.map((r) => data.values[r]),
  metadata: sliceRowSidecars(data.metadata, keep),
});

/** `data` and the live dataset reduced to the rows of `range`, or both
 *  unchanged without one. A range that does not fit the sheet is refused (thrown,
 *  with the reason), never clamped or dropped: the figure would silently hold
 *  rows the window does not draw, or none. */
export function windowFigureInputs<E extends { liveDataset?: Dataset | null }>(
  range: RowRange | null | undefined,
  data: DataStruct,
  extras: E,
): [DataStruct, E] {
  if (!range) return [data, extras];
  const live = extras.liveDataset;
  if (live?.pending != null) throw new Error("Plot row range: the worksheet's full data is still loading.");
  const refusal = rowRangeRefusal(range, data.time.length);
  if (refusal) throw new Error(`Plot row range: ${refusal}.`);
  const keep = Array.from({ length: range.to - range.from + 1 }, (_v, i) => range.from + i);
  const sameRows = live?.data === data;
  const windowed = cut(data, keep);
  if (!live) return [windowed, extras];
  const liveData = sameRows ? windowed : cut(live.data, keep);
  const liveWindow: Dataset = {
    ...live,
    data: liveData,
    excludedRows: windowedExclusions(live, range.from, range.to),
    ...sliceRowStyle(live, keep, keep.length, live.data.time.length),
  };
  return [windowed, { ...extras, liveDataset: liveWindow }];
}
