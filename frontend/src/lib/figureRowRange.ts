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

import type { PlotView } from "./plotview";
import { rowRangeRefusal, type RowRange } from "./rowRange";
import { sliceRowStyle } from "./rowStyle";
import { cutRows, rowsOf, windowedWithData } from "./rowWindowDataset";
import type { BaselineOverlay, DataStruct, Dataset, FitOverlay, PeakOverlay } from "./types";

/** `windowedWithData` plus the row styles, re-based to the window (the export keeps them; the screen's facet and break
 *  panels draw none). */
function windowedForFigure(live: Dataset, data: DataStruct, range: RowRange): Dataset {
  const keep = rowsOf(range);
  return { ...windowedWithData(live, data, range), ...sliceRowStyle(live, keep, keep.length, live.data.time.length) };
}

/** `data` and the live dataset reduced to the rows of the view's window, or both
 *  unchanged without one. A range that does not fit the sheet is refused (thrown,
 *  with the reason), never clamped or dropped: the figure would silently hold
 *  rows the window does not draw, or none. */
export function windowFigureInputs<E extends { liveDataset?: Dataset | null }>(
  st: Pick<PlotView, "rowRange">,
  data: DataStruct,
  extras: E,
): [DataStruct, E] {
  const range = st.rowRange;
  if (!range) return [data, extras];
  const live = extras.liveDataset;
  if (live?.pending != null) throw new Error("Plot row range: the worksheet's full data is still loading.");
  const refusal = rowRangeRefusal(range, data.time.length);
  if (refusal) throw new Error(`Plot row range: ${refusal}.`);
  const keep = Array.from({ length: range.to - range.from + 1 }, (_v, i) => range.from + i);
  const windowed = cutRows(data, keep);
  if (!live) return [windowed, extras];
  const liveData = live.data === data ? windowed : cutRows(live.data, keep);
  return [windowed, { ...extras, liveDataset: windowedForFigure(live, liveData, range) }];
}

type Curve = { y: (number | null)[]; band?: { y: (number | null)[] }[] };
const slice = <T extends Curve>(o: T, range: RowRange): T => ({
  ...o,
  y: o.y.slice(range.from, range.to + 1),
  ...(o.band ? { band: o.band.map((e) => ({ ...e, y: e.y.slice(range.from, range.to + 1) })) } : {}),
});

/** The overlays a windowed figure may carry: `ds` and each overlay cut to the window's rows (the screen hides an
 *  overlay outside the window the same way), or null when there is no window or it cannot be applied here (the
 *  figure then draws every row, or was refused earlier). A curve of another length than the sheet is left as is:
 *  placement then refuses it, as it does on every row. */
export function windowOverlayInputs<S extends { fitOverlay: FitOverlay | null; baselineOverlay: BaselineOverlay | null; peakOverlay: PeakOverlay | null }>(
  range: RowRange | null | undefined,
  ds: Dataset,
  sources: S,
): { ds: Dataset; sources: S } | null {
  if (!range || ds.pending != null || rowRangeRefusal(range, ds.data.time.length)) return null;
  const n = ds.data.time.length;
  const cutTo = <T extends Curve & { datasetId: string }>(o: T | null): T | null => (o && o.y.length === n ? slice(o, range) : o);
  const keep = Array.from({ length: range.to - range.from + 1 }, (_v, i) => range.from + i);
  return {
    ds: windowedForFigure(ds, cutRows(ds.data, keep), range),
    sources: { ...sources, fitOverlay: cutTo(sources.fitOverlay), baselineOverlay: cutTo(sources.baselineOverlay), peakOverlay: cutTo(sources.peakOverlay) },
  };
}
