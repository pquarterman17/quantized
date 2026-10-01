// Consumes store/worksheetReveal.ts's one-slot "reveal this row" request for
// the worksheet pane it is mounted in: maps the DATASET row to its position in
// the pane's filtered + sorted display order, hands GridViewport a scroll
// target, and selects the row. A row the worksheet's own filter hides gets one
// sentence instead of a scroll (excluded and globally filtered rows are still
// displayed, greyed, so they scroll like any other).
//
// The request waits — unconsumed — until a pane for its dataset and window is
// mounted with full data, so filing it before the tab switch is fine.

import { useEffect, useState } from "react";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useWorksheetReveal } from "../../../store/worksheetReveal";
import type { GridReveal } from "./GridViewport";
import { textColumnRowCount } from "./textColumns";
import type { WorksheetView } from "./useWorksheetView";

export function useRowReveal(
  ds: Dataset,
  view: Pick<WorksheetView, "order" | "textCols" | "setRowSelection">,
  windowId?: string,
): { target: GridReveal | null; notice: string | null } {
  const req = useWorksheetReveal((s) => s.rowReveal);
  const setStatus = useApp((s) => s.setStatus);
  const [target, setTarget] = useState<GridReveal | null>(null);
  // The notice belongs to the display order it was computed against: any
  // filter/sort/data change retires it without an effect.
  const [notice, setNotice] = useState<{ text: string; order: number[] } | null>(null);

  useEffect(() => {
    // A still-loading book's preview rows are not (all) its real rows.
    if (!req || req.datasetId !== ds.id || req.windowId !== windowId || ds.pending) return;
    useWorksheetReveal.getState().consumeRowReveal(req.nonce);
    const pos = view.order.indexOf(req.row);
    if (pos < 0) {
      const rows = Math.max(ds.data.time.length, textColumnRowCount(view.textCols));
      const text = req.row >= 0 && req.row < rows
        ? `Row ${req.row + 1} is hidden by the worksheet filter.`
        : `Row ${req.row + 1} is not in this worksheet.`;
      setNotice({ text, order: view.order });
      setStatus(text);
      return;
    }
    setNotice(null);
    setTarget({ pos, column: req.column, key: req.nonce });
    if (req.select !== false) view.setRowSelection([req.row]);
  }, [req, ds, windowId, view, setStatus]);

  return { target, notice: notice && notice.order === view.order ? notice.text : null };
}
