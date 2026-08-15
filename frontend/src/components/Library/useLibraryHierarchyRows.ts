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
  type LibraryNodeKey,
} from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";

export function useLibraryHierarchyRows(): FlatLibraryNode[] {
  const folders = useApp((s) => s.folders);
  const workbooks = useApp((s) => s.workbooks);
  const datasets = useApp((s) => s.datasets);
  const originFigures = useApp((s) => s.originFigures);
  const editableFigures = useApp((s) => s.editableFigures);
  const publicationFigures = useApp((s) => s.figureDocs);
  const pages = useApp((s) => s.pages);
  const reports = useApp((s) => s.reports);
  const expandedFolders = useApp((s) => s.expandedFolders);
  const expandedWorkbookIds = useApp((s) => s.expandedWorkbookIds);

  const hierarchy = useMemo(
    () =>
      buildLibraryHierarchy({
        folders,
        workbooks,
        datasets,
        originFigures,
        editableFigures,
        publicationFigures,
        pages,
        reports,
      }),
    [folders, workbooks, datasets, originFigures, editableFigures, publicationFigures, pages, reports],
  );

  const expandedKeys = useMemo(() => {
    const keys = new Set<LibraryNodeKey>();
    for (const id of expandedFolders) keys.add(`folder:${id}`);
    for (const id of expandedWorkbookIds) keys.add(`workbook:${id}`);
    return keys;
  }, [expandedFolders, expandedWorkbookIds]);

  return useMemo(() => flattenLibraryHierarchy(hierarchy, expandedKeys), [hierarchy, expandedKeys]);
}
