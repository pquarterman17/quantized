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

/**
 * Every dataset anywhere in folder `id`'s subtree, in tree RENDER order (each
 * level emits its child folders' subtrees first, then its own datasets —
 * matching useLibraryTree's buildTreeRows), so a folder bulk op (item 8) walks
 * datasets in the same order the Library shows them.
 */
export function subtreeDatasets(
  folders: FolderNode[],
  datasets: Dataset[],
  id: string,
): Dataset[] {
  const out: Dataset[] = [];
  const emit = (fid: string) => {
    for (const c of childFolders(folders, fid)) emit(c.id);
    out.push(...folderDatasets(datasets, fid));
  };
  emit(id);
  return out;
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

/** Patch a folder's Properties fields (plan #13 sub-item 4: notes/colour/
 *  default template) — everything but `name` (that's `renameFolder`'s job,
 *  which also guards blank input; this one has no such special case since
 *  every patchable field is legitimately clearable to "unset"). Setting a
 *  field to `undefined` in the patch removes it (back to "no override");
 *  a no-op on an unknown `id`. */
export function updateFolder(
  folders: FolderNode[],
  id: string,
  patch: Partial<Pick<FolderNode, "notes" | "color" | "defaultTemplate">>,
): FolderNode[] {
  return folders.map((f) => {
    if (f.id !== id) return f;
    const next = { ...f, ...patch };
    for (const k of ["notes", "color", "defaultTemplate"] as const) {
      if (next[k] === undefined) delete next[k];
    }
    return next;
  });
}

/** The ancestor chain from the root down to `id`, inclusive (breadcrumb /
 *  "Show in folder" support, plan #13 sub-items 2/5). `null`/an unknown id
 *  resolves to an empty path — a dataset at the Library root has nothing to
 *  show. A folder whose parent chain is broken (shouldn't happen post-
 *  `parseFolders`/`pruneOrphans`, but degrade rather than loop forever)
 *  stops at the break instead of throwing. */
export function folderPath(folders: FolderNode[], id: string | null): FolderNode[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: FolderNode[] = [];
  const seen = new Set<string>();
  let cur = id;
  while (cur !== null) {
    const f = byId.get(cur);
    if (!f || seen.has(f.id)) break; // missing link or a cycle — stop, don't loop
    seen.add(f.id);
    path.unshift(f);
    cur = f.parentId;
  }
  return path;
}

/** "Folder › Subfolder" display caption for a dataset's containing folder
 *  (plan #13 sub-item 2 — the breadcrumb caption + "Show in folder" path a
 *  filtered/search/smart-folder result row shows). `undefined` for a
 *  root-level dataset (`folderId` null/absent) — nothing to caption. */
export function folderPathLabel(folders: FolderNode[], folderId: string | null | undefined): string | undefined {
  if (!folderId) return undefined;
  const path = folderPath(folders, folderId);
  return path.length ? path.map((f) => f.name).join(" › ") : undefined;
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

/**
 * Migrate legacy `Dataset.group` strings into folders (project-organization
 * plan item 6 — "one organizational model, not two"). For every dataset that
 * carries a non-blank `group` but no `folderId`, resolve (create-or-reuse by
 * name) a ROOT-level folder named after the group, move the dataset into it,
 * and clear `group` — its job was migration, and clearing it keeps the
 * retired group-chip UI's `hasAnyGroup`-style checks honest (nothing left to
 * render twice).
 *
 * Idempotent: a dataset that already has a `folderId` (already migrated, or
 * organized some other way) is left alone, so re-running this on an
 * already-migrated set — e.g. every autosave reload — is a true no-op and
 * returns the SAME array references. Multiple datasets sharing a group name
 * land in one folder; a root folder already named like the group (hand-made,
 * or created by an earlier migration run) is reused rather than duplicated.
 */
export function migrateGroupsToFolders(
  folders: FolderNode[],
  datasets: Dataset[],
  genId: () => string,
): { folders: FolderNode[]; datasets: Dataset[]; createdFolderIds: string[] } {
  const pending = datasets.filter((d) => d.folderId == null && d.group?.trim());
  if (pending.length === 0) return { folders, datasets, createdFolderIds: [] };

  let nextFolders = folders;
  const createdFolderIds: string[] = [];
  const idByName = new Map(childFolders(folders, null).map((f) => [f.name, f.id]));
  for (const d of pending) {
    const name = d.group!.trim();
    if (!idByName.has(name)) {
      const id = genId();
      nextFolders = createFolder(nextFolders, null, name, id);
      idByName.set(name, id);
      createdFolderIds.push(id);
    }
  }

  let nextDatasets = datasets;
  for (const d of pending) {
    nextDatasets = moveDatasetToFolder(nextDatasets, d.id, idByName.get(d.group!.trim())!);
  }
  const pendingIds = new Set(pending.map((d) => d.id));
  nextDatasets = nextDatasets.map((d) => (pendingIds.has(d.id) ? { ...d, group: undefined } : d));

  return { folders: nextFolders, datasets: nextDatasets, createdFolderIds };
}

// ── drag-and-drop geometry (project-organization plan item 3b) ────────────
// Pure hit-testing so the DnD components (DatasetRow/FolderRow) stay thin —
// jsdom has no native DnD or layout, so keeping the geometry here (not
// inline in a component) is what makes it unit-testable without a real drag
// gesture (see the components' .test.tsx for the synthetic-event pattern).

/** A "drop between rows" indicator position: the classic half-height split —
 *  the pointer above a row's own vertical midpoint means "insert before this
 *  row", below means "insert after". Used for dataset-row reorder, where a
 *  row is never itself a drop container (no third "into" zone). */
export type DropEdge = "above" | "below";

export function dropEdgeAt(rect: { top: number; height: number }, clientY: number): DropEdge {
  return clientY - rect.top < rect.height / 2 ? "above" : "below";
}

/** A folder header additionally accepts a THIRD zone: dropping in the wide
 *  middle band reparents the dragged folder INTO the target (it becomes a new
 *  child), while the thin top/bottom edge bands reposition it as a SIBLING of
 *  the target (before/after). Edge bands are a quarter of the row height,
 *  clamped to a comfortable minimum so a short row still has a usable edge. */
export type DropZone3 = DropEdge | "into";

export function dropZoneAt(rect: { top: number; height: number }, clientY: number): DropZone3 {
  const edge = Math.min(rect.height / 3, Math.max(6, rect.height * 0.25));
  const y = clientY - rect.top;
  if (y < edge) return "above";
  if (y > rect.height - edge) return "below";
  return "into";
}

/**
 * Resolve a drop edge against an ORDERED sibling-id list to the `beforeId`
 * argument `moveDatasetToFolder`/`moveFolder` expect: "above" inserts right
 * at `targetId`; "below" resolves to whatever sibling id comes right after it
 * (undefined = append, when `targetId` is already last). `targetId` not being
 * found in `siblingIds` (a stale row) also resolves to undefined (append) —
 * safe degrade rather than a thrown error mid-drop.
 */
export function resolveDropBeforeId(
  siblingIds: readonly string[],
  targetId: string,
  edge: DropEdge,
): string | undefined {
  if (edge === "above") return targetId;
  const i = siblingIds.indexOf(targetId);
  if (i < 0) return undefined;
  return siblingIds[i + 1];
}
