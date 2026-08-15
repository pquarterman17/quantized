// Project trash (MAIN_PLAN #32, slice 3). Trash is NOT undo: undo is a
// session-scoped edit history, trash answers "I deleted that and only noticed
// later". The eviction rules are pure so the policy is testable without a store.

import { beforeEach, describe, expect, it } from "vitest";

import { evictTrash, TRASH_MAX_AGE_MS, TRASH_MAX_ENTRIES, type TrashEntry } from "./trash";
import { useApp } from "./useApp";
import type { Dataset } from "../lib/types";

const ds = (id: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
});

const entry = (id: string, at: number): TrashEntry => ({ at, dataset: ds(id) });

describe("evictTrash", () => {
  it("keeps everything inside both caps", () => {
    expect(evictTrash([entry("a", 100), entry("b", 90)], 100)).toHaveLength(2);
  });

  it("drops entries past the age limit", () => {
    const now = TRASH_MAX_AGE_MS * 2;
    const kept = evictTrash([entry("old", 0), entry("new", now)], now);
    expect(kept.map((e) => e.dataset.id)).toEqual(["new"]);
  });

  it("keeps the newest N when the count cap bites", () => {
    const many = Array.from({ length: TRASH_MAX_ENTRIES + 5 }, (_, i) => entry(`d${i}`, i));
    const kept = evictTrash(many, TRASH_MAX_ENTRIES + 5);
    expect(kept).toHaveLength(TRASH_MAX_ENTRIES);
    expect(kept[0].dataset.id).toBe(`d${TRASH_MAX_ENTRIES + 4}`); // newest first
  });

  it("returns newest-first regardless of input order", () => {
    const kept = evictTrash([entry("a", 1), entry("c", 3), entry("b", 2)], 3);
    expect(kept.map((e) => e.dataset.id)).toEqual(["c", "b", "a"]);
  });

  it("is empty for empty input", () => {
    expect(evictTrash([], 0)).toEqual([]);
  });
});

describe("trash slice", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [ds("a"), ds("b")], activeId: "a", selectedIds: [], trash: [] });
  });

  it("captures a removed dataset instead of dropping it", () => {
    useApp.getState().removeDataset("a");
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["b"]);
    expect(useApp.getState().trash.map((e) => e.dataset.id)).toEqual(["a"]);
  });

  it("captures a bulk removal", () => {
    useApp.getState().removeDatasets(["a", "b"]);
    expect(useApp.getState().datasets).toHaveLength(0);
    expect(useApp.getState().trash.map((e) => e.dataset.id).sort()).toEqual(["a", "b"]);
  });

  it("captures a Delete-key removal, which delegates to removeDatasets", () => {
    useApp.setState({ selectedIds: ["b"] });
    useApp.getState().removeSelected();
    expect(useApp.getState().trash.map((e) => e.dataset.id)).toEqual(["b"]);
  });

  it("restores a dataset back into the library", () => {
    useApp.getState().removeDataset("a");
    expect(useApp.getState().restoreFromTrash("a")).toBe(true);
    expect(useApp.getState().datasets.map((d) => d.id).sort()).toEqual(["a", "b"]);
    expect(useApp.getState().trash).toHaveLength(0);
  });

  it("reports false when restoring something not in the trash", () => {
    expect(useApp.getState().restoreFromTrash("nope")).toBe(false);
  });

  it("never creates a duplicate if the id came back some other way", () => {
    // e.g. an undo, or a re-import, while the entry sat in the trash.
    useApp.getState().removeDataset("a");
    useApp.setState({ datasets: [...useApp.getState().datasets, ds("a")] });
    useApp.getState().restoreFromTrash("a");
    expect(useApp.getState().datasets.filter((d) => d.id === "a")).toHaveLength(1);
  });

  it("purges one entry, and purges all when given no id", () => {
    useApp.getState().removeDatasets(["a", "b"]);
    useApp.getState().purgeTrash("a");
    expect(useApp.getState().trash.map((e) => e.dataset.id)).toEqual(["b"]);
    useApp.getState().purgeTrash();
    expect(useApp.getState().trash).toEqual([]);
  });

  it("leaves the trash alone when nothing was removed", () => {
    useApp.getState().removeDatasets([]);
    expect(useApp.getState().trash).toEqual([]);
  });
});

describe("restoreFromTrash — workbook self-heal (P1 fix: dangling workbookId)", () => {
  const wbDs = (id: string, workbookId: string): Dataset => ({ ...ds(id), workbookId });

  beforeEach(() => {
    useApp.setState({
      datasets: [], activeId: null, selectedIds: [], trash: [], folders: [], workbooks: [],
      expandedWorkbookIds: [],
    });
  });

  it("restoring a member of a DELETED workbook re-derives a fresh LIVE workbook (no dangling id)", () => {
    useApp.setState({
      datasets: [wbDs("a", "wb1")],
      workbooks: [{ id: "wb1", name: "Book" }],
    });
    useApp.getState().deleteWorkbook("wb1"); // sends "a" to trash, then removes the WorkbookNode
    expect(useApp.getState().workbooks).toHaveLength(0);

    expect(useApp.getState().restoreFromTrash("a")).toBe(true);
    const restored = useApp.getState().datasets.find((d) => d.id === "a")!;
    expect(restored.workbookId).toBeTruthy();
    expect(restored.workbookId).not.toBe("wb1"); // the deleted id never comes back
    const live = useApp.getState().workbooks.find((w) => w.id === restored.workbookId);
    expect(live).toBeDefined(); // no dangling reference
    // PR C: the fresh workbook starts expanded (same rule as import-time
    // creation) — a restored row hidden behind a collapsed disclosure would
    // look like a failed restore.
    expect(useApp.getState().expandedWorkbookIds).toContain(restored.workbookId);
  });

  it("restoring a dataset trashed alone (its workbook still exists) keeps its original membership, no new workbook", () => {
    useApp.setState({
      datasets: [wbDs("a", "wb1"), wbDs("b", "wb1")],
      workbooks: [{ id: "wb1", name: "Book" }],
    });
    useApp.getState().removeDataset("a"); // plain delete — the workbook is untouched
    expect(useApp.getState().workbooks).toHaveLength(1);

    expect(useApp.getState().restoreFromTrash("a")).toBe(true);
    const restored = useApp.getState().datasets.find((d) => d.id === "a")!;
    expect(restored.workbookId).toBe("wb1"); // membership preserved
    expect(useApp.getState().workbooks).toHaveLength(1); // no new workbook created
  });
});
