// The lazy-only half of lib/foldertree.ts (bundle diet slice 15): the tree
// view's counts and captions, the import reveal, drag-and-drop geometry and
// the `.dwk` folder parse. Only lazy modules call these (the Library tree and
// rows, the Inspector, import, the `.dwk` codec), while the eager store
// slices need just the mutations, so the code moved here verbatim and
// lib/foldertree.ts re-exports it with `export *` - importers are unchanged,
// and Rollup bundles this file with the lazy chunks that use its names.
// architecture.test.ts ("re-exported lazy half") keeps eager modules off it.

import { childFolders, folderDatasets, folderPath } from "./foldertree";
import type { Dataset, FolderNode } from "./types";

/** A folder's whole-subtree DATASET count — the lens every folder bulk
 *  action and destructive confirm states its N in ("Select all (N)",
 *  "Delete folder + N dataset(s)"), independent of workbook nesting (a
 *  workbook is one tree/tile child but many datasets). Hoisted from
 *  LibraryTree.tsx so the Tile workspace's folder menu states the SAME
 *  count as the tree's. */
export function subtreeCount(folders: FolderNode[], datasets: Dataset[], folderId: string): number {
  let n = folderDatasets(datasets, folderId).length;
  for (const c of childFolders(folders, folderId)) n += subtreeCount(folders, datasets, c.id);
  return n;
}

/** Every folder's `subtreeCount` at once, in O(folders + datasets) total
 *  instead of `subtreeCount`'s O(subtree) PER folder (LIBRARY_WORKBOOK_UX_PLAN
 *  "keep folder counts... indexed"): the Tree's row badge used to call
 *  `subtreeCount` once per FOLDER ROW inside its render loop, so a deep/wide
 *  tree re-walked overlapping subtrees from scratch on every render — O(F²)
 *  in the worst case (a folder chain). One bottom-up pass instead: direct
 *  dataset counts per folder (one loop over `datasets`), then a memoized
 *  post-order fold over the folder tree (each folder visited exactly once).
 *  Equal to `subtreeCount(folders, datasets, id)` for every folder id. */
export function subtreeCountIndex(folders: FolderNode[], datasets: Dataset[]): Map<string, number> {
  const direct = new Map<string, number>();
  for (const d of datasets) {
    const fid = d.folderId ?? null;
    if (fid != null) direct.set(fid, (direct.get(fid) ?? 0) + 1);
  }
  // Push into the existing list; never spread-copy it. REVIEW ROUND: this was
  // `childrenOf.set(p, [...(childrenOf.get(p) ?? []), f])`, which reallocates
  // and re-copies the whole sibling list on every insert — O(siblings²) for a
  // WIDE folder, while this function's docstring claimed O(folders + datasets).
  // Its entire purpose is removing a quadratic from the render path, so
  // shipping a different quadratic inside it was self-defeating. `subtreeIds`
  // (lib/foldertree.ts) already built its lists this way.
  const childrenOf = new Map<string | null, FolderNode[]>();
  for (const f of folders) {
    const siblings = childrenOf.get(f.parentId);
    if (siblings) siblings.push(f);
    else childrenOf.set(f.parentId, [f]);
  }
  const totals = new Map<string, number>();
  const visit = (f: FolderNode): number => {
    const cached = totals.get(f.id);
    if (cached !== undefined) return cached;
    let n = direct.get(f.id) ?? 0;
    for (const c of childrenOf.get(f.id) ?? []) n += visit(c);
    totals.set(f.id, n);
    return n;
  };
  for (const f of folders) visit(f);
  return totals;
}

/**
 * Every dataset anywhere in folder `id`'s subtree, in tree RENDER order (each
 * level emits its child folders' subtrees first, then its own datasets —
 * matching the Library tree's own folder-subtree order), so a folder bulk op
 * (item 8) walks datasets in the same order the Library shows them.
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

/** F1 (UX-R3 fix round, store/importDatasets.ts): the expand-state patch that
 *  reveals ONE dataset's ancestor chain — its workbook, plus the folder path
 *  down to that workbook's folder — merged into the existing expand state
 *  without disturbing anything else. `folderId`/`workbookId` come from the
 *  caller's own per-dataset membership map; either may be `undefined` (a
 *  dataset with no folder/workbook membership contributes nothing on that
 *  axis). `undefined`/unknown ids are a no-op via `folderPath`'s own
 *  "missing link" handling (lib/foldertree.ts).
 *
 *  Written for the multi-book Origin import branch: that branch collapses
 *  every folder/workbook it just created (UX-R3, "too many similarly
 *  weighted objects" at project scale), but `addDataset` (called once per
 *  book, before this runs) already left one dataset ACTIVE and SELECTED —
 *  the last book it processed. libraryPanel.ts's `workbookDisclosurePatch`
 *  documents the invariant every OTHER activation path upholds ("the active
 *  dataset's workbook is always disclosed"); collapsing everything post-hoc
 *  broke it here, leaving an invisible active/selected row. Clearing
 *  activation instead would satisfy the invariant by blanking the Stage,
 *  which is worse — so the import reveals just this one chain and leaves
 *  every sibling folder/workbook collapsed.
 *
 *  That caller activates the LAST-processed book, not necessarily Origin's
 *  own "primary" sheet — reassigning activation to the primary book was
 *  considered and skipped: `addDataset` also rebinds the focused plot
 *  window, resets the Stage tab, and clears stale analysis results for the
 *  SPECIFIC dataset it's given, so patching just `activeId`/`selectedIds`
 *  afterward would desync those from the newly "active" dataset, and
 *  reordering the import loop to process the primary book last would also
 *  reorder planOriginImport's first-appearance folder/workbook ordering —
 *  both bigger than this fix's scope. */
export function revealAncestorChain(
  s: { folders: FolderNode[]; expandedFolders: string[]; expandedWorkbookIds: string[] },
  folderId: string | undefined,
  workbookId: string | undefined,
): { expandedFolders: string[]; expandedWorkbookIds: string[] } {
  return {
    expandedFolders: [...new Set([...s.expandedFolders, ...folderPath(s.folders, folderId ?? null).map((f) => f.id)])],
    expandedWorkbookIds:
      workbookId != null && !s.expandedWorkbookIds.includes(workbookId)
        ? [...s.expandedWorkbookIds, workbookId]
        : s.expandedWorkbookIds,
  };
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

/** Every folder breadcrumb from one shared id index. Use this when a view
 * needs captions for many rows: calling `folderPathLabel` per row rebuilds
 * the folder id map each time. Broken links and cycles stop safely. */
export function folderPathLabelIndex(folders: readonly FolderNode[]): Map<string, string> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const labels = new Map<string, string>();
  for (const folder of folders) {
    const names: string[] = [];
    const seen = new Set<string>();
    let current: string | null = folder.id;
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      const node = byId.get(current);
      if (!node) break;
      names.unshift(node.name);
      current = node.parentId;
    }
    labels.set(folder.id, names.join(" › "));
  }
  return labels;
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

// ── .dwk parse boundary ─────────────────────────────────────────────────

/** Validate a folder-node array from an untrusted `.dwk` (drops malformed
 *  entries; reparents a folder to root if its parent is missing).
 *  `notes`/`color`/`defaultTemplate` (plan #13 sub-item 4, Folder
 *  Properties) are additive-optional: present + a non-blank string carries
 *  through, absent/malformed is silently dropped — a legacy .dwk (no such
 *  fields at all) loads exactly as before. Moved from lib/workspace.ts (that
 *  module's own size ratchet) — the folder-tree parse boundary belongs
 *  beside the rest of the folder-tree logic. */
export function parseFolders(v: unknown): FolderNode[] {
  if (!Array.isArray(v)) return [];
  const out: FolderNode[] = [];
  for (const f of v) {
    if (typeof f !== "object" || f === null) continue;
    const o = f as Record<string, unknown>;
    if (
      typeof o.id === "string" &&
      typeof o.name === "string" &&
      (o.parentId === null || typeof o.parentId === "string") &&
      typeof o.order === "number" &&
      Number.isFinite(o.order)
    ) {
      const node: FolderNode = {
        id: o.id,
        name: o.name,
        parentId: (o.parentId as string | null) ?? null,
        order: o.order,
      };
      if (typeof o.notes === "string" && o.notes.trim()) node.notes = o.notes;
      if (typeof o.color === "string" && o.color.trim()) node.color = o.color;
      if (typeof o.defaultTemplate === "string" && o.defaultTemplate.trim()) {
        node.defaultTemplate = o.defaultTemplate;
      }
      out.push(node);
    }
  }
  const ids = new Set(out.map((f) => f.id));
  return out.map((f) => (f.parentId && !ids.has(f.parentId) ? { ...f, parentId: null } : f));
}
