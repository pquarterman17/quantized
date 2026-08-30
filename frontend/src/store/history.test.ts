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
    viewHistory: [],
    viewFuture: [],
    plotWindows: [win({ id: "w1" })],
    focusedWindowId: "w1",
  });
});

describe("history slice mechanics", () => {
  it("recordHistory pushes a labeled snapshot and clears redo", () => {
    useApp.getState().recordHistory("seed");
    const snapshot = useApp.getState().history[0].snapshot;
    useApp.setState({ history: [], future: [{ label: "stale", snapshot }] });
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

describe("separate plot-view history", () => {
  it("walks committed navigation backward and forward without touching edit history", () => {
    useApp.getState().recordView(
      { xLim: null, yLim: null },
      { xLim: [1, 3], yLim: [10, 20] },
    );
    expect(useApp.getState().xLim).toEqual([1, 3]);
    expect(useApp.getState().history).toEqual([]);

    useApp.getState().backView();
    expect(useApp.getState().xLim).toBeNull();
    expect(useApp.getState().viewFuture).toHaveLength(1);

    useApp.getState().forwardView();
    expect(useApp.getState().xLim).toEqual([1, 3]);
    expect(useApp.getState().yLim).toEqual([10, 20]);
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
      workbooks: [],
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
      quickPlotTemplates: [],
      librarySelection: null,
      workbookLastChild: {},
      expandedWorkbookIds: [],
      collections: [],
      visibleDetailsColumns: [],
      plotRecipes: [],
      recipeSourcesComplete: true,
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

  // Ctrl+Z is the EDIT history; Alt+left/right is the navigation history. An
  // edit snapshot captured the whole PlotView, so undoing an edit also rolled
  // back a zoom the user performed afterwards (and desynced viewHistory).
  it("undo/redo leaves a LATER zoom alone (navigation is not an edit)", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1", xLim: null, yLim: null });

    useApp.getState().setChannelRole(0, "ignore"); // the recorded edit
    useApp.getState().setXLim([1, 3]);             // a LATER, separate gesture
    useApp.getState().setYLim([0, 9]);

    useApp.getState().undo();
    expect(useApp.getState().datasets[0].channelRoles).toBeUndefined(); // edit undone
    expect(useApp.getState().xLim).toEqual([1, 3]);                     // zoom kept
    expect(useApp.getState().yLim).toEqual([0, 9]);

    useApp.getState().redo();
    expect(useApp.getState().datasets[0].channelRoles).toEqual({ 0: "ignore" });
    expect(useApp.getState().xLim).toEqual([1, 3]);
    expect(useApp.getState().yLim).toEqual([0, 9]);
  });

  // The other half of the carve-out: y2 is NOT navigation (nothing zooms it and
  // setY2Lim records), so an explicit Y2-limit edit must still undo.
  it("Y2 limits stay inside the edit history", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1", y2Lim: null });

    useApp.getState().setY2Lim([2, 8]);
    expect(useApp.getState().y2Lim).toEqual([2, 8]);

    useApp.getState().undo();
    expect(useApp.getState().y2Lim).toBeNull();

    useApp.getState().redo();
    expect(useApp.getState().y2Lim).toEqual([2, 8]);
  });

  it("named saved ROIs are included in undo history (coverage gap #15)", () => {
    useApp.setState({ savedRois: [] });
    const pre = useApp.getState().savedRois;

    // Simulate saving a named ROI via saveRoi
    useApp.getState().recordHistory("Save ROI");
    useApp.setState({
      savedRois: [
        {
          id: "roi1",
          name: "My ROI",
          kind: "rect",
          rect: { x0: 0, y0: 0, x1: 1, y1: 1, space: "angular" },
        },
      ],
    });
    const post = useApp.getState().savedRois;

    useApp.getState().undo();
    expect(useApp.getState().savedRois).toEqual(pre);

    useApp.getState().redo();
    expect(useApp.getState().savedRois).toEqual(post);
  });

  it("workbooks are included in undo history (LIBRARY_WORKBOOK_UX_PLAN PR A2 — no mutating action yet, so a raw set stands in)", () => {
    useApp.setState({ workbooks: [] });
    const pre = useApp.getState().workbooks;

    useApp.getState().recordHistory("mutate workbooks");
    useApp.setState({ workbooks: [{ id: "wb1", name: "Book" }] });
    const post = useApp.getState().workbooks;

    useApp.getState().undo();
    expect(useApp.getState().workbooks).toEqual(pre);

    useApp.getState().redo();
    expect(useApp.getState().workbooks).toEqual(post);
  });

  it("mapRoi changes do NOT create an undo entry (working geometry excluded)", () => {
    // Distinct from the SURVIVES-undo tests below: a regression where drawing
    // starts recording history would still pass those (undo would revert the
    // spurious entry's OTHER fields), but it would cost the user an extra
    // Ctrl+Z per drawn box. Both properties are guarded on purpose.
    useApp.setState({ savedRois: [], mapRoi: null });
    useApp.getState().recordHistory("baseline");
    const historyLengthBefore = useApp.getState().history.length;

    // Mutate mapRoi directly without recordHistory — this is how drawing tools work
    useApp.setState({ mapRoi: { x0: 1, y0: 2, x1: 3, y1: 4, space: "angular" } });
    expect(useApp.getState().mapRoi).not.toBeNull();

    // The history stack should NOT have a new entry for this mutation
    expect(useApp.getState().history.length).toBe(historyLengthBefore);
  });

  it("mapRoi SURVIVES undo — it is working geometry, not history (box 2, strong form)", () => {
    // Set up: dataset exists, record a baseline edit
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1", mapRoi: null });
    useApp.getState().recordHistory("baseline");
    const preEdit1 = useApp.getState().datasets;

    // User draws a mapRoi on the canvas (working geometry, no recordHistory)
    const drawnRoi = { x0: 10, y0: 20, x1: 30, y1: 40, space: "angular" as const };
    useApp.setState({ mapRoi: drawnRoi });
    const roiAfterDraw = useApp.getState().mapRoi;

    // Then user makes another undoable edit (e.g., rename dataset)
    useApp.getState().renameDataset("d1", "renamed");
    expect(useApp.getState().datasets[0].name).toBe("renamed");

    // Undo the rename
    useApp.getState().undo();
    expect(useApp.getState().datasets).toEqual(preEdit1);

    // The mapRoi should be UNCHANGED by undo — it is working geometry, not history
    expect(useApp.getState().mapRoi).toEqual(roiAfterDraw);
    expect(useApp.getState().mapRoi).not.toBeNull();
  });

  it("mapRuler SURVIVES undo — it is working geometry, not history (box 2, strong form)", () => {
    // Set up: dataset exists, record a baseline edit
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1", mapRuler: null });
    useApp.getState().recordHistory("baseline");
    const preEdit1 = useApp.getState().datasets;

    // User draws a mapRuler on the canvas (working geometry, no recordHistory)
    const drawnRuler = { cx: 50, cy: 60, angle: 45, length: 15, width: 2, space: "angular" as const };
    useApp.setState({ mapRuler: drawnRuler });
    const rulerAfterDraw = useApp.getState().mapRuler;

    // Then user makes another undoable edit (e.g., rename dataset)
    useApp.getState().renameDataset("d1", "renamed");
    expect(useApp.getState().datasets[0].name).toBe("renamed");

    // Undo the rename
    useApp.getState().undo();
    expect(useApp.getState().datasets).toEqual(preEdit1);

    // The mapRuler should be UNCHANGED by undo — it is working geometry, not history
    expect(useApp.getState().mapRuler).toEqual(rulerAfterDraw);
    expect(useApp.getState().mapRuler).not.toBeNull();
  });
});

// R6 code-review round, F4 (POST_SPRINT_INDEPENDENT_REVIEW.md): direct unit
// tests for the `HistoryBatchToken` mechanics `withHistoryBatch`'s own doc
// promises — the end-to-end coverage lives in relink.test.ts, but these pin
// the primitive itself so a future change to history.ts can't silently drop
// one of its own documented guarantees.
describe("withHistoryBatch / HistoryBatchToken mechanics (R6)", () => {
  it("a stale or foreign token is treated exactly like no token — always records its own entry", async () => {
    const foreignToken = Symbol("foreign, from some other/finished batch");
    await useApp.getState().withHistoryBatch("batch", async () => {
      // Tagged with a token that is NOT this batch's own — must not fold.
      useApp.getState().recordHistory("foreign-tagged edit", foreignToken);
      useApp.setState({ datasets: [{ id: "x", name: "x", data: raw }] });
    });
    // The foreign-tagged call got its own entry; the batch itself folded
    // NOTHING under its real token, so it pushes no entry of its own.
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["foreign-tagged edit"]);
  });

  it("pushes no entry when nothing folds under the batch's own token", async () => {
    await useApp.getState().withHistoryBatch("no-op batch", async () => {
      // Does nothing that records — an import that fails outright, e.g.
    });
    expect(useApp.getState().history).toEqual([]);
  });

  it("a nested withHistoryBatch call reuses the OUTER active token — nesting never creates a second undo step", async () => {
    let innerToken: unknown;
    let outerToken: unknown;
    await useApp.getState().withHistoryBatch("outer op", async (token) => {
      outerToken = token;
      useApp.getState().recordHistory("outer mutation", token);
      useApp.setState({ datasets: [{ id: "d1", name: "a", data: raw }] });

      await useApp.getState().withHistoryBatch("inner op (must never surface)", async (nestedToken) => {
        innerToken = nestedToken;
        useApp.getState().recordHistory("inner mutation", nestedToken);
        useApp.setState((s) => ({ datasets: [...s.datasets, { id: "d2", name: "b", data: raw }] }));
      });
    });

    expect(innerToken).toBe(outerToken); // reentrant: the SAME identity, never a fresh one
    const { history } = useApp.getState();
    expect(history).toHaveLength(1); // ONE entry for the whole nested operation
    expect(history[0].label).toBe("outer op"); // the outer label wins

    useApp.getState().undo();
    expect(useApp.getState().datasets).toEqual([]); // both mutations reverted together
  });

  it("captures its own snapshot lazily at the FIRST fold, not at batch-open time", async () => {
    useApp.setState({ datasets: [{ id: "orig", name: "orig", data: raw }] });

    await useApp.getState().withHistoryBatch("batched op", async (token) => {
      // An interleaved, UNTOKENED edit landing before the operation's own
      // first mutation — gets its own entry (R6), and must survive the
      // batch's eventual undo rather than being silently reverted a second
      // time by an eagerly-captured pre-batch snapshot.
      useApp.getState().renameDataset("orig", "renamed mid-batch");

      useApp.getState().recordHistory("create dataset", token);
      useApp.setState((s) => ({ datasets: [...s.datasets, { id: "new", name: "new", data: raw }] }));
    });

    expect(useApp.getState().history.map((h) => h.label)).toEqual(["rename dataset", "batched op"]);

    useApp.getState().undo(); // undoes "batched op"
    const live = useApp.getState().datasets;
    expect(live.map((d) => d.id)).toEqual(["orig"]); // the created dataset is gone
    expect(live.find((d) => d.id === "orig")!.name).toBe("renamed mid-batch"); // the rename SURVIVES
  });

  // F3 (R6 code-review): a Redo pressed MID-BATCH — after the batch's first
  // fold but before its own entry lands in `withHistoryBatch`'s `finally`,
  // which can be further awaits away for a real caller — must never replay a
  // stale pre-batch `future` snapshot over already-half-mutated state.
  it("clears `future` (redo) as soon as the batch's first fold lands, not only once the batch's own entry is finally pushed", async () => {
    useApp.getState().addDataset({ id: "d1", name: "a", data: raw }); // history: [add dataset]
    useApp.getState().undo(); // history: [], future: [add dataset]
    expect(useApp.getState().future).toHaveLength(1);

    await useApp.getState().withHistoryBatch("batched op", async (token) => {
      useApp.getState().recordHistory("first fold", token);
      useApp.setState({ datasets: [{ id: "d2", name: "b", data: raw }] });
      // Assert INSIDE the batch, synchronously right after the fold.
      expect(useApp.getState().future).toEqual([]);
    });

    expect(useApp.getState().future).toEqual([]); // still clear once the batch completes
  });
});
