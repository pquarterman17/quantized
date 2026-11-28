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
      // A column that follows another worksheet's, row for row (plans/ROW_RANGE_CONTRACT.md 6).
      id: "mirror-column",
      group: "Data",
      section: "Recalculation",
      label: "Mirror column…",
      description: "Add a column to this worksheet that follows a column of another worksheet, with Go to Source and Detach in its header menu.",
      keywords: "mirror linked link column follow reference another worksheet sheet source detach",
      disabled: () => s().datasets.length < 2,
      disabledReason: "Needs a second worksheet to mirror from",
      run: () => {
        const id = s().worksheetId ?? s().activeId;
        if (!id) return;
        s().setStageTab("worksheet");
        void runLazy("Loading mirror columns…", () => import("../store/mirrorColumnDialog")).then((m) => m.mirrorColumnDialog(id), onLoadFailure);
      },
    },
    {
      // A name for a block of one worksheet, usable as rng("Name"), a plot window or an analysis input (ROW_RANGE_CONTRACT 5).
      id: "named-ranges",
      group: "Data",
      section: "Recalculation",
      label: "Named ranges…",
      description: "List the named blocks of worksheet cells, rename, retarget or delete them, and plot or analyze one; name a selection in the worksheet's Name box.",
      keywords: "named range name box define block selection rng formula baseline window manager",
      run: () => void runLazy("Loading named ranges…", () => import("../components/workshops/namedranges/openManager")).then((m) => m.openNamedRangesManager(), onLoadFailure),
    },
    {
      id: "column-list",
      group: "Data",
      section: "Recalculation",
      label: "Column list…",
      description: "Every column of the worksheet on one page: name, unit, designation, type, formula and row count, with rename and Set As in place.",
      keywords: "column list columns overview properties names units designation type rename set as sheet structure",
      disabled: () => !(s().worksheetId ?? s().activeId),
      disabledReason: "Import or select a dataset first",
      run: () => {
        const id = s().worksheetId ?? s().activeId;
        if (id) void runLazy("Loading the column list…", () => import("../components/workshops/sheetstructure/openSheetStructure")).then((m) => m.openColumnList(id), onLoadFailure);
      },
    },
    {
      id: "protect-sheet",
      group: "Data",
      section: "Recalculation",
      label: "Protect or unprotect sheet",
      description: "Refuse edits, row and column changes, sorts and formula changes on the worksheet until it is unprotected, with no password.",
      keywords: "protect unprotect lock sheet read only worksheet refuse edits password",
      disabled: () => !(s().worksheetId ?? s().activeId),
      disabledReason: "Import or select a dataset first",
      run: () => {
        const id = s().worksheetId ?? s().activeId;
        const ds = s().datasets.find((d) => d.id === id);
        if (id && ds) void runLazy("Loading sheet protection…", () => import("../store/sheetProtection")).then((m) => m.setSheetProtected(id, !ds.protectedSheet), onLoadFailure);
      },
    },
    {
      id: "time-series-pivot",
      group: "Data",
      section: "Recalculation",
      label: "Pivot (long to wide)…",
      description: "Reshape a time, key, value sheet into one column per key as a new worksheet, or stack columns back; repeated times are refused or combined by a rule you pick.",
      keywords: "pivot unpivot melt reshape long wide stack columns time series key value transpose",
      disabled: () => !(s().worksheetId ?? s().activeId),
      disabledReason: "Import or select a dataset first",
      run: () => {
        const id = s().worksheetId ?? s().activeId;
        if (id) void runLazy("Loading the pivot…", () => import("../components/workshops/sheetstructure/openSheetStructure")).then((m) => m.openPivot(id), onLoadFailure);
      },
    },
    {
      id: "insert-column-similar",
      group: "Data",
      section: "Recalculation",
      label: "Insert column into similar sheets…",
      description: "Add one column, blank or from a formula, to this worksheet and every worksheet with the same columns, as one undo step.",
      keywords: "insert add column every all similar sheets same layout batch workbook",
      disabled: () => !(s().worksheetId ?? s().activeId),
      disabledReason: "Import or select a dataset first",
      run: () => {
        const id = s().worksheetId ?? s().activeId;
        if (id) void runLazy("Loading the sheet tools…", () => import("../components/workshops/sheetstructure/openSheetStructure")).then((m) => m.openInsertSimilar(id), onLoadFailure);
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
