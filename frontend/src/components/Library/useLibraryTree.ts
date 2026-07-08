// View-model for the Library folder tree (project-organization plan item 3).
// Flattens the folder tree + flat dataset array into an ordered list of render
// rows (folder headers + dataset rows + figure rows, each with a depth) that the
// Library maps straight to components. Folders-first at every level, then
// datasets, then that folder's figures; a folder's subtree is emitted only when
// it's expanded. Pure `buildTreeRows` is unit-tested; `useLibraryTree` is the
// thin store-bound hook.

import { useMemo } from "react";

import { childFolders, folderDatasets } from "../../lib/foldertree";
import type { OriginFigureEntry } from "../../lib/originFigures";
import type { Dataset, FolderNode } from "../../lib/types";
import { useApp } from "../../store/useApp";

/** dataTransfer type for an internal dataset drag (row → folder, or row →
 *  drop-between-rows to reorder — plan item 3b). Distinct from an OS file
 *  drop, so the Library's file-import handler can ignore these. */
export const DATASET_DND = "application/x-qz-dataset";

/** dataTransfer type for an internal folder drag (folder header → folder
 *  header, for reparent/reposition — plan item 3b). Distinct from
 *  DATASET_DND so a drop target can tell a dragged folder from a dragged
 *  dataset without decoding the payload (only `types` is readable during
 *  dragover; the payload itself is only readable on drop). */
export const FOLDER_DND = "application/x-qz-folder";

export type TreeRow =
  | {
      kind: "folder";
      id: string;
      folder: FolderNode;
      depth: number;
      count: number;
      empty: boolean;
      expanded: boolean;
    }
  | { kind: "dataset"; id: string; dataset: Dataset; depth: number }
  | { kind: "figure"; id: string; entry: OriginFigureEntry; depth: number };

/** Flatten the tree into render order: at each level, child folders (each
 *  followed by its own subtree when expanded), then that level's datasets, then
 *  that level's figures (Origin's Project Explorer shows books then graphs). */
export function buildTreeRows(
  folders: FolderNode[],
  datasets: Dataset[],
  expanded: ReadonlySet<string>,
  figures: OriginFigureEntry[] = [],
): TreeRow[] {
  const rows: TreeRow[] = [];

  // Home each figure to its bound dataset's folder; an unresolved figure
  // (datasetId null) falls back to the folder of the first sibling dataset from
  // the same import, so it still lands in its project's subtree. `null` = root.
  const folderOf = new Map<string, string | null>();
  for (const d of datasets) folderOf.set(d.id, d.folderId ?? null);
  const figureHome = (f: OriginFigureEntry): string | null => {
    if (f.datasetId != null && folderOf.has(f.datasetId)) return folderOf.get(f.datasetId) ?? null;
    for (const sid of f.siblingIds) if (folderOf.has(sid)) return folderOf.get(sid) ?? null;
    return null;
  };
  const figuresByFolder = new Map<string | null, OriginFigureEntry[]>();
  for (const f of figures) {
    const home = figureHome(f);
    const list = figuresByFolder.get(home);
    if (list) list.push(f);
    else figuresByFolder.set(home, [f]);
  }

  // Recursive dataset count over a folder's whole subtree (for the count chip).
  const subtreeCount = (fid: string): number => {
    let n = folderDatasets(datasets, fid).length;
    for (const c of childFolders(folders, fid)) n += subtreeCount(c.id);
    return n;
  };

  const emitLevel = (parentId: string | null, depth: number) => {
    for (const f of childFolders(folders, parentId)) {
      const empty =
        childFolders(folders, f.id).length === 0 && folderDatasets(datasets, f.id).length === 0;
      const isOpen = expanded.has(f.id);
      rows.push({
        kind: "folder",
        id: f.id,
        folder: f,
        depth,
        count: subtreeCount(f.id),
        empty,
        expanded: isOpen,
      });
      if (isOpen) emitLevel(f.id, depth + 1);
    }
    for (const d of folderDatasets(datasets, parentId)) {
      rows.push({ kind: "dataset", id: d.id, dataset: d, depth });
    }
    for (const fig of figuresByFolder.get(parentId) ?? []) {
      rows.push({ kind: "figure", id: fig.id, entry: fig, depth });
    }
  };

  emitLevel(null, 0);
  return rows;
}

/** Store-bound tree view-model. Recomputes on folder/dataset/figure/expansion. */
export function useLibraryTree(): TreeRow[] {
  const datasets = useApp((s) => s.datasets);
  const folders = useApp((s) => s.folders);
  const expandedFolders = useApp((s) => s.expandedFolders);
  const figures = useApp((s) => s.originFigures);
  return useMemo(
    () => buildTreeRows(folders, datasets, new Set(expandedFolders), figures),
    [folders, datasets, expandedFolders, figures],
  );
}
