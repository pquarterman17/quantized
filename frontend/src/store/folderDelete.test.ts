// PR #139 review (P1): deleting a folder must be one atomic, workbook-aware
// operation. The reviewer's scenario verbatim: a nested SELECTED folder
// containing a multi-sheet workbook, deleted in both reparent and cascade
// modes — asserting the workbook's placement, every member dataset's
// folderId, no dangling ids anywhere (selection, expansion), and that the
// NEXT import targets a live folder rather than the deleted one.

import { beforeEach, describe, expect, it } from "vitest";

import { resolveImportTargetFolderId } from "./importTargetFolder";
import { trashEntryId, type FolderTrashEntry } from "./trash";
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
    trash: [], // P3.7: deleteFolder now captures — keep tests isolated from each other.
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

// P3.7: deleteFolder captures a `folder`-kind trash entry BEFORE the
// removal/un-parenting, in both modes — see store/folderDelete.ts's
// captureFolderDeletion doc for why the shape is a member->folder map, not a
// flat id list (a multi-level cascade must restore each member to its OWN
// original sub-folder, not dump everything at the subtree's root).
describe("deleteFolder — trash capture + restore (P3.7)", () => {
  it("cascade captures the whole subtree parent-first, and every un-parented member with its specific folder", () => {
    useApp.getState().deleteFolder("child", "cascade");
    const entry = useApp.getState().trash[0] as FolderTrashEntry;
    expect(entry.kind).toBe("folder");
    expect(entry.folders.map((f) => f.id)).toEqual(["child", "grandchild"]); // parent-first
    expect(entry.datasets.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "s1", folderId: "child" },
      { id: "s2", folderId: "child" },
    ]);
    expect(entry.workbooks).toEqual([{ id: "book", folderId: "child" }]);
    expect(trashEntryId(entry)).toBe("folder:child");
  });

  it("reparent captures just the one node — its children survived, re-parented up, so they're not members", () => {
    useApp.getState().deleteFolder("child", "reparent");
    const entry = useApp.getState().trash[0] as FolderTrashEntry;
    expect(entry.folders.map((f) => f.id)).toEqual(["child"]);
    // s1/s2/book moved to "parent" (still un-parented from "child"'s own
    // point of view, but they moved to a LIVE folder, not root) — captured
    // as former members of "child" all the same.
    expect(entry.datasets.map((m) => m.id).sort()).toEqual(["s1", "s2"]);
    expect(entry.workbooks.map((m) => m.id)).toEqual(["book"]);
  });

  it("cascade restore: folder subtree AND every still-un-parented member come back together", async () => {
    useApp.getState().deleteFolder("child", "cascade");
    const result = await useApp.getState().restoreFromTrash("folder:child");
    expect(result).toEqual({ ok: true, note: undefined });
    const s = useApp.getState();
    expect(s.folders.map((f) => f.id).sort()).toEqual(["child", "grandchild", "parent"]);
    expect(s.folders.find((f) => f.id === "grandchild")!.parentId).toBe("child");
    expect(s.workbooks.find((w) => w.id === "book")!.folderId).toBe("child");
    for (const id of ["s1", "s2"]) expect(s.datasets.find((d) => d.id === id)!.folderId).toBe("child");
    expect(s.trash).toHaveLength(0);
  });

  it("a member the user re-homed in the meantime keeps its new folder, and the note says so", async () => {
    useApp.getState().deleteFolder("child", "cascade"); // s1/s2/book un-parent to root
    useApp.getState().moveDatasetToFolder("s1", "parent"); // user moves ONE of them elsewhere
    const result = await useApp.getState().restoreFromTrash("folder:child");
    expect(result).toEqual({
      ok: true,
      note: 'restored folder "child"; 1 of 3 members had been moved and were left where they are',
    });
    const s = useApp.getState();
    expect(s.datasets.find((d) => d.id === "s1")!.folderId).toBe("parent"); // left alone
    expect(s.datasets.find((d) => d.id === "s2")!.folderId).toBe("child"); // re-homed
    expect(s.workbooks.find((w) => w.id === "book")!.folderId).toBe("child"); // re-homed
  });

  it("reparent restore: members and child folders sent UP to the parent come back under the restored node", async () => {
    // Review finding: "reparent" sends members to the deleted node's PARENT,
    // not the root, so a restore rule that only re-homed `folderId ===
    // undefined` read every one of them as user-moved and left them in
    // "parent" — the default delete mode never restored placement at all.
    useApp.getState().deleteFolder("child", "reparent"); // s1/s2/book + grandchild -> "parent"
    const entry = useApp.getState().trash[0] as FolderTrashEntry;
    expect(entry.dest).toBe("parent");
    expect(entry.childFolders).toEqual([{ id: "grandchild", folderId: "child" }]);

    const result = await useApp.getState().restoreFromTrash("folder:child");
    expect(result).toEqual({ ok: true, note: undefined }); // nothing counted as "moved"
    const s = useApp.getState();
    expect(s.folders.find((f) => f.id === "child")!.parentId).toBe("parent");
    expect(s.folders.find((f) => f.id === "grandchild")!.parentId).toBe("child"); // child folder re-homed
    expect(s.workbooks.find((w) => w.id === "book")!.folderId).toBe("child");
    for (const id of ["s1", "s2"]) expect(s.datasets.find((d) => d.id === id)!.folderId).toBe("child");
    expect(s.datasets.find((d) => d.id === "c1")!.folderId).toBe("parent"); // a genuine "parent" member is untouched
  });

  it("reparent restore leaves a member the user moved elsewhere since, and says so", async () => {
    useApp.getState().deleteFolder("child", "reparent");
    useApp.getState().moveDatasetToFolder("s1", null); // user moves ONE member to the root
    const result = await useApp.getState().restoreFromTrash("folder:child");
    expect(result).toEqual({
      ok: true,
      note: 'restored folder "child"; 1 of 3 members had been moved and were left where they are',
    });
    const s = useApp.getState();
    expect(s.datasets.find((d) => d.id === "s1")!.folderId ?? undefined).toBeUndefined(); // left where the user put it
    expect(s.datasets.find((d) => d.id === "s2")!.folderId).toBe("child");
  });

  it("restoring a folder whose OWN parent died too attaches it at root instead of dangling", async () => {
    useApp.getState().deleteFolder("child", "cascade");
    useApp.getState().deleteFolder("parent", "cascade"); // "parent" (child's captured parent) is now gone too
    const result = await useApp.getState().restoreFromTrash("folder:child");
    expect(result.ok).toBe(true);
    const restoredChild = useApp.getState().folders.find((f) => f.id === "child")!;
    expect(restoredChild.parentId).toBeNull(); // pruneOrphans/parseFolders' own dangling-parent rule
  });

  it("never creates a duplicate folder id if it came back some other way", async () => {
    useApp.getState().deleteFolder("child", "cascade");
    useApp.setState({ folders: [...useApp.getState().folders, { id: "child", name: "recreated", parentId: null, order: 9 }] });
    await useApp.getState().restoreFromTrash("folder:child");
    expect(useApp.getState().folders.filter((f) => f.id === "child")).toHaveLength(1);
  });
});
