// Tests for MAIN_PLAN #9 (app-wide undo/redo). Two layers:
//  - slice mechanics: recordHistory/undo/redo, depth eviction, redo-cleared-
//    on-new-action, empty-stack no-op, restore guards (dangling window
//    binding + stale selection).
//  - per-action-class coverage: mutate -> undo -> matches pre-state ->
//    redo -> matches post-state, for one representative of each undoable
//    class named in the design (cell edit, dataset remove incl. activeId
//    handoff, rename, merge, corrections apply, formula add/remove, row
//    exclusion, channel role).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections as applyCorrectionsApi } from "../lib/api";
import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { DataStruct } from "../lib/types";
import type { LoadedWorkspace } from "../lib/workspace";
import { useApp } from "./useApp";

vi.mock("../lib/api", () => ({
  applyCorrections: vi.fn(),
  uploadFile: vi.fn(),
  fetchBookData: vi.fn(),
  guessImportSettings: vi.fn(),
  parseImportText: vi.fn(),
}));

const raw: DataStruct = {
  time: [1, 2, 3],
  values: [[10], [20], [30]],
  labels: ["m"],
  units: ["emu"],
  metadata: {},
};

const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "",
  datasetId: null,
  geometry: { x: 0, y: 0, w: 480, h: 360 },
  z: 0,
  winState: "maximized",
  view: defaultPlotView(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [],
    activeId: null,
    worksheetId: null,
    selectedIds: [],
    originFigures: [],
    originFidelity: [],
    reports: [],
    figureDocs: [],
    selection: null,
    history: [],
    future: [],
    plotWindows: [win({ id: "w1" })],
    focusedWindowId: "w1",
  });
});

describe("history slice mechanics", () => {
  it("recordHistory pushes a labeled snapshot and clears redo", () => {
    useApp.setState({ future: [{ label: "stale", snapshot: { datasets: [], activeId: null, selectedIds: [], worksheetId: null, originFigures: [], originFidelity: [], reports: [], figureDocs: [] } }] });
    useApp.getState().recordHistory("test action");
    const { history, future } = useApp.getState();
    expect(history).toHaveLength(1);
    expect(history[0].label).toBe("test action");
    expect(future).toEqual([]);
  });

  it("undo is a no-op on an empty stack", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "a", data: raw }] });
    useApp.getState().undo();
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().future).toEqual([]);
  });

  it("redo is a no-op on an empty stack", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "a", data: raw }] });
    useApp.getState().redo();
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().history).toEqual([]);
  });

  it("undo restores the pre-mutation snapshot; redo replays the mutation", () => {
    useApp.getState().addDataset({ id: "d1", name: "a", data: raw });
    expect(useApp.getState().datasets).toHaveLength(1);

    useApp.getState().undo();
    expect(useApp.getState().datasets).toHaveLength(0);
    expect(useApp.getState().future).toHaveLength(1);

    useApp.getState().redo();
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().datasets[0].id).toBe("d1");
    expect(useApp.getState().future).toHaveLength(0);
  });

  it("a new recorded action clears whatever was sitting in redo", () => {
    useApp.getState().addDataset({ id: "d1", name: "a", data: raw });
    useApp.getState().undo();
    expect(useApp.getState().future).toHaveLength(1);

    useApp.getState().addDataset({ id: "d2", name: "b", data: raw });
    expect(useApp.getState().future).toHaveLength(0);
  });

  it("depth bound eviction: the stack caps at 50, oldest evicted first", () => {
    for (let i = 0; i < 55; i++) {
      useApp.getState().recordHistory(`action ${i}`);
    }
    const { history } = useApp.getState();
    expect(history).toHaveLength(50);
    expect(history[0].label).toBe("action 5"); // actions 0-4 evicted
    expect(history[49].label).toBe("action 54");
  });

  it("restore guard: nulls a window's dataset binding left dangling by undo", () => {
    // d1 pre-exists; addDataset(d2) rebinds the focused window to d2 as a
    // side effect (retargetPassiveRebind/datasetViewDefaults) — that side
    // effect is NOT part of the undo snapshot (view/window state is
    // deliberately excluded), so undoing the add must not leave the window
    // pointing at a dataset that no longer exists.
    useApp.setState({ datasets: [{ id: "d1", name: "a", data: raw }], activeId: "d1" });
    useApp.getState().addDataset({ id: "d2", name: "b", data: raw });
    expect(useApp.getState().plotWindows[0].datasetId).toBe("d2");

    useApp.getState().undo();

    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["d1"]);
    expect(useApp.getState().plotWindows[0].datasetId).toBeNull();
  });

  it("restore guard: drops a row selection that no longer names a live dataset", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "a", data: raw }], activeId: "d1" });
    useApp.getState().addDataset({ id: "d2", name: "b", data: raw });
    useApp.setState({ selection: { datasetId: "d2", rows: [0, 1] } });

    useApp.getState().undo();

    expect(useApp.getState().selection).toBeNull();
  });
});

describe("history keyboard guard (focus in an editable field)", () => {
  // The actual keydown listener lives in components/history/useHistoryCommands
  // (tested there); this just documents the shared isEditing contract the
  // slice's own no-op semantics make safe to pair with — a guarded caller
  // that skips dispatch on a text field never touches the store at all.
  it("undo/redo remain simple store actions with no DOM awareness", () => {
    expect(typeof useApp.getState().undo).toBe("function");
    expect(typeof useApp.getState().redo).toBe("function");
  });
});

describe("per-action-class undo/redo coverage", () => {
  it("cell edit (setCellValue)", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1" });
    const pre = useApp.getState().datasets;

    useApp.getState().setCellValue("d1", 1, 0, 99);
    const post = useApp.getState().datasets;
    expect(post[0].data.values[1][0]).toBe(99);

    useApp.getState().undo();
    expect(useApp.getState().datasets).toEqual(pre);

    useApp.getState().redo();
    expect(useApp.getState().datasets).toEqual(post);
  });

  it("dataset remove, including activeId handoff to the next survivor", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: raw },
      ],
      activeId: "d1",
    });
    const preDatasets = useApp.getState().datasets;

    useApp.getState().removeDataset("d1");
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["d2"]);
    expect(useApp.getState().activeId).toBe("d2"); // handed off to the survivor
    const postDatasets = useApp.getState().datasets;
    const postActiveId = useApp.getState().activeId;

    useApp.getState().undo();
    expect(useApp.getState().datasets).toEqual(preDatasets);
    expect(useApp.getState().activeId).toBe("d1"); // restored

    useApp.getState().redo();
    expect(useApp.getState().datasets).toEqual(postDatasets);
    expect(useApp.getState().activeId).toBe(postActiveId);
  });

  it("rename (renameDataset)", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "old", data: raw }], activeId: "d1" });
    const pre = useApp.getState().datasets;

    useApp.getState().renameDataset("d1", "new name");
    expect(useApp.getState().datasets[0].name).toBe("new name");
    const post = useApp.getState().datasets;

    useApp.getState().undo();
    expect(useApp.getState().datasets).toEqual(pre);

    useApp.getState().redo();
    expect(useApp.getState().datasets).toEqual(post);
  });

  it("merge (mergeSelected)", async () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: raw },
      ],
      selectedIds: ["d1", "d2"],
      activeId: "d1",
    });
    const pre = useApp.getState().datasets;

    await useApp.getState().mergeSelected();
    expect(useApp.getState().datasets).toHaveLength(3); // a, b, + the merged result
    const post = useApp.getState().datasets;

    useApp.getState().undo();
    expect(useApp.getState().datasets).toEqual(pre);

    useApp.getState().redo();
    expect(useApp.getState().datasets).toEqual(post);
  });

  it("append workspace (appendWorkspace, MAIN_PLAN #16)", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "a", data: raw }],
      activeId: "d1",
    });
    const pre = useApp.getState().datasets;
    const incoming: LoadedWorkspace = {
      datasets: [{ id: "d2", name: "b", data: raw }],
      folders: [],
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
      plotWindows: [],
      focusedWindowId: null,
    };

    useApp.getState().appendWorkspace(incoming);
    expect(useApp.getState().datasets).toHaveLength(2); // a, + the appended b
    const post = useApp.getState().datasets;

    useApp.getState().undo();
    expect(useApp.getState().datasets).toEqual(pre);
    expect(useApp.getState().activeId).toBe("d1"); // untouched by the append, restored by undo

    useApp.getState().redo();
    expect(useApp.getState().datasets).toEqual(post);
  });

  it("corrections apply (applyCorrections)", async () => {
    const corrected: DataStruct = { ...raw, values: [[5], [15], [25]] };
    vi.mocked(applyCorrectionsApi).mockResolvedValue(corrected);
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1" });
    const pre = useApp.getState().datasets;

    await useApp.getState().applyCorrections("d1", { yOff: 5 });
    expect(useApp.getState().datasets[0].data).toEqual(corrected);
    const post = useApp.getState().datasets;

    useApp.getState().undo();
    expect(useApp.getState().datasets).toEqual(pre);

    useApp.getState().redo();
    expect(useApp.getState().datasets).toEqual(post);
  });

  it("formula add/remove (addFormula, removeFormula)", () => {
    const twoCol: DataStruct = {
      time: [1, 2],
      values: [
        [10, 20],
        [30, 40],
      ],
      labels: ["A", "B"],
      units: ["u", "v"],
      metadata: {},
    };
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: twoCol }], activeId: "d1" });
    const preAdd = useApp.getState().datasets;

    useApp.getState().addFormula("d1", "S", "A + B");
    expect(useApp.getState().datasets[0].data.labels).toEqual(["A", "B", "S"]);
    const postAdd = useApp.getState().datasets;

    useApp.getState().undo();
    expect(useApp.getState().datasets).toEqual(preAdd);

    useApp.getState().redo();
    expect(useApp.getState().datasets).toEqual(postAdd);

    // removeFormula, chained on top of the (redone) add.
    const preRemove = useApp.getState().datasets;
    useApp.getState().removeFormula("d1", 0);
    expect(useApp.getState().datasets[0].data.labels).toEqual(["A", "B"]);
    const postRemove = useApp.getState().datasets;

    useApp.getState().undo();
    expect(useApp.getState().datasets).toEqual(preRemove);

    useApp.getState().redo();
    expect(useApp.getState().datasets).toEqual(postRemove);
  });

  it("row exclusion (toggleRowExcluded)", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1" });
    const pre = useApp.getState().datasets;

    useApp.getState().toggleRowExcluded("d1", 1);
    expect(useApp.getState().datasets[0].excludedRows).toEqual([1]);
    const post = useApp.getState().datasets;

    useApp.getState().undo();
    expect(useApp.getState().datasets).toEqual(pre);

    useApp.getState().redo();
    expect(useApp.getState().datasets).toEqual(post);
  });

  it("channel role (setChannelRole)", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1" });
    const pre = useApp.getState().datasets;

    useApp.getState().setChannelRole(0, "ignore");
    expect(useApp.getState().datasets[0].channelRoles).toEqual({ 0: "ignore" });
    const post = useApp.getState().datasets;

    useApp.getState().undo();
    expect(useApp.getState().datasets).toEqual(pre);

    useApp.getState().redo();
    expect(useApp.getState().datasets).toEqual(post);
  });
});
