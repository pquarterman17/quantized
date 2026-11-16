// Thin store-bound hook over lib/libraryHierarchy (LIBRARY_WORKBOOK_UX_PLAN
// PR C) — the replacement for the retired useLibraryTree.ts. Builds the one
// canonical hierarchy (folders, workbooks, worksheets, and every artifact
// kind) and flattens it to visible rows using the combined folder + workbook
// expansion state. Memoized like the old hook.

import { useMemo } from "react";

import {
  buildLibraryHierarchy,
  flattenLibraryHierarchy,
  type FlatLibraryNode,
  type LibraryHierarchy,
  type LibraryNodeKey,
} from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";
import { useLibraryStore } from "../../store/hooks/useLibraryStore";

export interface LibraryHierarchyModel {
  hierarchy: LibraryHierarchy;
  rows: FlatLibraryNode[];
}

/** Build the hierarchy once for renderers that need both the complete model
 * and the disclosure-filtered tree rows (Details and Tree respectively).
 *
 * `collapseSingleSheet` (UX8-I): the Library panel passes true so a one-sheet
 * workbook is ONE row; the default keeps the plain workbook/sheet pair for the
 * tree harnesses and any consumer that needs workbook headers. */
export function useLibraryHierarchyModel(collapseSingleSheet = false): LibraryHierarchyModel {
  const folders = useApp((s) => s.folders);
  const workbooks = useApp((s) => s.workbooks);
  const datasets = useApp((s) => s.datasets);
  const analysisResults = useApp((s) => s.analysisResults);
  const originFigures = useApp((s) => s.originFigures);
  const editableFigures = useApp((s) => s.editableFigures);
  const publicationFigures = useApp((s) => s.figureDocs);
  const pages = useApp((s) => s.pages);
  const reports = useApp((s) => s.reports);
  const expandedFolders = useApp((s) => s.expandedFolders);
  const expandedWorkbookIds = useLibraryStore((s) => s.expandedWorkbookIds);

  const hierarchy = useMemo(
    () =>
      buildLibraryHierarchy({
        folders,
        workbooks,
        datasets,
        analysisResults,
        originFigures,
        editableFigures,
        publicationFigures,
        pages,
        reports,
      }),
    [folders, workbooks, datasets, analysisResults, originFigures, editableFigures, publicationFigures, pages, reports],
  );

  const expandedKeys = useMemo(() => {
    const keys = new Set<LibraryNodeKey>();
    for (const id of expandedFolders) keys.add(`folder:${id}`);
    for (const id of expandedWorkbookIds) keys.add(`workbook:${id}`);
    return keys;
  }, [expandedFolders, expandedWorkbookIds]);

  const rows = useMemo(() => flattenLibraryHierarchy(hierarchy, expandedKeys, collapseSingleSheet), [hierarchy, expandedKeys, collapseSingleSheet]);
  return useMemo(() => ({ hierarchy, rows }), [hierarchy, rows]);
}

/** Compatibility hook for the tree harness and small consumers that only
 * need visible rows. Library.tsx uses useLibraryHierarchyModel so it does not
 * build the canonical hierarchy twice when Details is available. */
export function useLibraryHierarchyRows(): FlatLibraryNode[] {
  return useLibraryHierarchyModel().rows;
}
