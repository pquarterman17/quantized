// Publishes the worksheet's cell-selection statistics to the status bar
// (lib/selectionStats.ts, store/selectionStats.ts). The selection is the one the
// pane already resolves for Find (a cell range, or whole rows / columns), so the
// status bar and Find can never disagree about what is selected. Memoised on the
// selection and data identity: a re-render with the same selection costs nothing,
// and a 1M x 6 select-all is summed once, in a macrotask after the paint.

import { useEffect, useId, useMemo, useRef } from "react";

import { categoricalLevels } from "../../../lib/categorical";
import { fmtDispStat } from "../../../lib/locale";
import { formatSelectionStats, memoSelectionStats, worthShowing } from "../../../lib/selectionStats";
import { filteredOutSet } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";
import { useSelectionStats } from "../../../store/selectionStats";
import type { WorksheetView } from "./useWorksheetView";

export interface SheetSelection {
  rows: ReadonlySet<number>;
  cols: ReadonlySet<number>;
}

export function useSelectionStatsPublisher(ds: Dataset, view: WorksheetView, selection: SheetSelection | null): void {
  const owner = useId();
  const memo = useRef(memoSelectionStats());
  const { data, masked } = view;
  const filteredOut = useMemo(() => filteredOutSet(ds), [ds]);
  useEffect(() => {
    // A macrotask, so a drag-select repaints before a large selection is summed.
    const t = setTimeout(() => {
      const stats = selection
        ? memo.current([selection.rows, selection.cols, data, masked, filteredOut], () => ({
            rows: selection.rows,
            cols: selection.cols,
            valueAt: (row, col) => (col < 0 ? data.time[row] : data.values[row]?.[col]),
            // A categorical column's cells are level labels; a date X column's are epoch numbers.
            isTextCol: (col) => (col < 0 ? data.metadata?.time_is_datetime === true : categoricalLevels(data, col) !== null),
            isSkippedRow: (row) => masked.has(row) || filteredOut.has(row),
          }))
        : null;
      useSelectionStats.getState().publish(owner, worthShowing(stats) ? formatSelectionStats(stats, fmtDispStat) : null);
    }, 0);
    return () => clearTimeout(t);
  }, [owner, selection, data, masked, filteredOut]);
  useEffect(() => () => useSelectionStats.getState().publish(owner, null), [owner]);
}
