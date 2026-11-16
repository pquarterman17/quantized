// Edit / Data menu commands people look for by Origin's names (UX audit 8 #6):
// Set Column Values…, Copy figure, Select all datasets. They appear in the
// menus AND the palette.
//
// Lazy-only, like commands/analysisCommands.ts: `buildAppActions` is the one
// importer, so their copy never ships in the entry chunk.

import type { StoreGet } from "../lib/exportActive";
import { onLoadFailure, runLazy } from "../lib/runLazy";
import type { Action } from "../store/commands";
import { requestSetColumnValues } from "../store/setColumnValuesRequest";

export function buildEditDataExtras(s: StoreGet): Action[] {
  return [
    {
      // Origin's Set Column Values (Ctrl+Q on a worksheet): opens on a new column.
      id: "set-column-values",
      group: "Data",
      section: "Recalculation",
      label: "Set Column Values…",
      description: "Fill a new or existing column from a formula over the other columns, with a row range and live preview.",
      keywords: "formula expression calculate computed column fx origin ctrl q column values recalculate",
      disabled: () => !s().activeId,
      disabledReason: "Import or select a dataset first",
      run: () => {
        s().setStageTab("worksheet");
        requestSetColumnValues();
      },
    },
    {
      id: "copy-figure",
      group: "Edit",
      label: "Copy figure",
      description: "Copy the figure to the clipboard, rendered like an export, to paste into Word or PowerPoint.",
      keywords: "clipboard image picture paste word powerpoint publication",
      disabled: () => !s().activeId,
      disabledReason: "Import or select a dataset first",
      run: () =>
        void runLazy("Loading figure copy…", () => import("../lib/copyFigureCommand")).then(
          (m) => m.runCopyFigureCommand(s),
          onLoadFailure,
        ),
    },
    {
      id: "select-all-datasets",
      group: "Edit",
      label: "Select all datasets",
      description: "Select every dataset in the Library.",
      keywords: "every all library selection ctrl a",
      disabled: () => s().datasets.length === 0,
      disabledReason: "No datasets to select",
      run: () => s().selectIds(s().datasets.map((d) => d.id)),
    },
  ];
}
