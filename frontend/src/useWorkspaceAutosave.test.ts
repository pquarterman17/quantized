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
  plotWindows: [],
  focusedWindowId: null,
  savedPlotSpecs: [],
};

describe("shouldAutosave", () => {
  it("does not save when every persisted workspace field is referentially unchanged", () => {
    expect(shouldAutosave(base, base)).toBe(false);
  });

  it.each(["originFigures", "reports", "macroSteps", "figureDocs", "savedPlotSpecs"] as const)(
    "saves when %s changes",
    (field) => {
      expect(shouldAutosave({ ...base, [field]: [] }, base)).toBe(true);
    },
  );

  it("saves when recalculation mode changes", () => {
    expect(shouldAutosave({ ...base, recalcMode: "manual" }, base)).toBe(true);
  });
});
