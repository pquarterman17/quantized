import { openWorksheet } from "./worksheetOpen";

/** Open a statistical result's source worksheet with its contributing rows
 * selected. Freshness and row validity are checked by the result panel before
 * this navigation-only command is called. */
export function openAnalysisSourceRows(datasetId: string, rows: number[]): void {
  openWorksheet({ datasetId, rowIds: rows });
}
