// Workbook-aware folder deletion (PR #139 review, P1): the pure
// lib/foldertree.ts `deleteFolder` predates the workbook layer and re-homes
// only FolderNodes and `Dataset.folderId` — but canonical tree placement is
// owned by `WorkbookNode.folderId` (lib/workbooks.ts's header), so on its
// own it left a workbook inside a deleted folder pointing at the dead id
// (rendered at root with a missing-folder degrade) while its member
// worksheets claimed the deleted folder's parent, and left a stale
// `librarySelection` feeding `resolveImportTargetFolderId` the dead id for
// the NEXT import. This patch is the single atomic `set()` payload that
// keeps all five state families coherent: folders, datasets, workbooks,
// expanded-folder state, and the tree selection.

import { deleteFolder as treeDeleteFolder, subtreeIds } from "../lib/foldertree";
import type { AppState } from "./useApp";

/**
 * The full store patch for deleting folder `id`:
 *  - folders/datasets: exactly `lib/foldertree.deleteFolder` (reparent moves
 *    children/datasets up; cascade removes the subtree, datasets to root).
 *  - workbooks: a workbook whose `folderId` dies moves WITH its members —
 *    to the deleted folder's parent (reparent) or root (cascade) — so
 *    workbook-owned placement and member `folderId`s stay in lockstep.
 *  - expandedFolders: dead ids dropped (harmless if left, but the review's
 *    contract is no dangling ids anywhere).
 *  - librarySelection: a selection naming a dead folder re-targets the live
 *    parent (reparent, when one exists) or clears to root, so the next
 *    import lands somewhere real. Workbook selections survive — workbooks
 *    are never destroyed by folder deletion.
 */
export function folderDeletePatch(
  s: AppState,
  id: string,
  mode: "reparent" | "cascade",
): Partial<AppState> {
  const target = s.folders.find((f) => f.id === id);
  if (!target) return {};
  const dead = mode === "cascade" ? subtreeIds(s.folders, id) : new Set([id]);
  const dest = mode === "reparent" ? (target.parentId ?? undefined) : undefined;
  const sel = s.librarySelection;
  return {
    ...treeDeleteFolder(s.folders, s.datasets, id, mode),
    workbooks: s.workbooks.map((w) =>
      w.folderId && dead.has(w.folderId) ? { ...w, folderId: dest } : w,
    ),
    expandedFolders: s.expandedFolders.filter((fid) => !dead.has(fid)),
    librarySelection:
      sel?.kind === "folder" && dead.has(sel.id)
        ? dest
          ? { kind: "folder", id: dest }
          : null
        : sel,
  };
}
