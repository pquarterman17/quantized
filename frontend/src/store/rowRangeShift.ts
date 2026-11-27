// Row ranges set on the shared analysis selection follow row edits (ROW_RANGE_
// CONTRACT 3.2). A range is positions, so insert and delete remap it exactly as
// they remap `excludedRows` (lib/rowRange over lib/rowShift); sort and Move rows
// leave it alone and say so. Only the transient selection holds a range in this
// slice, so this is the one place that has to hear about a row operation.

import { shiftRangeForDelete, shiftRangeForInsert } from "../lib/rowRange";
import { useAnalysisSelection } from "./analysisSelection";

function mapRanges(datasetId: string, shift: (range: NonNullable<ReturnType<typeof ranges>[number]["rowRange"]>) => ReturnType<typeof shiftRangeForInsert>): void {
  const { selection, toolId } = useAnalysisSelection.getState();
  if (!selection || toolId === null || !ranges(datasetId).length) return;
  useAnalysisSelection.setState({
    selection: {
      ...selection,
      items: selection.items.map((item) => item.datasetId === datasetId && item.rowRange ? { ...item, rowRange: shift(item.rowRange) } : item),
    },
  });
}

function ranges(datasetId: string) {
  return (useAnalysisSelection.getState().selection?.items ?? []).filter((item) => item.datasetId === datasetId && item.rowRange);
}

export function shiftRowRangesForInsert(datasetId: string, at: number, count: number): void {
  mapRanges(datasetId, (range) => shiftRangeForInsert(range, at, count));
}

export function shiftRowRangesForDelete(datasetId: string, deleted: ReadonlySet<number>): void {
  mapRanges(datasetId, (range) => shiftRangeForDelete(range, deleted));
}

/** Status-line note for a sort or Move rows: a range is by position, so it now
 *  covers different rows. "" when this worksheet has none. */
export function rowRangeOrderNote(datasetId: string): string {
  const count = ranges(datasetId).length;
  return count ? `; ${count} row range${count === 1 ? " is" : "s are"} by position and now cover${count === 1 ? "s" : ""} different rows` : "";
}
