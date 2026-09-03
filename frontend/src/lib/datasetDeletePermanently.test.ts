// P3.7 item 5: the explicit, warned Trash bypass — lib/contextActions.ts's
// `dataset.deletePermanently` registry entry, tested directly against the
// real registry (unlike contextActions.test.ts's synthetic-action-type
// suite, which deliberately stays isolated from any one real registry — see
// that file's own header).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { askConfirm } from "../components/overlays/ConfirmDialog";
import { datasetRemoveActions, runContextAction, type DatasetActionTarget } from "./contextActions";
import { trashEntryId, type DatasetTrashEntry } from "../store/trash";
import { useApp } from "../store/useApp";
import type { Dataset } from "./types";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const ds = (id: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0], values: [[1]], labels: ["M"], units: [""], metadata: {} },
});

const target = (dataset: Dataset): DatasetActionTarget => ({
  dataset,
  active: false,
  selected: false,
  selectedIds: [],
  canMoveUp: false,
  canMoveDown: false,
  onRename: () => {},
  onAddTag: () => {},
});

const action = datasetRemoveActions.find((a) => a.id === "dataset.deletePermanently")!;

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [ds("a")], activeId: "a", selectedIds: [], trash: [] });
});

describe("dataset.deletePermanently", () => {
  it("exists and is destructive (routes through the confirm gate)", () => {
    expect(action).toBeDefined();
    expect(action.destructive).toBe(true);
  });

  it("the confirm body states the trash bypass and irreversibility", () => {
    const spec = action.confirm!(target(ds("a")));
    expect(spec.message).toMatch(/bypasses the trash/i);
    expect(spec.message).toMatch(/cannot be undone/i);
  });

  it("cancelling leaves the dataset and the trash exactly as they were", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    runContextAction(action, target(ds("a")));
    await Promise.resolve(); // askConfirm is awaited before run() fires
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["a"]);
    expect(useApp.getState().trash).toEqual([]);
  });

  it("confirming removes the dataset WITHOUT capturing it into trash", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    runContextAction(action, target(ds("a")));
    await Promise.resolve();
    expect(useApp.getState().datasets).toHaveLength(0);
    expect(useApp.getState().trash).toEqual([]); // the whole point — no recovery path
  });
});

describe("removeDatasets — {permanent: true} bypasses trash (the store side dataset.deletePermanently calls)", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [ds("a"), ds("b")], activeId: "a", selectedIds: [], trash: [], history: [], future: [] });
  });

  it("removes the dataset and leaves the trash untouched", () => {
    useApp.getState().removeDatasets(["a"], { permanent: true });
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["b"]);
    expect(useApp.getState().trash).toEqual([]);
  });

  it("is NOT undoable: Ctrl+Z after a permanent delete does not bring the dataset back (review finding on #292)", () => {
    useApp.getState().removeDatasets(["a"], { permanent: true });
    expect(useApp.getState().datasets.some((d) => d.id === "a")).toBe(false);
    useApp.getState().undo();
    expect(useApp.getState().datasets.some((d) => d.id === "a")).toBe(false);
  });

  it("scrubs the dataset from EARLIER snapshots too — undoing an older edit cannot resurrect it", () => {
    useApp.getState().recordHistory("some earlier edit"); // snapshot still holds "a"
    expect(useApp.getState().history.at(-1)?.snapshot.datasets.some((d) => d.id === "a")).toBe(true);
    useApp.getState().removeDatasets(["a"], { permanent: true });
    expect(useApp.getState().history.at(-1)?.snapshot.datasets.some((d) => d.id === "a")).toBe(false);
    useApp.getState().undo(); // the OLDER edit
    expect(useApp.getState().datasets.some((d) => d.id === "a")).toBe(false);
  });

  it("drops an OLDER trash copy of the same dataset: delete → Undo → delete permanently leaves nothing to restore (review round 3 on #292)", async () => {
    useApp.getState().removeDatasets(["a"]); // ordinary: captured into trash, one undo step
    expect(useApp.getState().trash.map(trashEntryId)).toEqual(["dataset:a"]);
    useApp.getState().undo(); // history snapshot comes back; trash is outside history, so the copy stays
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["a", "b"]);
    expect(useApp.getState().trash.map(trashEntryId)).toEqual(["dataset:a"]);

    useApp.getState().removeDatasets(["a"], { permanent: true });
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["b"]);
    expect(useApp.getState().trash).toEqual([]); // the older copy went with it
    await expect(useApp.getState().restoreFromTrash("dataset:a")).resolves.toEqual({
      ok: false,
      reason: "that entry is no longer in the trash",
    });
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["b"]);
  });

  it("leaves UNRELATED trash entries alone when scrubbing the permanent delete's ids", () => {
    useApp.getState().removeDatasets(["a"]);
    useApp.getState().undo();
    const other: DatasetTrashEntry = { kind: "dataset", at: Date.now(), bytes: 1, dataset: ds("zz") };
    useApp.getState().sendEntriesToTrash([other]);
    expect(useApp.getState().trash.map(trashEntryId).sort()).toEqual(["dataset:a", "dataset:zz"]);

    useApp.getState().removeDatasets(["a"], { permanent: true });
    expect(useApp.getState().trash.map(trashEntryId)).toEqual(["dataset:zz"]);
  });

  it("an ordinary removeDatasets call (no opts) still captures, unaffected", () => {
    useApp.getState().removeDatasets(["a"]);
    expect((useApp.getState().trash as DatasetTrashEntry[]).map((e) => e.dataset.id)).toEqual(["a"]);
  });
});
