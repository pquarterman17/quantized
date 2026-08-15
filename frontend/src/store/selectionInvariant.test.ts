// L0.25 selection mutual exclusion, enforced per WRITER (retrospective-audit
// fix): `librarySelection` (the tree's folder/workbook/artifact current item)
// and a non-empty dataset selection must never both be live — the store-level
// chokepoint claim ("shared by every activation path") was FALSE for six
// writers, all of which could leave a folder selected in the tree while a
// dataset selection/activation was also current. Each case seeds a live
// folder selection, performs one writer action, and asserts the invariant.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "./useApp";
import type { Dataset } from "../lib/types";

vi.mock("../components/overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const ds = (id: string, workbookId?: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
  ...(workbookId ? { workbookId } : {}),
});

function invariantHolds(): boolean {
  const s = useApp.getState();
  return !(s.librarySelection != null && s.selectedIds.length > 0);
}

beforeEach(() => {
  useApp.setState({
    folders: [{ id: "f1", name: "F", parentId: null, order: 0 }],
    workbooks: [{ id: "w1", name: "W" }],
    datasets: [ds("d1", "w1"), ds("d2", "w1")],
    activeId: "d1",
    selectedIds: [],
    librarySelection: { kind: "folder", id: "f1" }, // the seeded tree selection
    expandedWorkbookIds: [],
    workbookLastChild: {},
    trash: [],
    history: [],
    future: [],
    confirmRemove: false,
  });
});

describe("selection mutual exclusion — every writer that establishes a dataset selection clears librarySelection", () => {
  it("addDataset (every import path funnels here)", () => {
    useApp.getState().addDataset(ds("fresh"));
    expect(useApp.getState().selectedIds).toEqual(["fresh"]);
    expect(useApp.getState().librarySelection).toBeNull();
    expect(invariantHolds()).toBe(true);
  });

  it("duplicateDataset (palette command + row ⧉ button bypass row-click selection)", async () => {
    await useApp.getState().duplicateDataset("d1");
    expect(useApp.getState().selectedIds).toHaveLength(1);
    expect(useApp.getState().librarySelection).toBeNull();
    expect(invariantHolds()).toBe(true);
  });

  it("splitDatasetByColumn (context-menu split acts on any row, selected or not)", () => {
    useApp.getState().splitDatasetByColumn("d1", 0);
    expect(invariantHolds()).toBe(true);
  });

  it("focusWindow / the shared _focusHandoff tail (close/minimize/restore included)", () => {
    const winId = useApp.getState().plotWindows[0]?.id;
    if (winId == null) throw new Error("fixture: expected a main window");
    // Focusing the ALREADY-focused window is a documented no-op — displace
    // focus first so the handoff tail actually runs.
    useApp.setState({ focusedWindowId: "elsewhere" });
    useApp.getState().focusWindow(winId);
    expect(useApp.getState().focusedWindowId).toBe(winId); // the handoff ran
    expect(useApp.getState().librarySelection).toBeNull();
    expect(invariantHolds()).toBe(true);
  });

  it("loadWorkspace resets the previous project's tree selection (and workbook disclosure) outright", () => {
    useApp.getState().loadWorkspace({
      datasets: [ds("other")],
      folders: [],
      activeId: "other",
      selectedIds: ["other"],
      expandedFolders: [],
      originFigures: [],
    } as never);
    const s = useApp.getState();
    expect(s.librarySelection).toBeNull();
    expect(s.expandedWorkbookIds).toEqual([]);
    expect(s.workbookLastChild).toEqual({});
    expect(invariantHolds()).toBe(true);
  });

  it("restoreFromTrash yields the tree selection only when the restore IS an activation", () => {
    useApp.getState().removeDatasets(["d1", "d2"]);
    useApp.setState({ activeId: null, selectedIds: [], librarySelection: { kind: "folder", id: "f1" } });
    useApp.getState().restoreFromTrash("d1"); // activates: activeId was null
    expect(useApp.getState().activeId).toBe("d1");
    expect(useApp.getState().librarySelection).toBeNull();

    // The non-activation restore leaves the selection alone.
    useApp.setState({ librarySelection: { kind: "folder", id: "f1" }, selectedIds: [] });
    useApp.getState().restoreFromTrash("d2"); // activeId already "d1"
    expect(useApp.getState().librarySelection).toEqual({ kind: "folder", id: "f1" });
    expect(invariantHolds()).toBe(true); // selectedIds untouched by restore
  });

  it("the documented chokepoints still hold (regression net for the writers fixed earlier)", () => {
    useApp.getState().selectIds(["d1"]);
    expect(invariantHolds()).toBe(true);
    useApp.setState({ librarySelection: { kind: "folder", id: "f1" }, selectedIds: [] });
    useApp.getState().toggleSelected("d1");
    expect(invariantHolds()).toBe(true);
    useApp.setState({ librarySelection: { kind: "folder", id: "f1" }, selectedIds: [] });
    useApp.getState().activateFromLibrary("d2");
    expect(invariantHolds()).toBe(true);
  });
});
