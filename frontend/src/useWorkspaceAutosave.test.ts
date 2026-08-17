import { describe, expect, it } from "vitest";

import { shouldAutosave, type AutosaveState } from "./useWorkspaceAutosave";

const base: AutosaveState = {
  datasets: [],
  folders: [],
  activeId: null,
  selectedIds: [],
  expandedFolders: [],
  originFigures: [],
  smartFolders: [],
  reports: [],
  macroSteps: [],
  recalcMode: "auto",
  figureDocs: [],
  editableFigures: [],
  pages: [],
  plotWindows: [],
  focusedWindowId: null,
  savedPlotSpecs: [],
  librarySelection: null,
  workbookLastChild: {},
  expandedWorkbookIds: [],
};

describe("shouldAutosave", () => {
  it("does not save when every persisted workspace field is referentially unchanged", () => {
    expect(shouldAutosave(base, base)).toBe(false);
  });

  // `editableFigures` is here as the F1.4-review regression pin: the field
  // was omitted from the trigger list when the collection first shipped, so
  // deleting/duplicating a saved figure never scheduled an autosave.
  //
  // `librarySelection`/`workbookLastChild`/`expandedWorkbookIds`
  // (LIBRARY_WORKBOOK_UX_PLAN PR E2) are here for the same reason: each is a
  // FIELD in `AutosaveState`, so a change to only ONE of them (not the whole
  // library) must still schedule the debounce.
  it.each(
    [
      "originFigures",
      "reports",
      "macroSteps",
      "figureDocs",
      "editableFigures",
      "pages",
      "savedPlotSpecs",
      "librarySelection",
      "workbookLastChild",
      "expandedWorkbookIds",
    ] as const,
  )("saves when %s changes", (field) => {
    expect(shouldAutosave({ ...base, [field]: [] }, base)).toBe(true);
  });

  it("saves when recalculation mode changes", () => {
    expect(shouldAutosave({ ...base, recalcMode: "manual" }, base)).toBe(true);
  });
});
