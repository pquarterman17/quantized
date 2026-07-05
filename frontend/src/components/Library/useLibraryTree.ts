// View-model for the Library folder tree (project-organization plan item 3).
// Flattens the folder tree + flat dataset array into an ordered list of render
// rows (folder headers + dataset rows, each with a depth) that the Library maps
// straight to components. Folders-first at every level, then datasets; a folder's
// subtree is emitted only when it's expanded. Pure `buildTreeRows` is unit-tested;
// `useLibraryTree` is the thin store-bound hook.

import { useMemo } from "react";

import { childFolders, folderDatasets } from "../../lib/foldertree";
import type { Dataset, FolderNode } from "../../lib/types";
import { useApp } from "../../store/useApp";

/** dataTransfer type for an internal dataset drag (row → folder). Distinct from
 *  an OS file drop, so the Library's file-import handler can ignore these. */
export const DATASET_DND = "application/x-qz-dataset";

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
  | { kind: "dataset"; id: string; dataset: Dataset; depth: number };

/** Flatten the tree into render order: at each level, child folders (each
 *  followed by its own subtree when expanded) then that level's datasets. */
export function buildTreeRows(
  folders: FolderNode[],
  datasets: Dataset[],
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];

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
  };

  emitLevel(null, 0);
  return rows;
}

/** Store-bound tree view-model. Recomputes on folder/dataset/expansion change. */
export function useLibraryTree(): TreeRow[] {
  const datasets = useApp((s) => s.datasets);
  const folders = useApp((s) => s.folders);
  const expandedFolders = useApp((s) => s.expandedFolders);
  return useMemo(
    () => buildTreeRows(folders, datasets, new Set(expandedFolders)),
    [folders, datasets, expandedFolders],
  );
}
