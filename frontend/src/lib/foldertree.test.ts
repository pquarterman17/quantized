import { describe, expect, it } from "vitest";

import {
  childFolders,
  createFolder,
  deleteFolder,
  folderDatasets,
  isSelfOrDescendant,
  moveDatasetToFolder,
  moveFolder,
  pruneOrphans,
  renameFolder,
  subtreeIds,
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
