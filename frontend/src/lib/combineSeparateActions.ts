// LIBRARY_WORKBOOK_UX_PLAN PR J slice 2 (L0.32-L0.34/L0.51): the two
// dataset-row menu entries for Combine and Separate. Its own file, the same
// reason lib/derivedWorksheetActions.ts is one — lib/contextActions.ts sits
// exactly at its 500-line ceiling with zero headroom, so a cohesive,
// independently-gated group splices in from datasetRowMenu.ts at no cost to
// that file (`ContextAction.hidden`/`enabled` gate each entry themselves).
//
// dataset.combine only makes sense on a genuine multi-selection (Combine
// merges >=2 sources into one new workbook — a lone worksheet has nothing to
// combine WITH); dataset.separate applies to any selection, single or multi,
// same "act on the whole selection when this row is part of one" idiom
// datasetRowMenu.ts's own "Move to…" already uses for `moveIds`.

import { openCombineDialog } from "../store/combineDialog";
import { useApp } from "../store/useApp";
import { multiSelected, type ContextAction, type DatasetActionTarget } from "./contextActions";

/** This row's target ids for a selection-scoped action — the whole
 *  multi-selection when this row is part of one, else just this row alone
 *  (datasetRowMenu.ts's `moveIds` pattern, replicated here since a registry
 *  action's `run` only receives the `DatasetActionTarget`, not the row's own
 *  locals). */
const actionIds = (t: DatasetActionTarget): string[] => (multiSelected(t) ? [...t.selectedIds] : [t.dataset.id]);

export const datasetCombineSeparateActions: ContextAction<DatasetActionTarget>[] = [
  {
    id: "dataset.combine",
    label: (t) => `Combine ${t.selectedIds.length} selected into new workbook…`,
    hidden: (t) => !multiSelected(t),
    run: (t) => openCombineDialog({ workbookIds: [], worksheetIds: actionIds(t) }),
  },
  {
    id: "dataset.separate",
    label: (t) => (multiSelected(t) ? `Separate ${t.selectedIds.length} selected into new workbook…` : "Separate into new workbook…"),
    run: (t) => useApp.getState().previewSeparateWorksheets(actionIds(t)),
  },
];
