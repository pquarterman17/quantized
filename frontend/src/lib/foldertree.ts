// Pure operations over the Library folder tree (project-organization plan,
// Approach B). Folders are organization over the flat `datasets[]` array; these
// functions take (folders, datasets, …) and return NEW arrays — no store, no
// mutation — so the store actions stay thin wrappers and the logic is unit-
// testable in isolation. Invariants upheld here:
//   - datasets stay flat; membership is `Dataset.folderId` (absent = root)
//   - the tree is `FolderNode.parentId` (null = root)
//   - folders and datasets keep SEPARATE order spaces; the UI renders child
//     folders first, then datasets, each sorted by `order`
//   - no cycles (a folder can't move into its own subtree)
//   - datasets are never deleted here — deleting a folder only re-homes them

import { byOrder, orderBetween } from "./order";
import type { Dataset, FolderNode } from "./types";

// ── queries ──────────────────────────────────────────────────────────────

/** Direct child folders of `parentId` (null = root), sorted by order. */
export function childFolders(folders: FolderNode[], parentId: string | null): FolderNode[] {
  return folders.filter((f) => f.parentId === parentId).sort(byOrder);
}

/** Datasets sitting directly in `folderId` (null = root), sorted by order. */
export function folderDatasets(datasets: Dataset[], folderId: string | null): Dataset[] {
  return datasets.filter((d) => (d.folderId ?? null) === folderId).sort(byOrder);
}

/** All ids in the subtree rooted at `id` (inclusive). */
export function subtreeIds(folders: FolderNode[], id: string): Set<string> {
  const childrenOf = new Map<string | null, FolderNode[]>();
  for (const f of folders) {
    const arr = childrenOf.get(f.parentId) ?? [];
    arr.push(f);
    childrenOf.set(f.parentId, arr);
  }
  const ids = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (ids.has(cur)) continue;
    ids.add(cur);
    for (const c of childrenOf.get(cur) ?? []) stack.push(c.id);
  }
  return ids;
}

/** Is `target` the folder `id` itself or one of its descendants? Used to reject
 *  a move that would create a cycle (a folder into its own subtree). */
export function isSelfOrDescendant(
  folders: FolderNode[],
  id: string,
  target: string | null,
): boolean {
  const parentOf = new Map(folders.map((f) => [f.id, f.parentId]));
  let cur: string | null = target;
  while (cur !== null) {
    if (cur === id) return true;
    cur = parentOf.get(cur) ?? null;
  }
  return false;
}

// ── folder mutations ─────────────────────────────────────────────────────

/** Append a new folder under `parentId`; caller supplies the id. */
export function createFolder(
  folders: FolderNode[],
  parentId: string | null,
  name: string,
  id: string,
): FolderNode[] {
  const last = childFolders(folders, parentId).at(-1);
  const order = orderBetween(last?.order, undefined);
  return [...folders, { id, name: name.trim() || "New Folder", parentId, order }];
}

/** Rename a folder (no-op on blank name). */
export function renameFolder(folders: FolderNode[], id: string, name: string): FolderNode[] {
  const nm = name.trim();
  if (!nm) return folders;
  return folders.map((f) => (f.id === id ? { ...f, name: nm } : f));
}

/**
 * Delete a folder. Datasets are never destroyed — only re-homed:
 *   - "reparent" (default): child folders + datasets move up to the deleted
 *     folder's parent; only that one node vanishes.
 *   - "cascade": the whole subtree of folders is removed; every dataset that was
 *     anywhere inside it drops to the root.
 */
export function deleteFolder(
  folders: FolderNode[],
  datasets: Dataset[],
  id: string,
  mode: "reparent" | "cascade" = "reparent",
): { folders: FolderNode[]; datasets: Dataset[] } {
  const target = folders.find((f) => f.id === id);
  if (!target) return { folders, datasets };

  if (mode === "reparent") {
    const up = target.parentId;
    const nextFolders = folders
      .filter((f) => f.id !== id)
      .map((f) => (f.parentId === id ? { ...f, parentId: up } : f));
    const nextDatasets = datasets.map((d) =>
      (d.folderId ?? null) === id ? { ...d, folderId: up ?? undefined } : d,
    );
    return { folders: nextFolders, datasets: nextDatasets };
  }

  const ids = subtreeIds(folders, id);
  const nextFolders = folders.filter((f) => !ids.has(f.id));
  const nextDatasets = datasets.map((d) =>
    d.folderId && ids.has(d.folderId) ? { ...d, folderId: undefined } : d,
  );
  return { folders: nextFolders, datasets: nextDatasets };
}

/**
 * Move folder `id` under `newParentId`, positioned before `beforeId` (append if
 * omitted/not found). Rejected if it would create a cycle. The destination's
 * child folders are renumbered to dense integers so ordering stays exact.
 */
export function moveFolder(
  folders: FolderNode[],
  id: string,
  newParentId: string | null,
  beforeId?: string,
): FolderNode[] {
  const node = folders.find((f) => f.id === id);
  if (!node) return folders;
  if (isSelfOrDescendant(folders, id, newParentId)) return folders;

  const dest = childFolders(folders, newParentId).filter((f) => f.id !== id);
  const at = beforeId ? dest.findIndex((f) => f.id === beforeId) : -1;
  const insertAt = at < 0 ? dest.length : at;
  const ordered = [...dest.slice(0, insertAt), node, ...dest.slice(insertAt)];
  const orderById = new Map(ordered.map((f, i) => [f.id, i]));

  return folders.map((f) => {
    if (f.id === id) return { ...f, parentId: newParentId, order: orderById.get(id)! };
    const o = orderById.get(f.id);
    return o === undefined ? f : { ...f, order: o };
  });
}

// ── dataset membership / order ───────────────────────────────────────────

/**
 * Move dataset `id` into `folderId` (null = root), before `beforeId` (append if
 * omitted). Renumbers that folder's datasets to dense integers. Use with the
 * same folderId as the dataset already has to pure-reorder within a folder.
 */
export function moveDatasetToFolder(
  datasets: Dataset[],
  id: string,
  folderId: string | null,
  beforeId?: string,
): Dataset[] {
  const node = datasets.find((d) => d.id === id);
  if (!node) return datasets;

  const dest = folderDatasets(datasets, folderId).filter((d) => d.id !== id);
  const at = beforeId ? dest.findIndex((d) => d.id === beforeId) : -1;
  const insertAt = at < 0 ? dest.length : at;
  const ordered = [...dest.slice(0, insertAt), node, ...dest.slice(insertAt)];
  const orderById = new Map(ordered.map((d, i) => [d.id, i]));

  return datasets.map((d) => {
    if (d.id === id) return { ...d, folderId: folderId ?? undefined, order: orderById.get(id)! };
    const o = orderById.get(d.id);
    return o === undefined ? d : { ...d, order: o };
  });
}

// ── integrity ────────────────────────────────────────────────────────────

/** Clear any `folderId` that points at a folder no longer present (→ root).
 *  Defensive: run after load so a corrupt/edited .dwk can't strand a dataset. */
export function pruneOrphans(folders: FolderNode[], datasets: Dataset[]): Dataset[] {
  const live = new Set(folders.map((f) => f.id));
  let changed = false;
  const next = datasets.map((d) => {
    if (d.folderId && !live.has(d.folderId)) {
      changed = true;
      return { ...d, folderId: undefined };
    }
    return d;
  });
  return changed ? next : datasets;
}
