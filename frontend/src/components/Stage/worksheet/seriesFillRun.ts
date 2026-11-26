// Fill series (Origin gap plan item 29) for the worksheet's cell menu: number
// series down or across, and date series down by day / week / month / year.
// The values come from lib/gridSeries.ts (pure; fails closed with a reason);
// this writes them as ONE `setCellBlock` (one undo step) and reports.

import { seriesEdits, type DateUnit, type SeriesDirection } from "../../../lib/gridSeries";
import { channelLetter } from "../../../lib/formula";
import type { Dataset } from "../../../lib/types";
import type { BlockOpsSource } from "./useWorksheetBlockOps";
import type { PasteBounds } from "../../../lib/clipboardGrid";

export function runSeriesFill(
  ds: Dataset | undefined,
  src: BlockOpsSource,
  viewRows: readonly number[],
  cols: readonly number[],
  bounds: PasteBounds,
  setCellBlock: (id: string, edits: { row: number; col: number; value: number }[], label: string) => void,
  direction: SeriesDirection,
  unit?: DateUnit,
): void {
  if (!ds || viewRows.length === 0 || cols.length === 0) return src.setStatus("select rows and columns first");
  const xIsDate = ds.data.metadata?.time_is_datetime === true;
  const res = seriesEdits({
    rows: viewRows,
    cols,
    direction,
    unit,
    valueAt: src.valueAt,
    bounds,
    isDateCol: (c) => c === -1 && xIsDate,
    colName: (c) => (c < 0 ? String(ds.data.metadata?.["x_column_name"] ?? "X") : (ds.data.labels[c] || channelLetter(c))),
  });
  if ("problem" in res) return src.setStatus(`can't fill a series: ${res.problem}`);
  setCellBlock(src.datasetId, res.edits, "fill series");
  const n = res.edits.length;
  src.setStatus(`filled ${n} cell${n === 1 ? "" : "s"} in ${res.lines} ${direction === "down" ? "column" : "row"}${res.lines === 1 ? "" : "s"} with a ${unit ? `date (by ${unit})` : "number"} series — Undo restores them`);
}
