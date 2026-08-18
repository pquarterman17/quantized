// LIBRARY_WORKBOOK_UX_PLAN PR K, slice 2 (L0.50): the two dataset-row menu
// entries for derived worksheets — "Create Derived Worksheet" (any ordinary
// dataset) and "Freeze Copy" (a derived worksheet only). Its own file rather
// than living in lib/contextActions.ts, which sits exactly at the general
// .ts ceiling (architecture.test.ts) with zero headroom; splicing a cohesive,
// independently-gated group in from `datasetRowMenu.ts` costs that file
// nothing (`ContextAction.hidden` gates each entry itself, so no extra
// wrapper condition is needed at the splice site, unlike the `d.corrections`-
// gated `datasetCorrectionsActions` block it sits beside).

import { useApp } from "../store/useApp";
import type { ContextAction, DatasetActionTarget } from "./contextActions";

export const datasetDerivedWorksheetActions: ContextAction<DatasetActionTarget>[] = [
  {
    id: "dataset.createDerivedWorksheet",
    label: "Create Derived Worksheet",
    // A derived worksheet doesn't derive from itself — Freeze Copy is its
    // analogue action. Available even with no corrections configured yet
    // (L0.50 covers "a correction OR TRANSFORMATION"); the created sheet's
    // pipeline is simply empty in that case.
    hidden: (t) => !!t.dataset.derivedFrom,
    run: (t) => void useApp.getState().createDerivedWorksheet(t.dataset.id, t.dataset.corrections ?? {}),
  },
  {
    id: "dataset.freezeCopy",
    label: "Freeze Copy",
    hidden: (t) => !t.dataset.derivedFrom,
    run: (t) => useApp.getState().freezeCopy(t.dataset.id),
  },
];
