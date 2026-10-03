import type { Dataset, FolderNode } from "./types";
import type { WorkbookNode } from "./workbooks";
import { folderPathLabelIndex } from "./foldertree";

export const BATCH_ALL_WORKBOOKS = "all";
export const BATCH_LOOSE_WORKSHEETS = "loose";

export interface BatchDatasetFilterInput {
  datasets: readonly Dataset[];
  workbooks: readonly WorkbookNode[];
  folders: readonly FolderNode[];
  workbookScope: string;
  query: string;
}

/** Build every breadcrumb once for both search and row captions. Parent
 * cycles and broken links stop locally rather than hanging an imported tree. */
export const batchFolderLabels = folderPathLabelIndex;

export function validBatchWorkbookScope(scope: string, workbooks: readonly WorkbookNode[]): string {
  if (scope === BATCH_ALL_WORKBOOKS || scope === BATCH_LOOSE_WORKSHEETS) return scope;
  return workbooks.some((workbook) => workbook.id === scope) ? scope : BATCH_ALL_WORKBOOKS;
}

/** Project-aware filtering for Batch Figure Builder. Search includes the
 * worksheet, workbook/folder path, tags, and column labels so an imported
 * Origin project can be narrowed by the names users actually recognize. */
export function filterBatchDatasets(input: BatchDatasetFilterInput): Dataset[] {
  const workbooks = new Map(input.workbooks.map((workbook) => [workbook.id, workbook]));
  const folderLabels = batchFolderLabels(input.folders);
  const needle = input.query.trim().toLocaleLowerCase();
  return input.datasets.filter((dataset) => {
    if (input.workbookScope === BATCH_LOOSE_WORKSHEETS && dataset.workbookId) return false;
    if (
      input.workbookScope !== BATCH_ALL_WORKBOOKS &&
      input.workbookScope !== BATCH_LOOSE_WORKSHEETS &&
      dataset.workbookId !== input.workbookScope
    ) return false;
    if (!needle) return true;

    const workbook = dataset.workbookId ? workbooks.get(dataset.workbookId) : undefined;
    const folderId = workbook?.folderId ?? dataset.folderId ?? null;
    const searchable = [
      dataset.name,
      workbook?.name,
      folderId === null ? "" : folderLabels.get(folderId),
      ...(dataset.tags ?? []),
      ...dataset.data.labels,
    ].filter((value): value is string => typeof value === "string");
    return searchable.some((value) => value.toLocaleLowerCase().includes(needle));
  });
}

/** Add/remove only the visible filter result. Selections outside the current
 * workbook/search stay untouched, which makes composing a cross-book batch
 * predictable instead of destructive. */
export function setShownBatchSelection(
  selected: readonly string[],
  shown: readonly Dataset[],
  on: boolean,
): string[] {
  const shownIds = new Set(shown.map((dataset) => dataset.id));
  if (!on) return selected.filter((id) => !shownIds.has(id));
  const next = [...selected];
  const selectedIds = new Set(selected);
  for (const dataset of shown) {
    if (!selectedIds.has(dataset.id)) next.push(dataset.id);
  }
  return next;
}
