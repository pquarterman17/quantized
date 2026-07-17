import { describe, expect, it } from "vitest";

import {
  childFolders,
  createFolder,
  deleteFolder,
  dropEdgeAt,
  dropZoneAt,
  folderDatasets,
  folderPath,
  folderPathLabel,
  isSelfOrDescendant,
  migrateGroupsToFolders,
  moveDatasetToFolder,
  moveFolder,
  pruneOrphans,
  renameFolder,
  resolveDropBeforeId,
  subtreeDatasets,
  subtreeIds,
  updateFolder,
} from "./foldertree";
import type { Dataset, FolderNode } from "./types";

// Minimal dataset — only the fields the tree touches (id, folderId, order).
const ds = (id: string, folderId?: string, order?: number): Dataset => ({
  id,
  name: id,
  data: { time: [], values: [], labels: [], units: [], metadata: {} },
  ...(folderId !== undefined ? { folderId } : {}),
  ...(order !== undefined ? { order } : {}),
});
/** A dataset carrying only a legacy `.group` string (no folderId) — the
 *  migrateGroupsToFolders input shape. */
const grouped = (id: string, group: string): Dataset => ({
  id,
  name: id,
  data: { time: [], values: [], labels: [], units: [], metadata: {} },
  group,
});
const fld = (id: string, parentId: string | null, order: number): FolderNode => ({
  id,
  name: id,
  parentId,
  order,
});

describe("queries", () => {
  const folders = [fld("a", null, 1), fld("b", null, 0), fld("a1", "a", 0)];
  const datasets = [ds("d1", "a", 1), ds("d2", "a", 0), ds("d3")];

  it("childFolders returns direct children sorted by order", () => {
    expect(childFolders(folders, null).map((f) => f.id)).toEqual(["b", "a"]);
    expect(childFolders(folders, "a").map((f) => f.id)).toEqual(["a1"]);
    expect(childFolders(folders, "a1")).toEqual([]);
  });

  it("folderDatasets returns direct members sorted by order (null = root)", () => {
    expect(folderDatasets(datasets, "a").map((d) => d.id)).toEqual(["d2", "d1"]);
    expect(folderDatasets(datasets, null).map((d) => d.id)).toEqual(["d3"]);
  });

  it("subtreeIds collects a folder and all descendants", () => {
    const nested = [fld("a", null, 0), fld("a1", "a", 0), fld("a1x", "a1", 0), fld("b", null, 1)];
    expect([...subtreeIds(nested, "a")].sort()).toEqual(["a", "a1", "a1x"]);
  });

  it("isSelfOrDescendant detects self and any descendant", () => {
    const nested = [fld("a", null, 0), fld("a1", "a", 0), fld("a1x", "a1", 0), fld("b", null, 1)];
    expect(isSelfOrDescendant(nested, "a", "a")).toBe(true);
    expect(isSelfOrDescendant(nested, "a", "a1x")).toBe(true);
    expect(isSelfOrDescendant(nested, "a", "b")).toBe(false);
    expect(isSelfOrDescendant(nested, "a", null)).toBe(false);
  });
});

describe("subtreeDatasets (folder bulk ops, item 8)", () => {
  // a ── a1 ── a1x        d-a1x lives in a1x, d-a1 in a1, d-a2/d-a1st in a,
  // b                     d-b in b, d-root at the root.
  const folders = [fld("a", null, 0), fld("a1", "a", 0), fld("a1x", "a1", 0), fld("b", null, 1)];
  const datasets = [
    ds("d-a2", "a", 1),
    ds("d-a1st", "a", 0),
    ds("d-a1", "a1", 0),
    ds("d-a1x", "a1x", 0),
    ds("d-b", "b", 0),
    ds("d-root"),
  ];

  it("collects the whole subtree in tree render order (subfolders first, then own)", () => {
    expect(subtreeDatasets(folders, datasets, "a").map((d) => d.id)).toEqual([
      "d-a1x", // deepest subfolder's contents surface first (render order)
      "d-a1",
      "d-a1st", // then the folder's own datasets, sorted by order
      "d-a2",
    ]);
  });

  it("excludes datasets outside the subtree (siblings and root)", () => {
    const got = subtreeDatasets(folders, datasets, "a").map((d) => d.id);
    expect(got).not.toContain("d-b");
    expect(got).not.toContain("d-root");
  });

  it("returns [] for an empty folder and ignores expansion state entirely", () => {
    expect(subtreeDatasets(folders, datasets, "a1x").map((d) => d.id)).toEqual(["d-a1x"]);
    expect(subtreeDatasets([fld("empty", null, 0)], datasets, "empty")).toEqual([]);
  });
});

describe("createFolder / renameFolder", () => {
  it("appends a new folder after existing siblings", () => {
    let folders: FolderNode[] = [];
    folders = createFolder(folders, null, "First", "f1");
    folders = createFolder(folders, null, "Second", "f2");
    const roots = childFolders(folders, null);
    expect(roots.map((f) => f.id)).toEqual(["f1", "f2"]); // insertion order preserved
    expect(roots[1].order).toBeGreaterThan(roots[0].order);
  });

  it("falls back to a default name when blank; rename ignores blank", () => {
    let folders = createFolder([], null, "   ", "f1");
    expect(folders[0].name).toBe("New Folder");
    folders = renameFolder(folders, "f1", "  XRD  ");
    expect(folders[0].name).toBe("XRD");
    folders = renameFolder(folders, "f1", "   ");
    expect(folders[0].name).toBe("XRD"); // unchanged
  });
});

describe("updateFolder (Folder Properties, GUI_INTERACTION_PLAN #13 sub-item 4)", () => {
  it("patches notes/color/defaultTemplate onto the folder, leaving name/order/parentId alone", () => {
    const folders = [fld("a", null, 0)];
    const out = updateFolder(folders, "a", { notes: "n", color: "amber", defaultTemplate: "T" });
    expect(out[0]).toMatchObject({ id: "a", name: "a", notes: "n", color: "amber", defaultTemplate: "T" });
  });

  it("setting a field to undefined clears it (back to unset)", () => {
    const folders: FolderNode[] = [{ id: "a", name: "a", parentId: null, order: 0, notes: "n", color: "rose" }];
    const out = updateFolder(folders, "a", { notes: undefined, color: undefined });
    expect(out[0].notes).toBeUndefined();
    expect(out[0].color).toBeUndefined();
  });

  it("is a no-op on an unknown id", () => {
    const folders = [fld("a", null, 0)];
    expect(updateFolder(folders, "gone", { notes: "n" })).toEqual(folders);
  });
});

describe("folderPath / folderPathLabel (breadcrumb + Show in folder, sub-item 2)", () => {
  const nested = [fld("a", null, 0), fld("a1", "a", 0), fld("a1x", "a1", 0), fld("b", null, 1)];

  it("folderPath returns the ancestor chain root-first, inclusive", () => {
    expect(folderPath(nested, "a1x").map((f) => f.id)).toEqual(["a", "a1", "a1x"]);
    expect(folderPath(nested, "a").map((f) => f.id)).toEqual(["a"]);
  });

  it("folderPath resolves to [] for null/an unknown id", () => {
    expect(folderPath(nested, null)).toEqual([]);
    expect(folderPath(nested, "ghost")).toEqual([]);
  });

  it("folderPathLabel joins the names with the breadcrumb separator", () => {
    expect(folderPathLabel(nested, "a1x")).toBe("a › a1 › a1x");
    expect(folderPathLabel(nested, "a")).toBe("a");
  });

  it("folderPathLabel is undefined for a root-level (null/absent) folderId", () => {
    expect(folderPathLabel(nested, null)).toBeUndefined();
    expect(folderPathLabel(nested, undefined)).toBeUndefined();
  });
});

describe("deleteFolder", () => {
  const folders = [fld("a", null, 0), fld("a1", "a", 0), fld("b", null, 1)];
  const datasets = [ds("d1", "a", 0), ds("d2", "a1", 0), ds("d3", "b", 0)];

  it("reparent mode lifts children + datasets to the parent", () => {
    const out = deleteFolder(folders, datasets, "a", "reparent");
    expect(out.folders.find((f) => f.id === "a")).toBeUndefined();
    expect(out.folders.find((f) => f.id === "a1")!.parentId).toBe(null); // a1 up to root
    expect(out.datasets.find((d) => d.id === "d1")!.folderId).toBeUndefined(); // d1 up to root
    expect(out.datasets.find((d) => d.id === "d2")!.folderId).toBe("a1"); // unchanged
  });

  it("cascade mode removes the whole subtree; datasets drop to root, never deleted", () => {
    const out = deleteFolder(folders, datasets, "a", "cascade");
    expect(out.folders.map((f) => f.id)).toEqual(["b"]);
    expect(out.datasets).toHaveLength(3); // no dataset destroyed
    expect(out.datasets.find((d) => d.id === "d1")!.folderId).toBeUndefined();
    expect(out.datasets.find((d) => d.id === "d2")!.folderId).toBeUndefined();
    expect(out.datasets.find((d) => d.id === "d3")!.folderId).toBe("b"); // outside subtree
  });
});

describe("moveFolder", () => {
  it("rejects a move into the folder's own subtree (cycle guard)", () => {
    const folders = [fld("a", null, 0), fld("a1", "a", 0)];
    expect(moveFolder(folders, "a", "a1")).toBe(folders); // unchanged reference
  });

  it("reparents and renumbers destination siblings densely", () => {
    const folders = [fld("a", null, 0), fld("b", null, 1), fld("c", null, 2)];
    // move c to root position before b: expect order a, c, b
    const out = moveFolder(folders, "c", null, "b");
    expect(childFolders(out, null).map((f) => f.id)).toEqual(["a", "c", "b"]);
    expect(childFolders(out, null).map((f) => f.order)).toEqual([0, 1, 2]);
  });

  it("moves a folder into another parent (append)", () => {
    const folders = [fld("a", null, 0), fld("b", null, 1)];
    const out = moveFolder(folders, "b", "a");
    expect(out.find((f) => f.id === "b")!.parentId).toBe("a");
    expect(childFolders(out, "a").map((f) => f.id)).toEqual(["b"]);
  });
});

describe("moveDatasetToFolder", () => {
  it("moves a dataset into a folder (append)", () => {
    const datasets = [ds("d1"), ds("d2", "a", 0)];
    const out = moveDatasetToFolder(datasets, "d1", "a");
    expect(out.find((d) => d.id === "d1")!.folderId).toBe("a");
    expect(folderDatasets(out, "a").map((d) => d.id)).toEqual(["d2", "d1"]);
  });

  it("reorders within a folder before a sibling", () => {
    const datasets = [ds("d1", "a", 0), ds("d2", "a", 1), ds("d3", "a", 2)];
    const out = moveDatasetToFolder(datasets, "d3", "a", "d2"); // d3 before d2
    expect(folderDatasets(out, "a").map((d) => d.id)).toEqual(["d1", "d3", "d2"]);
    expect(folderDatasets(out, "a").map((d) => d.order)).toEqual([0, 1, 2]);
  });

  it("moves a dataset out to the root (folderId cleared)", () => {
    const datasets = [ds("d1", "a", 0)];
    const out = moveDatasetToFolder(datasets, "d1", null);
    expect(out[0].folderId).toBeUndefined();
  });
});

describe("pruneOrphans", () => {
  it("clears folderIds pointing at missing folders; keeps valid ones", () => {
    const folders = [fld("a", null, 0)];
    const datasets = [ds("d1", "a", 0), ds("d2", "ghost", 0), ds("d3")];
    const out = pruneOrphans(folders, datasets);
    expect(out.find((d) => d.id === "d1")!.folderId).toBe("a");
    expect(out.find((d) => d.id === "d2")!.folderId).toBeUndefined();
  });

  it("returns the same array reference when nothing is orphaned (no churn)", () => {
    const folders = [fld("a", null, 0)];
    const datasets = [ds("d1", "a", 0), ds("d2")];
    expect(pruneOrphans(folders, datasets)).toBe(datasets);
  });
});

describe("migrateGroupsToFolders", () => {
  it("creates one root folder per distinct group and assigns folderId, clearing group", () => {
    const datasets = [grouped("d1", "Batch A"), grouped("d2", "Batch B"), grouped("d3", "Batch A")];
    let seq = 0;
    const out = migrateGroupsToFolders([], datasets, () => `f${++seq}`);
    expect(out.folders.map((f) => f.name).sort()).toEqual(["Batch A", "Batch B"]);
    expect(out.createdFolderIds).toHaveLength(2);
    const byId = new Map(out.datasets.map((d) => [d.id, d]));
    // d1 and d3 share the same folder (same group name).
    expect(byId.get("d1")!.folderId).toBe(byId.get("d3")!.folderId);
    expect(byId.get("d1")!.folderId).not.toBe(byId.get("d2")!.folderId);
    // group is cleared — its job (promoting into a folder) is done.
    expect(byId.get("d1")!.group).toBeUndefined();
    expect(byId.get("d2")!.group).toBeUndefined();
  });

  it("reuses an existing root folder with a matching name instead of duplicating", () => {
    const folders = [fld("existing", null, 0)];
    const folders2 = renameFolder(folders, "existing", "Batch A");
    const out = migrateGroupsToFolders(folders2, [grouped("d1", "Batch A")], () => "new");
    expect(out.folders).toHaveLength(1); // no new folder created
    expect(out.createdFolderIds).toEqual([]);
    expect(out.datasets[0].folderId).toBe("existing");
  });

  it("leaves an already-foldered dataset alone even if it still carries a group", () => {
    const folders = [fld("a", null, 0)];
    const datasets = [{ ...grouped("d1", "Batch A"), folderId: "a" }];
    const out = migrateGroupsToFolders(folders, datasets, () => "new");
    expect(out.folders).toBe(folders); // unchanged reference — no folder created
    expect(out.datasets).toBe(datasets); // unchanged reference — dataset untouched
    expect(out.datasets[0].folderId).toBe("a");
    expect(out.datasets[0].group).toBe("Batch A"); // NOT cleared — migration never ran on it
  });

  it("is a true no-op (same references) when nothing is pending", () => {
    const folders = [fld("a", null, 0)];
    const datasets = [ds("d1", "a", 0), ds("d2")]; // no groups at all
    const out = migrateGroupsToFolders(folders, datasets, () => "new");
    expect(out.folders).toBe(folders);
    expect(out.datasets).toBe(datasets);
    expect(out.createdFolderIds).toEqual([]);
  });

  it("is idempotent: running it twice in a row only migrates once", () => {
    const datasets = [grouped("d1", "Batch A")];
    const once = migrateGroupsToFolders([], datasets, () => "f1");
    const twice = migrateGroupsToFolders(once.folders, once.datasets, () => "f2");
    expect(twice.folders).toBe(once.folders); // no second folder created
    expect(twice.datasets).toBe(once.datasets);
    expect(twice.createdFolderIds).toEqual([]);
  });

  it("blank/whitespace-only group is treated as ungrouped (no folder created)", () => {
    const out = migrateGroupsToFolders([], [grouped("d1", "   ")], () => "new");
    expect(out.folders).toEqual([]);
    expect(out.datasets[0].folderId).toBeUndefined();
  });
});

describe("dropEdgeAt", () => {
  it("splits a row at its vertical midpoint", () => {
    const rect = { top: 100, height: 40 };
    expect(dropEdgeAt(rect, 110)).toBe("above"); // upper half
    expect(dropEdgeAt(rect, 130)).toBe("below"); // lower half
    expect(dropEdgeAt(rect, 119)).toBe("above");
    expect(dropEdgeAt(rect, 120)).toBe("below"); // exact midpoint counts as below
  });
});

describe("dropZoneAt", () => {
  it("splits a tall row into above/into/below (quarter-height edges)", () => {
    const rect = { top: 0, height: 40 }; // edge = min(40/3, max(6, 10)) = 10
    expect(dropZoneAt(rect, 5)).toBe("above");
    expect(dropZoneAt(rect, 20)).toBe("into");
    expect(dropZoneAt(rect, 35)).toBe("below");
  });

  it("clamps the edge band to a usable minimum on a short row", () => {
    const rect = { top: 0, height: 10 }; // edge = min(10/3, max(6, 2.5)) = 3.33
    expect(dropZoneAt(rect, 1)).toBe("above");
    expect(dropZoneAt(rect, 5)).toBe("into");
    expect(dropZoneAt(rect, 9)).toBe("below");
  });
});

describe("resolveDropBeforeId", () => {
  const siblingIds = ["a", "b", "c"];

  it("above resolves to the target id itself (insert right there)", () => {
    expect(resolveDropBeforeId(siblingIds, "b", "above")).toBe("b");
  });

  it("below resolves to the next sibling's id", () => {
    expect(resolveDropBeforeId(siblingIds, "a", "below")).toBe("b");
  });

  it("below on the last sibling resolves to undefined (append)", () => {
    expect(resolveDropBeforeId(siblingIds, "c", "below")).toBeUndefined();
  });

  it("a stale/missing target resolves to undefined (append) on below", () => {
    expect(resolveDropBeforeId(siblingIds, "ghost", "below")).toBeUndefined();
  });
});
