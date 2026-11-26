// Edit / Data menu commands people look for by Origin's names (UX audit 8 #6):
// Set Column Values…, Copy figure, Select all datasets. They appear in the
// menus AND the palette.
//
// Lazy-only, like commands/analysisCommands.ts: `buildAppActions` is the one
// importer, so their copy never ships in the entry chunk.

import type { StoreGet } from "../lib/exportActive";
import { onLoadFailure, runLazy } from "../lib/runLazy";
import type { Action } from "../store/commands";
import { runRepeatLast, runReopenLastDialog } from "../lib/repeatActions";
import { requestSetColumnValues } from "../store/setColumnValuesRequest";

export function buildEditDataExtras(s: StoreGet): Action[] {
  return [
    {
      // Ctrl+S (useGlobalShortcuts): writes in place once a project file is known, else asks.
      id: "save-workspace-quick",
      group: "File",
      label: "Save workspace",
      description: "Save the workspace in place once a project file is chosen (otherwise ask where), like Ctrl+S.",
      keywords: "save project dwk write",
      shortcut: "⌘S",
      run: () => void s().saveWorkspace(),
    },
    {
      // Origin's Set Column Values (Ctrl+Q on a worksheet): opens on a new column.
      id: "set-column-values",
      group: "Data",
      section: "Recalculation",
      label: "Set column values…",
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
      id: "rename-dataset",
      group: "Edit",
      label: "Rename dataset…",
      description: "Rename the selected (else active) dataset in the Library.",
      keywords: "rename dataset name f2 relabel",
      shortcut: "F2",
      run: () => void runLazy("Loading…", () => import("../lib/originKeys")).then((m) => m.originKey("f2"), onLoadFailure),
    },
    {
      id: "copy-figure",
      group: "Edit",
      label: "Copy figure",
      shortcut: "⌘J",
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
      // Origin's Ctrl+Backspace (useGlobalShortcuts, lib/repeatKeys.ts).
      id: "repeat-last-action",
      group: "Edit",
      label: "Repeat last action",
      shortcut: "⌘Backspace",
      description: "Run the last signal-processing or resample step again with the same settings on the selected dataset(s); anything else says it cannot be repeated.",
      keywords: "again redo rerun repeat last command ctrl backspace origin",
      disabled: () => s().datasets.length === 0,
      disabledReason: "Import or select a dataset first",
      run: () => void runRepeatLast(),
    },
    {
      id: "repeat-last-reversed",
      group: "Edit",
      label: "Repeat last action, inputs reversed",
      description: "Repeat a multi-input step (dataset math, join, append) taking the selected datasets in the opposite order, so A-B becomes B-A.",
      keywords: "again repeat swap reverse order inputs",
      disabled: () => s().datasets.length === 0,
      disabledReason: "Import or select a dataset first",
      run: () => void runRepeatLast({ reverse: true }),
    },
    {
      id: "reopen-last-dialog",
      group: "Edit",
      label: "Reopen last dialog",
      shortcut: "⌘⇧Backspace",
      description: "Reopen the last tool panel or dialog you opened from a command, showing the inputs it remembers.",
      keywords: "again last tool panel window reopen ctrl shift backspace origin",
      run: () => runReopenLastDialog(),
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
