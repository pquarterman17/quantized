// The worksheet-level entries at the foot of the toolbar's Columns menu: Show formulas, the column
// list, and sheet protection. Lazy (the button imports it on first open), so none of the wording
// ships in the entry chunk.

import type { ContextMenuItem } from "../../overlays/ContextMenu";
import { runLazy, onLoadFailure } from "../../../lib/runLazy";
import { PROTECTED_NOTICE } from "../../../lib/sheetProtection";
import type { Dataset } from "../../../lib/types";

export interface SheetViewControls {
  ds: Dataset;
  showFormulas: boolean;
  toggleFormulas: () => void;
}

export function sheetViewItems({ ds, showFormulas, toggleFormulas }: SheetViewControls): ContextMenuItem[] {
  const hasFormulas = (ds.formulas?.length ?? 0) > 0;
  return [
    { separator: true },
    {
      label: "Show formulas",
      checked: showFormulas,
      disabled: !hasFormulas && !showFormulas,
      title: hasFormulas || showFormulas ? "Draw each formula cell's text in place of its value, in this window only (view only; nothing is changed or saved)" : "this worksheet has no formula columns",
      run: toggleFormulas,
    },
    {
      label: "Column list…",
      title: "Every column of this worksheet on one page: name, unit, designation, type, formula and row count",
      run: () => void runLazy("Loading the column list…", () => import("../../workshops/sheetstructure/openSheetStructure")).then((m) => m.openColumnList(ds.id), onLoadFailure),
    },
    {
      label: ds.protectedSheet ? "Unprotect sheet" : "Protect sheet",
      title: ds.protectedSheet ? PROTECTED_NOTICE : "Refuse cell edits, row and column changes, sorts and formula changes until unprotected (no password; viewing, copying, plotting and analysis stay allowed)",
      run: () => void runLazy("Loading sheet protection…", () => import("../../../store/sheetProtection")).then((m) => m.setSheetProtected(ds.id, !ds.protectedSheet), onLoadFailure),
    },
  ];
}
