// Store-level tests for LIBRARY_WORKBOOK_UX_PLAN PR A4 (append/merge
// workbook transfer) — a companion to lib/workspaceMerge.test.ts's pure
// unit tests. Those exercise `mergeWorkspace` in isolation; these exercise
// the full `useApp.appendWorkspace` -> `runAppendWorkspace` ->
// `mergeWorkspace` path through the real store, including the
// `HistorySnapshot` undo/redo round-trip that `mergeWorkspace` itself can't
// see. Deliberately NOT added to store/useApp.test.ts (off-limits while a
// parallel PR A3 agent works that file) or store/history.test.ts (its
// existing "append workspace" case predates workbooks and doesn't need
// touching — this file adds coverage instead of extending it).

import { beforeEach, describe, expect, it } from "vitest";

import type { LoadedWorkspace } from "../lib/workspace";
import type { Dataset } from "../lib/types";
import type { WorkbookNode } from "../lib/workbooks";
import { useApp } from "./useApp";

const raw: Dataset["data"] = {
  time: [0, 1, 2],
  values: [[10, 100], [20, 200], [30, 300]],
  labels: ["A", "B"],
  units: ["emu", "Oe"],
  metadata: {},
};

// A minimal LoadedWorkspace wrapper, mirroring lib/workspaceMerge.test.ts's
// `asLoaded` — `mergeWorkspace` (and therefore `appendWorkspace`) only ever
// reads `.datasets` and `.workbooks` off it.
function asLoaded(datasets: Dataset[], workbooks: WorkbookNode[] = []): LoadedWorkspace {
  return {
    datasets,
    folders: [],
    workbooks,
    activeId: null,
    selectedIds: [],
    expandedFolders: [],
    originFigures: [],
    originFidelity: [],
    smartFolders: [],
    reports: [],
    macroSteps: [],
    recalcMode: "auto",
    figureDocs: [],
    editableFigures: [],
    pages: [],
    migrationWarnings: [],
    plotWindows: [],
    focusedWindowId: null,
    toolWindowLayout: {},
    savedPlotSpecs: [],
    techniqueViewMemory: {},
    savedRois: [],
  };
}

beforeEach(() => {
  useApp.setState({
    datasets: [],
    workbooks: [],
    activeId: null,
    history: [],
    future: [],
    status: "",
  });
});

describe("useApp appendWorkspace — workbook transfer (LIBRARY_WORKBOOK_UX_PLAN PR A4)", () => {
  it("grows store workbooks by exactly the transferred set, remaps each appended dataset's workbookId, and lands them at the Library root", () => {
    const wb: WorkbookNode = { id: "src-wb", name: "Book9", originBook: "Book9", folderId: "f1" };
    const sheet1 = { id: "s1", name: "sheet1", data: raw, workbookId: "src-wb" };
    const sheet2 = { id: "s2", name: "sheet2", data: raw, workbookId: "src-wb" };

    useApp.getState().appendWorkspace(asLoaded([sheet1, sheet2], [wb]));

    const s = useApp.getState();
    expect(s.workbooks).toHaveLength(1); // grew by exactly the one transferred workbook
    const transferred = s.workbooks[0];
    expect(transferred.id).not.toBe("src-wb"); // fresh id, never the incoming one
    expect(transferred.name).toBe("Book9");
    expect(transferred.originBook).toBe("Book9");
    expect(transferred.folderId).toBeUndefined(); // Library root, not "f1"

    expect(s.datasets).toHaveLength(2);
    expect(s.datasets.every((d) => d.workbookId === transferred.id)).toBe(true);
    expect(s.status).toMatch(/1 workbook landed at Library root/);
  });

  it("undo restores the pre-append workbook list (workbooks already ride HistorySnapshot)", () => {
    useApp.setState({
      workbooks: [{ id: "existing-wb", name: "already here" }],
    });
    const wb: WorkbookNode = { id: "src-wb", name: "New Book" };
    const sheet = { id: "s1", name: "sheet", data: raw, workbookId: "src-wb" };

    const preWorkbooks = useApp.getState().workbooks;
    useApp.getState().appendWorkspace(asLoaded([sheet], [wb]));

    expect(useApp.getState().workbooks).toHaveLength(2); // existing + transferred
    useApp.getState().undo();
    expect(useApp.getState().workbooks).toBe(preWorkbooks); // exact pre-append reference restored
    expect(useApp.getState().workbooks).toHaveLength(1);

    useApp.getState().redo();
    expect(useApp.getState().workbooks).toHaveLength(2);
  });

  it("never mints an id already used by an existing store workbook, even on an exact id collision", () => {
    useApp.setState({
      workbooks: [{ id: "shared-id", name: "destination's own book" }],
    });
    const wb: WorkbookNode = { id: "shared-id", name: "incoming book" }; // collides with the store's
    const sheet = { id: "s1", name: "sheet", data: raw, workbookId: "shared-id" };

    useApp.getState().appendWorkspace(asLoaded([sheet], [wb]));

    const s = useApp.getState();
    expect(s.workbooks).toHaveLength(2);
    const ids = s.workbooks.map((w) => w.id);
    expect(new Set(ids).size).toBe(2); // both distinct — no collision survived
    expect(ids).toContain("shared-id"); // the destination's own workbook, untouched
  });

  it("existing dataset-append behavior (rename, bgRef remap) is unchanged by workbook transfer", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "sample", data: raw }], activeId: "d1" });

    const data = { id: "data", name: "sample", data: raw, bgRef: { datasetId: "bg", interp: "pchip" } };
    const bg = { id: "bg", name: "background", data: raw };

    useApp.getState().appendWorkspace(asLoaded([data, bg])); // no workbooks in this batch

    const s = useApp.getState();
    expect(s.datasets).toHaveLength(3);
    const dataDs = s.datasets.find((d) => d.name === "sample (2)"); // name collision suffixed
    const bgDs = s.datasets.find((d) => d.name === "background");
    expect(dataDs).toBeDefined();
    expect(bgDs).toBeDefined();
    expect(dataDs!.bgRef?.datasetId).toBe(bgDs!.id); // bgRef remap still works
    expect(s.workbooks).toEqual([]); // no workbooks referenced -> none transferred
    expect(s.status).toBe("appended 2 datasets (1 renamed)"); // no workbook note appended
  });

  it("a workspace with no transferable workbooks appends datasets without touching the status/toast workbook note", () => {
    const d = { id: "n1", name: "new", data: raw }; // no workbookId
    useApp.getState().appendWorkspace(asLoaded([d]));
    expect(useApp.getState().status).toBe("appended 1 dataset (0 renamed)");
    expect(useApp.getState().workbooks).toEqual([]);
  });
});
