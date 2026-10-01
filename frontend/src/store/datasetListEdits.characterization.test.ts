// Characterization tests for the DATASET-LIST EDITS domain (audit P4.1, the
// SEVENTH store/useApp.ts domain): removing (one / the selection / an id
// list, to Trash or permanently), merging the selection, duplicating,
// reordering and renaming datasets, the folder tree (create / rename / delete
// / move / move-a-dataset / expand) and the smart folders (add / edit /
// remove) — 16 actions over `datasets` plus the three folder collections.
//
// Unlike the sixth domain (workshop flags), these DO write `datasets` and DO
// record undo history, so each spec pins three things through the REAL
// composed store:
//  1. the EXACT set of top-level keys the call changes — a whole-getState()
//     identity diff against a POISONED baseline (view/gadget/selection fields
//     seeded to non-defaults, so a write that "resets" one to its default
//     still shows up);
//  2. the undo label it pushes (or that it pushes none), and that one undo
//     restores the pre-call value of every touched undoable field BY
//     IDENTITY, and one redo restores the post-call value the same way;
//  3. side channels: no toast fires, no macro step records (the recorder is
//     armed), the Trash receives exactly what it should, and the Reshape &
//     combine dialog store is the only thing `mergeSelected` touches.
// Interactions with selection/windows are pinned on the paths that hit them:
// removing the active, selected, worksheet-shown, window-bound dataset.
//
// Written and run GREEN against the pre-extraction useApp.ts; it imports the
// store only through `./useApp` (plus three modules that do not move), so
// nothing here may change when the domain moves out.

import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset, DataStruct, FolderNode } from "../lib/types";
import { useToasts } from "./toasts";
import { useTransformPreviewDialog } from "./transformPreviewDialog";
import { useApp, type AppState } from "./useApp";
import { mainWindow } from "./windows";

type Snap = Record<string, unknown>;

const data = (n = 1): DataStruct => ({
  time: [1, 2, 3],
  values: [[10 * n, 20 * n, 30 * n]],
  labels: ["a"],
  units: ["V"],
  metadata: {},
});

const ds = (id: string, over: Partial<Dataset> = {}): Dataset => ({ id, name: id, data: data(), ...over });

const folder = (id: string, parentId: string | null, order: number): FolderNode => ({ id, name: id, parentId, order });

const snapshot = (): Snap => ({ ...(useApp.getState() as unknown as Snap) });

/** Top-level store keys whose value changed identity, sorted. */
function changedSince(before: Snap): string[] {
  const after = useApp.getState() as unknown as Snap;
  return Object.keys(after)
    .filter((k) => after[k] !== before[k])
    .sort();
}

const act = (): AppState => useApp.getState();
const labels = (): string[] => act().history.map((h) => h.label);
const ids = (): string[] => act().datasets.map((d) => d.id);
const pick = (keys: (keyof AppState)[]): Snap =>
  Object.fromEntries(keys.map((k) => [k, act()[k]]));

/** One undo restores every `keys` field to its pre-call value (identity) and
 *  one redo restores the post-call value (identity). */
function expectUndoRedo(pre: Snap, keys: (keyof AppState)[]): void {
  const post = pick(keys);
  act().undo();
  for (const k of keys) expect(act()[k], `undo ${k}`).toBe(pre[k]);
  act().redo();
  for (const k of keys) expect(act()[k], `redo ${k}`).toBe(post[k]);
}

const WIN = mainWindow("d2");

// Every view/gadget field duplicateDataset resets, poisoned off its default.
const POISON_VIEW = {
  stageTab: "map",
  xKey: 0,
  yKeys: [0],
  groupKey: 0,
  facetKey: 0,
  y2Keys: [0],
  y2Lim: [0, 1],
  y2Scale: "log",
  y2Step: 1,
  y2AxisLabel: "Y2",
  seriesStyles: { 0: { color: "red" } },
  errKeys: { 0: 0 },
  hiddenChannels: [0],
  xLim: [0, 1],
  yLim: [0, 1],
  xStep: 1,
  yStep: 1,
  composition: { kind: "break", panels: [] },
  rsmPeaks: [],
  integral: { sentinel: true },
  fwhmResult: { sentinel: true },
  qfitRoi: [0, 1],
  qfitResult: { sentinel: true },
  qfitBusy: true,
  qfitError: "stale",
  gadgetBusy: true,
  gadgetError: "stale",
  gadgetIntegrateResult: { sentinel: true },
  gadgetStatsResult: { sentinel: true },
  gadgetDerivResult: { sentinel: true },
  gadgetFftPreview: { sentinel: true },
  gadgetCursors: [0, 1],
  gadgetCursorResult: { sentinel: true },
};

/** Fresh initial store, then a three-dataset library: d2 is active, selected,
 *  bound to the focused window and owns a map view; d3 is the worksheet
 *  override; d1 lives in folder f1 (f2 is f1's child). */
function seed(): void {
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({
    datasets: [ds("d1", { folderId: "f1" }), ds("d2"), ds("d3")],
    activeId: "d2",
    selectedIds: ["d2"],
    worksheetId: "d3",
    plotWindows: [WIN],
    focusedWindowId: WIN.id,
    mapViews: { d2: { sentinel: true } } as unknown as AppState["mapViews"],
    folders: [folder("f1", null, 0), folder("f2", "f1", 0), folder("f3", null, 1)],
    expandedFolders: ["f1", "f2"],
    smartFolders: [{ id: "sf1", name: "Tagged", query: "tag:a" }],
    librarySelection: { kind: "folder", id: "f1" },
    status: "sentinel-status",
    macroRecording: true,
    macroSteps: [],
    history: [],
    future: [],
    trash: [],
    ...(POISON_VIEW as unknown as Partial<AppState>),
  });
  useTransformPreviewDialog.setState({ op: null, seed: [], opened: 0 });
}

let toastsBefore: unknown;
beforeEach(() => {
  seed();
  toastsBefore = useToasts.getState().toasts;
});

/** No action in this domain toasts or records a macro step. */
function expectNoSideNotices(): void {
  expect(useToasts.getState().toasts, "no toast").toBe(toastsBefore);
  expect(act().macroSteps, "no macro step").toEqual([]);
  expect(act().status, "status untouched").toBe("sentinel-status");
}

const REMOVAL_KEYS = [
  "activeId",
  "datasets",
  "editableFigures",
  "figureDocs",
  "future",
  "history",
  "mapViews",
  "originFidelity",
  "originFigures",
  "plotWindows",
  "reports",
  "selectedIds",
  "trash",
];

describe("initial state (moves with the slice)", () => {
  it("the folder collections start empty", () => {
    const init = useApp.getInitialState();
    expect(init.folders).toEqual([]);
    expect(init.expandedFolders).toEqual([]);
    expect(init.smartFolders).toEqual([]);
    expect(init.datasets).toEqual([]);
  });
});

describe("removeDataset / removeDatasets / removeSelected", () => {
  it("removeDataset on the ACTIVE, window-bound dataset: prunes refs, reselects the first survivor, one undo entry", () => {
    const pre = pick(["datasets", "activeId", "selectedIds", "plotWindows", "mapViews"]);
    const before = snapshot();
    act().removeDataset("d2");
    expect(changedSince(before)).toEqual(REMOVAL_KEYS);
    expect(ids()).toEqual(["d1", "d3"]);
    expect(act().activeId).toBe("d1");
    expect(act().selectedIds).toEqual([]);
    expect(act().worksheetId).toBe("d3");
    expect(act().plotWindows[0].datasetId).toBeNull();
    expect(act().mapViews).toEqual({});
    expect(act().trash.map((e) => (e.kind === "dataset" ? e.dataset.id : e.kind))).toEqual(["d2"]);
    expect(labels()).toEqual(["remove datasets"]);
    expectNoSideNotices();
    expectUndoRedo(pre, ["datasets", "activeId", "selectedIds", "mapViews"]);
  });

  it("removing the worksheet-shown dataset nulls worksheetId (the active one stays)", () => {
    const before = snapshot();
    act().removeDatasets(["d3"]);
    expect(changedSince(before)).toEqual(
      ["datasets", "editableFigures", "figureDocs", "future", "history", "originFidelity", "originFigures", "plotWindows", "reports", "selectedIds", "trash", "worksheetId"],
    );
    expect(act().activeId).toBe("d2");
    expect(act().worksheetId).toBeNull();
    expect(act().selectedIds).toEqual(["d2"]);
  });

  it("removeDatasets with an unknown id still records the undo step and rebuilds the arrays", () => {
    const before = snapshot();
    act().removeDatasets(["nope"]);
    expect(changedSince(before)).toEqual(
      ["datasets", "editableFigures", "figureDocs", "future", "history", "originFidelity", "originFigures", "plotWindows", "reports", "selectedIds"],
    );
    expect(ids()).toEqual(["d1", "d2", "d3"]);
    expect(act().trash).toEqual([]);
    expect(labels()).toEqual(["remove datasets"]);
  });

  it("removeDatasets(ids, {permanent}) records NO undo step, sends nothing to Trash, and scrubs history/trash", () => {
    act().renameDataset("d2", "renamed"); // an older snapshot that still holds d2
    useApp.setState({ trash: [{ kind: "dataset", at: 1, bytes: 1, dataset: ds("d2") }] });
    const histLen = act().history.length;
    const before = snapshot();
    act().removeDatasets(["d2"], { permanent: true });
    expect(changedSince(before)).toEqual(REMOVAL_KEYS);
    expect(act().history).toHaveLength(histLen);
    expect(act().history[0].snapshot.datasets.map((d) => d.id)).toEqual(["d1", "d3"]);
    expect(act().trash).toEqual([]);
    expectNoSideNotices();
  });

  it("removeSelected removes every selected dataset, then reselects the surviving active one", () => {
    useApp.setState({ selectedIds: ["d2", "d3"] });
    const pre = pick(["datasets", "activeId", "selectedIds", "worksheetId"]);
    const before = snapshot();
    act().removeSelected();
    expect(changedSince(before)).toEqual([...REMOVAL_KEYS, "worksheetId"].sort());
    expect(ids()).toEqual(["d1"]);
    expect(act().activeId).toBe("d1");
    expect(act().selectedIds).toEqual(["d1"]);
    expect(labels()).toEqual(["remove datasets"]);
    expectNoSideNotices();
    expectUndoRedo(pre, ["datasets", "activeId", "worksheetId"]);
  });

  it("removeSelected with no selection falls back to the active dataset", () => {
    useApp.setState({ selectedIds: [] });
    const before = snapshot();
    act().removeSelected();
    expect(changedSince(before)).toEqual(REMOVAL_KEYS);
    expect(act().worksheetId, "a surviving worksheet override stays").toBe("d3");
    expect(ids()).toEqual(["d1", "d3"]);
    expect(act().activeId).toBe("d1");
    expect(act().selectedIds).toEqual(["d1"]);
  });

  it("removeSelected with neither a selection nor an active dataset: no diff at all", () => {
    useApp.setState({ selectedIds: [], activeId: null });
    const before = snapshot();
    act().removeSelected();
    expect(changedSince(before)).toEqual([]);
  });

  it("removeSelected that empties the library leaves no active and an empty selection", () => {
    useApp.setState({ selectedIds: ["d1", "d2", "d3"] });
    act().removeSelected();
    expect(ids()).toEqual([]);
    expect(act().activeId).toBeNull();
    expect(act().selectedIds).toEqual([]);
  });
});

describe("mergeSelected", () => {
  it("opens the Reshape & combine append on the live selection and writes NOTHING to the app store", async () => {
    useApp.setState({ selectedIds: ["d3", "gone", "d1"] });
    const before = snapshot();
    await act().mergeSelected();
    expect(changedSince(before)).toEqual([]);
    const dlg = useTransformPreviewDialog.getState();
    expect(dlg.op).toBe("merge");
    expect(dlg.seed).toEqual(["d3", "d1"]);
    expect(dlg.opened).toBe(1);
    expectNoSideNotices();
  });

  it("with nothing selected, seeds the active dataset", async () => {
    useApp.setState({ selectedIds: [] });
    await act().mergeSelected();
    expect(useTransformPreviewDialog.getState().seed).toEqual(["d2"]);
  });
});

describe("duplicateDataset", () => {
  it("inserts a deep copy after the source, makes it active, resets the per-dataset view; one undo entry", async () => {
    useApp.setState({
      datasets: [
        ds("d1"),
        ds("d2", {
          tags: ["a"],
          notes: "n",
          group: "g",
          channelRoles: { 0: "label" },
          errorRoles: [],
          raw: data(2),
        }),
        ds("d3"),
      ],
    });
    const pre = pick(["datasets", "activeId", "selectedIds", "worksheetId", "xKey", "stageTab"]);
    const before = snapshot();
    await act().duplicateDataset("d2");
    expect(changedSince(before)).toEqual(
      [
        "activeId", "composition", "datasets", "errKeys", "facetKey", "future", "fwhmResult",
        "gadgetBusy", "gadgetCursorResult", "gadgetCursors", "gadgetDerivResult", "gadgetError",
        "gadgetFftPreview", "gadgetIntegrateResult", "gadgetStatsResult", "groupKey", "hiddenChannels",
        "history", "integral", "librarySelection", "qfitBusy", "qfitError", "qfitResult", "qfitRoi",
        "rsmPeaks", "selectedIds", "seriesStyles", "stageTab", "worksheetId", "xKey", "xLim", "xStep",
        "y2AxisLabel", "y2Keys", "y2Lim", "y2Scale", "y2Step", "yKeys", "yLim", "yStep",
      ],
    );
    const s = act();
    const src = s.datasets[1];
    const clone = s.datasets[2];
    expect(s.datasets.map((d) => d.id)).toEqual(["d1", "d2", clone.id, "d3"]);
    expect(clone.id).toMatch(/^ds-/);
    expect(clone.name).toBe("d2 (copy)");
    expect(clone.data).toEqual(src.data);
    expect(clone.data).not.toBe(src.data);
    expect(clone.raw).toEqual(src.raw);
    expect(clone.raw).not.toBe(src.raw);
    expect(clone.tags).toEqual(["a"]);
    expect(clone.tags).not.toBe(src.tags);
    expect(clone.notes).toBe("n");
    expect(clone.group).toBe("g");
    expect(clone.channelRoles).toEqual(src.channelRoles);
    expect(clone.errorRoles).toEqual([]);
    expect(clone.folderId).toBeUndefined();
    expect(s.activeId).toBe(clone.id);
    expect(s.selectedIds).toEqual([clone.id]);
    expect(s.worksheetId).toBeNull();
    expect(s.librarySelection).toBeNull();
    expect(s.stageTab).toBe("plot");
    expect(s.xKey).toBeNull();
    expect(s.y2AxisLabel).toBe("");
    expect(s.seriesStyles).toEqual({});
    expect(s.qfitBusy).toBe(false);
    expect(labels()).toEqual(["duplicate dataset"]);
    expectNoSideNotices();
    // xLim/yLim are navigation, outside the data undo stack (restorePatch's
    // navigationView) — so the view half is pinned through xKey only.
    expectUndoRedo(pre, ["datasets", "activeId", "selectedIds", "worksheetId", "xKey"]);
  });

  it("stays on the Worksheet tab when that is the current tab", async () => {
    useApp.setState({ stageTab: "worksheet" });
    await act().duplicateDataset("d1");
    expect(act().stageTab).toBe("worksheet");
  });

  it("an unknown id still pushes the undo entry but writes nothing else", async () => {
    const before = snapshot();
    await act().duplicateDataset("nope");
    expect(changedSince(before)).toEqual(["future", "history"]);
    expect(labels()).toEqual(["duplicate dataset"]);
  });
});

describe("moveDataset / renameDataset", () => {
  it("moveDataset swaps with the neighbour and writes ONLY datasets (+ history)", () => {
    const pre = pick(["datasets"]);
    const before = snapshot();
    act().moveDataset("d2", -1);
    expect(changedSince(before)).toEqual(["datasets", "future", "history"]);
    expect(ids()).toEqual(["d2", "d1", "d3"]);
    expect(act().activeId).toBe("d2");
    expect(labels()).toEqual(["reorder datasets"]);
    expectNoSideNotices();
    expectUndoRedo(pre, ["datasets"]);
  });

  it.each([
    ["d1", -1],
    ["d3", 1],
    ["nope", 1],
  ] as const)("moveDataset(%s, %s) at an end / unknown: the undo entry is still pushed, datasets untouched", (id, dir) => {
    const before = snapshot();
    act().moveDataset(id, dir);
    expect(changedSince(before)).toEqual(["future", "history"]);
    expect(labels()).toEqual(["reorder datasets"]);
  });

  it("renameDataset trims and writes ONLY datasets (+ history)", () => {
    const pre = pick(["datasets"]);
    const before = snapshot();
    act().renameDataset("d2", "  Sample A  ");
    expect(changedSince(before)).toEqual(["datasets", "future", "history"]);
    expect(act().datasets[1].name).toBe("Sample A");
    expect(act().datasets[0], "untouched rows keep their identity").toBe((before.datasets as Dataset[])[0]);
    expect(labels()).toEqual(["rename dataset"]);
    expectNoSideNotices();
    expectUndoRedo(pre, ["datasets"]);
  });

  it("renameDataset to blank keeps the old name (a new datasets array all the same)", () => {
    const before = snapshot();
    act().renameDataset("d2", "   ");
    expect(changedSince(before)).toEqual(["datasets", "future", "history"]);
    expect(act().datasets[1].name).toBe("d2");
  });
});

describe("folder tree", () => {
  it("createFolder appends under the parent, returns the new id, one undo entry", () => {
    const pre = pick(["folders"]);
    const before = snapshot();
    const id = act().createFolder("f1", "  Sub  ");
    expect(changedSince(before)).toEqual(["folders", "future", "history"]);
    expect(id).toMatch(/^fld-/);
    expect(act().folders.at(-1)).toEqual({ id, name: "Sub", parentId: "f1", order: expect.any(Number) });
    expect(labels()).toEqual(["create folder"]);
    expectNoSideNotices();
    expectUndoRedo(pre, ["folders"]);
  });

  it("createFolder defaults the name to \"New Folder\"", () => {
    const id = act().createFolder(null);
    expect(act().folders.find((f) => f.id === id)?.name).toBe("New Folder");
  });

  it("renameFolder writes folders (+ history); a blank name keeps the same array", () => {
    const pre = pick(["folders"]);
    let before = snapshot();
    act().renameFolder("f2", " Kids ");
    expect(changedSince(before)).toEqual(["folders", "future", "history"]);
    expect(act().folders.find((f) => f.id === "f2")?.name).toBe("Kids");
    expect(labels()).toEqual(["rename folder"]);
    expectUndoRedo(pre, ["folders"]);
    before = snapshot();
    act().renameFolder("f2", "  ");
    expect(changedSince(before)).toEqual(["future", "history"]);
  });

  it("deleteFolder (reparent) re-homes members, drops expanded ids, retargets the selection, sends a folder entry to Trash", () => {
    const pre = pick(["folders", "datasets", "expandedFolders"]);
    const before = snapshot();
    act().deleteFolder("f1");
    expect(changedSince(before)).toEqual(
      ["datasets", "expandedFolders", "folders", "future", "history", "librarySelection", "trash", "workbooks"],
    );
    expect(act().folders.map((f) => [f.id, f.parentId])).toEqual([["f2", null], ["f3", null]]);
    expect(act().datasets[0].folderId).toBeUndefined();
    expect(act().expandedFolders).toEqual(["f2"]);
    expect(act().librarySelection).toBeNull();
    expect(act().trash.map((e) => e.kind)).toEqual(["folder"]);
    expect(labels()).toEqual(["delete folder"]);
    expectNoSideNotices();
    expectUndoRedo(pre, ["folders", "datasets", "expandedFolders"]);
  });

  it("deleteFolder (cascade) removes the whole subtree", () => {
    act().deleteFolder("f1", "cascade");
    expect(act().folders.map((f) => f.id)).toEqual(["f3"]);
    expect(act().expandedFolders).toEqual([]);
  });

  it("deleteFolder on an unknown id: the undo entry only", () => {
    const before = snapshot();
    act().deleteFolder("nope");
    expect(changedSince(before)).toEqual(["future", "history"]);
    expect(labels()).toEqual(["delete folder"]);
  });

  it("moveFolder re-parents and writes ONLY folders (+ history); into its own subtree is refused", () => {
    const pre = pick(["folders"]);
    let before = snapshot();
    act().moveFolder("f3", "f1", "f2");
    expect(changedSince(before)).toEqual(["folders", "future", "history"]);
    expect(act().folders.find((f) => f.id === "f3")?.parentId).toBe("f1");
    expect(labels()).toEqual(["move folder"]);
    expectUndoRedo(pre, ["folders"]);
    before = snapshot();
    act().moveFolder("f1", "f2");
    expect(changedSince(before)).toEqual(["future", "history"]);
  });

  it("moveDatasetToFolder writes ONLY datasets (+ history)", () => {
    const pre = pick(["datasets"]);
    const before = snapshot();
    act().moveDatasetToFolder("d3", "f2");
    expect(changedSince(before)).toEqual(["datasets", "future", "history"]);
    expect(act().datasets.find((d) => d.id === "d3")?.folderId).toBe("f2");
    expect(labels()).toEqual(["move dataset"]);
    expectNoSideNotices();
    expectUndoRedo(pre, ["datasets"]);
  });

  it("moveDatasetToFolder on an unknown id: the undo entry only", () => {
    const before = snapshot();
    act().moveDatasetToFolder("nope", "f2");
    expect(changedSince(before)).toEqual(["future", "history"]);
  });

  it("toggleFolderExpanded flips membership and records NO undo step", () => {
    let before = snapshot();
    act().toggleFolderExpanded("f1");
    expect(changedSince(before)).toEqual(["expandedFolders"]);
    expect(act().expandedFolders).toEqual(["f2"]);
    before = snapshot();
    act().toggleFolderExpanded("f1");
    expect(changedSince(before)).toEqual(["expandedFolders"]);
    expect(act().expandedFolders).toEqual(["f2", "f1"]);
    expect(labels()).toEqual([]);
    expectNoSideNotices();
  });
});

describe("smart folders", () => {
  it("addSmartFolder trims name + query, mints an smf- id, one undo entry", () => {
    const pre = pick(["smartFolders"]);
    const before = snapshot();
    act().addSmartFolder("  Hot  ", "  tag:hot ");
    expect(changedSince(before)).toEqual(["future", "history", "smartFolders"]);
    const added = act().smartFolders.at(-1)!;
    expect(added.id).toMatch(/^smf-/);
    expect(added).toEqual({ id: added.id, name: "Hot", query: "tag:hot" });
    expect(labels()).toEqual(["add smart folder"]);
    expectNoSideNotices();
    expectUndoRedo(pre, ["smartFolders"]);
  });

  it("addSmartFolder with a blank name: no diff, no undo entry", () => {
    const before = snapshot();
    act().addSmartFolder("   ", "tag:x");
    expect(changedSince(before)).toEqual([]);
  });

  it("updateSmartFolder trims; a blank name keeps the old one", () => {
    const pre = pick(["smartFolders"]);
    const before = snapshot();
    act().updateSmartFolder("sf1", "  ", " fmt:csv ");
    expect(changedSince(before)).toEqual(["future", "history", "smartFolders"]);
    expect(act().smartFolders).toEqual([{ id: "sf1", name: "Tagged", query: "fmt:csv" }]);
    expect(labels()).toEqual(["edit smart folder"]);
    expectUndoRedo(pre, ["smartFolders"]);
  });

  it("removeSmartFolder drops it under one undo entry", () => {
    const pre = pick(["smartFolders"]);
    const before = snapshot();
    act().removeSmartFolder("sf1");
    expect(changedSince(before)).toEqual(["future", "history", "smartFolders"]);
    expect(act().smartFolders).toEqual([]);
    expect(labels()).toEqual(["remove smart folder"]);
    expectNoSideNotices();
    expectUndoRedo(pre, ["smartFolders"]);
  });
});
