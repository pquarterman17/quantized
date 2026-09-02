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
import type { FolderNode } from "../lib/types";
import type { AppState } from "./useApp";
import { byteSize, type FolderTrashMember } from "./trash";

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

/** What a `folder`-kind trash entry (P3.7) needs to capture, computed from
 *  the PRE-delete state — call this before `folderDeletePatch` applies the
 *  removal. `deleteFolder` deletes no dataset either way (see this file's
 *  own header) so there is nothing to lose for members, only PLACEMENT: the
 *  folder subtree itself, and which live dataset/workbook members had their
 *  `folderId` cleared (recorded WITH the specific folder they came from, so
 *  a multi-level cascade restores each member to its own original
 *  sub-folder rather than dumping everything at the subtree's root).
 *
 *  Both `deleteFolder` modes are captured the same shape: "cascade"'s dead
 *  set is the whole subtree (`subtreeIds`); "reparent" removes only the one
 *  node (its children survive, re-parented up), so its dead set is just
 *  `{id}` — `folders` comes back as the single node. Null when `id` names
 *  no live folder (mirrors `folderDeletePatch`'s own no-op guard). */
export function captureFolderDeletion(
  s: Pick<AppState, "folders" | "datasets" | "workbooks">,
  id: string,
  mode: "reparent" | "cascade",
): { folders: FolderNode[]; datasets: FolderTrashMember[]; workbooks: FolderTrashMember[] } | null {
  const target = s.folders.find((f) => f.id === id);
  if (!target) return null;
  const dead = mode === "cascade" ? subtreeIds(s.folders, id) : new Set([id]);
  // `dead` (a Set) inserts `id` first and every node before its children —
  // Set iteration order is insertion order, so this is parent-first "for
  // free", `subtreeIds`'s own DFS shape.
  const folders = [...dead]
    .map((fid) => s.folders.find((f) => f.id === fid))
    .filter((f): f is FolderNode => f !== undefined);
  const member = <T extends { id: string; folderId?: string }>(items: readonly T[]): FolderTrashMember[] =>
    items.filter((x) => x.folderId && dead.has(x.folderId)).map((x) => ({ id: x.id, folderId: x.folderId! }));
  return { folders, datasets: member(s.datasets), workbooks: member(s.workbooks) };
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** The whole `deleteFolder` action body (moved out of useApp.ts — the
 *  store-size ratchet, architecture.test.ts): capture-then-patch, in that
 *  order, so the trash entry is built from the PRE-delete state. A dataset
 *  deleted together with its folder (`removeFolderWithDatasets`,
 *  `folderOps.ts`) is already in Trash as its OWN `dataset` entry by the
 *  time this runs (that path calls `removeDatasets` first, so it is no
 *  longer in `s.datasets` here) — never captured twice. */
export function deleteFolderWithTrash(
  get: SliceGet,
  set: SliceSet,
  id: string,
  mode: "reparent" | "cascade",
): void {
  const capture = captureFolderDeletion(get(), id, mode);
  get().recordHistory("delete folder");
  if (capture) {
    get().sendEntriesToTrash([{ kind: "folder", at: Date.now(), bytes: byteSize(capture), ...capture }]);
  }
  set((s) => folderDeletePatch(s, id, mode));
}
