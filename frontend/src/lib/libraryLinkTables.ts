// Origin "link table" books in the Library. The importer flags a book
// `metadata.origin_link_table` when it holds only `cell://` links (plus their
// row labels) and no numbers: the linked fit-report cells are not decoded, so
// it is a column of unresolved strings (ledger F-118). The Library gathers such
// books under ONE collapsed group per containing folder, named below. Pure and
// derived (never stored); the books stay imported and openable.

import type { Dataset, FolderNode } from "./types";
import type { WorkbookNode } from "./workbooks";

export const LINK_TABLES_GROUP_NAME = "Origin link tables";
export const LINK_TABLES_NOTE = "linked cells not resolved";

export interface LinkTableGroupPlan {
  /** workbook id -> its group id */
  groupOfWorkbook: ReadonlyMap<string, string>;
  /** group id -> containing folder (null = root) and book count */
  groups: ReadonlyMap<string, { folderId: string | null; count: number }>;
}

/** A workbook is a link-table book when it has sheets and EVERY sheet carries
 *  the importer's flag (a mixed book is real content and stays where it is). */
export function planLinkTableGroups(
  workbooks: readonly WorkbookNode[],
  datasets: readonly Dataset[],
  folderById: ReadonlyMap<string, FolderNode>,
): LinkTableGroupPlan {
  const sheetsOf = new Map<string, Dataset[]>();
  for (const d of datasets) {
    if (d.workbookId) sheetsOf.set(d.workbookId, [...(sheetsOf.get(d.workbookId) ?? []), d]);
  }
  const groupOfWorkbook = new Map<string, string>();
  const groups = new Map<string, { folderId: string | null; count: number }>();
  for (const workbook of workbooks) {
    const sheets = sheetsOf.get(workbook.id) ?? [];
    if (sheets.length === 0 || !sheets.every((d) => (d.data.metadata ?? {}).origin_link_table === true)) continue;
    const folderId = workbook.folderId && folderById.has(workbook.folderId) ? workbook.folderId : null;
    const id = `link-tables-${folderId ?? "root"}`;
    const group = groups.get(id) ?? { folderId, count: 0 };
    group.count++;
    groups.set(id, group);
    groupOfWorkbook.set(workbook.id, id);
  }
  return { groupOfWorkbook, groups };
}
