// PR #139 review (P1): deleting a folder must be one atomic, workbook-aware
// operation. The reviewer's scenario verbatim: a nested SELECTED folder
// containing a multi-sheet workbook, deleted in both reparent and cascade
// modes — asserting the workbook's placement, every member dataset's
// folderId, no dangling ids anywhere (selection, expansion), and that the
// NEXT import targets a live folder rather than the deleted one.

import { beforeEach, describe, expect, it } from "vitest";

import { resolveImportTargetFolderId } from "./importTargetFolder";
import { useApp } from "./useApp";
import { buildLibraryHierarchy } from "../lib/libraryHierarchy";
import type { Dataset, FolderNode } from "../lib/types";
import type { WorkbookNode } from "../lib/workbooks";

const fld = (id: string, parentId: string | null = null): FolderNode => ({ id, name: id, parentId, order: 0 });
const wb = (id: string, folderId?: string): WorkbookNode => ({ id, name: id, folderId });
const ds = (id: string, workbookId: string, folderId?: string): Dataset => ({
  id,
  name: `${id}.dat`,
  workbookId,
  ...(folderId ? { folderId } : {}),
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
});

// parent ─ child(SELECTED, deleted) ─ grandchild; the multi-sheet workbook
// and both its sheets live in `child`; a control workbook lives in `parent`.
beforeEach(() => {
  useApp.setState({
    folders: [fld("parent"), fld("child", "parent"), fld("grandchild", "child")],
    workbooks: [wb("book", "child"), wb("control", "parent")],
    datasets: [ds("s1", "book", "child"), ds("s2", "book", "child"), ds("c1", "control", "parent")],
    expandedFolders: ["parent", "child", "grandchild"],
    expandedWorkbookIds: ["book"],
    librarySelection: { kind: "folder", id: "child" },
    history: [],
    future: [],
  });
});

function hierarchyPlacement(workbookId: string): string | null {
  const s = useApp.getState();
  const nodes = buildLibraryHierarchy({
    folders: s.folders,
    workbooks: s.workbooks,
    datasets: s.datasets,
    originFigures: [],
    editableFigures: [],
    publicationFigures: [],
    pages: [],
    reports: [],
  }).roots;
  const findIn = (list: typeof nodes, parent: string | null): string | null => {
    for (const n of list) {
      if (n.kind === "workbook" && n.entityId === workbookId) return parent;
      const hit = findIn(n.children, n.kind === "folder" ? n.entityId : parent);
      if (hit !== null) return hit;
    }
    return null;
  };
  return findIn(nodes, null);
}

describe("deleteFolder — workbook-aware, atomic (PR #139 review)", () => {
  it("reparent: the contained workbook and BOTH member sheets move to the deleted folder's parent; selection re-targets it", () => {
    useApp.getState().deleteFolder("child", "reparent");
    const s = useApp.getState();
    expect(s.folders.map((f) => f.id).sort()).toEqual(["grandchild", "parent"]);
    expect(s.folders.find((f) => f.id === "grandchild")!.parentId).toBe("parent");
    expect(s.workbooks.find((w) => w.id === "book")!.folderId).toBe("parent");
    for (const id of ["s1", "s2"]) expect(s.datasets.find((d) => d.id === id)!.folderId).toBe("parent");
    expect(hierarchyPlacement("book")).toBe("parent"); // renders there, no missing-folder degrade
    expect(s.expandedFolders).not.toContain("child");
    expect(s.librarySelection).toEqual({ kind: "folder", id: "parent" });
    expect(resolveImportTargetFolderId(useApp.getState)).toBe("parent"); // next import lands live
    // untouched control workbook
    expect(s.workbooks.find((w) => w.id === "control")!.folderId).toBe("parent");
  });

  it("reparent of a ROOT folder: workbook and members land at root, selection clears", () => {
    useApp.setState({ librarySelection: { kind: "folder", id: "parent" } });
    useApp.getState().deleteFolder("parent", "reparent");
    const s = useApp.getState();
    expect(s.workbooks.find((w) => w.id === "control")!.folderId).toBeUndefined();
    expect(s.datasets.find((d) => d.id === "c1")!.folderId).toBeUndefined();
    expect(s.librarySelection).toBeNull();
    expect(resolveImportTargetFolderId(useApp.getState)).toBeUndefined(); // root
    // the child subtree reparented up and stays coherent
    expect(s.folders.find((f) => f.id === "child")!.parentId).toBeNull();
    expect(s.workbooks.find((w) => w.id === "book")!.folderId).toBe("child");
  });

  it("cascade: the whole subtree dies; workbook + members drop to root with no dangling ids; selection clears", () => {
    useApp.getState().deleteFolder("child", "cascade");
    const s = useApp.getState();
    expect(s.folders.map((f) => f.id)).toEqual(["parent"]); // grandchild died with it
    expect(s.workbooks.find((w) => w.id === "book")!.folderId).toBeUndefined();
    for (const id of ["s1", "s2"]) expect(s.datasets.find((d) => d.id === id)!.folderId).toBeUndefined();
    expect(hierarchyPlacement("book")).toBeNull(); // at root, still rendered
    const liveFolderIds = new Set(s.folders.map((f) => f.id));
    for (const w of s.workbooks) if (w.folderId) expect(liveFolderIds.has(w.folderId)).toBe(true);
    for (const d of s.datasets) if (d.folderId) expect(liveFolderIds.has(d.folderId)).toBe(true);
    expect(s.expandedFolders).toEqual(["parent"]);
    expect(s.librarySelection).toBeNull();
    expect(resolveImportTargetFolderId(useApp.getState)).toBeUndefined(); // root, not the dead id
  });

  it("a workbook selection survives folder deletion (workbooks are never destroyed by it)", () => {
    useApp.setState({ librarySelection: { kind: "workbook", id: "book" } });
    useApp.getState().deleteFolder("child", "cascade");
    expect(useApp.getState().librarySelection).toEqual({ kind: "workbook", id: "book" });
    expect(resolveImportTargetFolderId(useApp.getState)).toBeUndefined(); // its folder is gone -> root
  });

  it("one Undo restores the folder, workbook placement, member folderIds, AND expansion state together", () => {
    useApp.getState().deleteFolder("child", "cascade");
    useApp.getState().undo();
    const s = useApp.getState();
    expect(s.folders.map((f) => f.id).sort()).toEqual(["child", "grandchild", "parent"]);
    expect(s.workbooks.find((w) => w.id === "book")!.folderId).toBe("child");
    for (const id of ["s1", "s2"]) expect(s.datasets.find((d) => d.id === id)!.folderId).toBe("child");
    // Retrospective-audit fix: expandedFolders is .dwk-persistent project
    // data and now rides HistorySnapshot — an undone delete restores the
    // folder EXPANDED, exactly as it was, not collapsed.
    expect(s.expandedFolders.sort()).toEqual(["child", "grandchild", "parent"]);
    // librarySelection is deliberately NOT restored (documented transient
    // exclusion; E2 owns its persistence) — it stays wherever the delete
    // retargeted it, which is always a live folder or null, never dangling.
    expect(s.librarySelection).toBeNull();
  });
});
