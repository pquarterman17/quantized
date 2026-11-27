// The selected-rows actions on the row-number gutter's right-click menu (acceptance
// pass 5, u8). They were only in the toolbar's "Row selection" cluster, which a
// narrow docked Data window collapses into an unlabelled "⋯" menu. Same actions,
// same wording, same stores: this builds menu items over the toolbar's callbacks and
// adds nothing of its own. Offered when the right-clicked row is part of the
// selection (the spreadsheet convention the row menu's insert/delete already follow).

import { contiguousRowRange } from "../../../lib/rowRange";
import { openWorksheetRowRange } from "../../../store/worksheetAnalysisHandoff";
import type { ContextMenuItem } from "../../overlays/ContextMenu";
import type { WorksheetView } from "./useWorksheetView";

export function rowSelectionItems(datasetId: string, view: WorksheetView, row: number): ContextMenuItem[] {
  const n = view.selected.size;
  if (n === 0 || !view.selected.has(row)) return [];
  const block = contiguousRowRange(view.selected);
  const reason = "reason" in block ? block.reason : null;
  return [
    { separator: true },
    { header: `${n} selected row${n === 1 ? "" : "s"}` },
    { label: "Exclude", title: "Mask the selected rows (exclude from analysis)", run: view.excludeSelectedRows },
    { label: "Keep only", title: "Mask every row except the selected ones", run: view.keepOnlySelectedRows },
    {
      label: "Use as row range",
      disabled: reason !== null,
      title: reason ? `Use as row range: ${reason}` : "Limit an analysis to these rows (a contiguous block)",
      run: () => openWorksheetRowRange(datasetId, view.selected),
    },
    { label: "Deselect", title: "Clear the selection", run: view.clearRowSelection },
  ];
}
