import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setAutosaveBackend } from "./lib/autosave";
import { memoryBackend } from "./lib/autosaveBackend";
import { serializeWorkspace } from "./lib/workspace";
import { useRecentProjects } from "./store/recentProjects";
import { useRecoveryChoice } from "./store/recoveryChoice";
import { useApp } from "./store/useApp";
import { shouldAutosave, useWorkspaceAutosave, type AutosaveState } from "./useWorkspaceAutosave";

const ds = {
  id: "a",
  name: "a.dat",
  data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} },
};

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

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
  workbooks: [],
  savedRois: [],
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
  //
  // `workbooks`/`savedRois` are the post-merge-review regression pin: both
  // were already persisted fields with no trigger here — a rename/move that
  // touches ONLY `workbooks`, or a named-ROI save/delete that touches ONLY
  // `savedRois`, could sit unsaved until some unrelated field also changed.
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
      "workbooks",
      "savedRois",
    ] as const,
  )("saves when %s changes", (field) => {
    expect(shouldAutosave({ ...base, [field]: [] }, base)).toBe(true);
  });

  it("saves when recalculation mode changes", () => {
    expect(shouldAutosave({ ...base, recalcMode: "manual" }, base)).toBe(true);
  });
});

// P1.2 box 1: the dirty marker must flip the moment a persisted field
// changes — reusing the SAME shouldAutosave comparison the debounced save
// itself uses (see useWorkspaceAutosave.ts's subscribe callback), so the
// two can never disagree about what counts as "changed".
describe("dirty tracking (P1.2 box 1)", () => {
  beforeEach(() => {
    setAutosaveBackend(memoryBackend());
    useApp.setState({ datasets: [], plotWindows: [], focusedWindowId: null, projectDirty: false });
  });

  afterEach(() => {
    useApp.setState({ projectDirty: false });
  });

  it("marks the project dirty as soon as a persisted field changes, before the debounce fires", () => {
    renderHook(() => useWorkspaceAutosave());
    expect(useApp.getState().projectDirty).toBe(false);

    act(() => {
      useApp.setState({
        datasets: [
          {
            id: "a",
            name: "a.dat",
            data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} },
          },
        ],
      });
    });

    // Synchronous — markProjectDirty runs inside the subscribe callback
    // itself, not inside the 800ms debounced save.
    expect(useApp.getState().projectDirty).toBe(true);
  });

  it("does not mark dirty when an unrelated field changes", () => {
    renderHook(() => useWorkspaceAutosave());
    act(() => {
      useApp.setState({ status: "some unrelated status text" });
    });
    expect(useApp.getState().projectDirty).toBe(false);
  });
});

// P1.2 box 5: crash recovery must EXPLAIN itself (source/time/choices) and
// never silently auto-restore over a named project — only when there IS a
// named "last project" AND the autosave candidate is newer than it.
describe("startup recovery choice (P1.2 box 5)", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [], currentProject: null, projectDirty: false });
    useRecentProjects.setState({ recentProjects: [] });
    useRecoveryChoice.setState({ pending: null });
  });

  afterEach(() => {
    useRecentProjects.setState({ recentProjects: [] });
    useRecoveryChoice.setState({ pending: null });
  });

  it("offers a choice instead of silently restoring when the autosave is newer than the last project", async () => {
    setAutosaveBackend(memoryBackend([{ at: 500, text: serializeWorkspace({ datasets: [ds] }) }]));
    useRecentProjects.setState({
      recentProjects: [{ name: "project.dwk", path: "/p/project.dwk", at: new Date(100).toISOString() }],
    });

    renderHook(() => useWorkspaceAutosave());
    await flush();

    // NOT auto-loaded — the live session stays empty until the user chooses.
    expect(useApp.getState().datasets).toEqual([]);
    const pending = useRecoveryChoice.getState().pending;
    expect(pending).not.toBeNull();
    expect(pending?.autosaveAt).toBe(500);
    expect(pending?.datasetCount).toBe(1);
    expect(pending?.lastProject).toEqual({ name: "project.dwk", path: "/p/project.dwk", at: 100 });
  });

  it("silently restores exactly as before when there is no last-known project", async () => {
    setAutosaveBackend(memoryBackend([{ at: 500, text: serializeWorkspace({ datasets: [ds] }) }]));
    // recentProjects stays empty (set in beforeEach).

    renderHook(() => useWorkspaceAutosave());
    await flush();

    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["a.dat"]);
    expect(useRecoveryChoice.getState().pending).toBeNull();
  });

  it("silently restores when the autosave is NOT newer than the last project", async () => {
    setAutosaveBackend(memoryBackend([{ at: 500, text: serializeWorkspace({ datasets: [ds] }) }]));
    useRecentProjects.setState({
      recentProjects: [{ name: "project.dwk", path: "/p/project.dwk", at: new Date(1000).toISOString() }],
    });

    renderHook(() => useWorkspaceAutosave());
    await flush();

    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["a.dat"]);
    expect(useRecoveryChoice.getState().pending).toBeNull();
  });
});
