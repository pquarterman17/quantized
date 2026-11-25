import type { AnalysisResult } from "../lib/analysisResult";
import { isSnapshotResult, snapshotResultState } from "../lib/analysisResultFreshness";
import { reportEmit } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { csvBlob } from "../lib/csvCell";
import { saveBlob } from "../lib/download";
import { stemFromName } from "../lib/exportActive";
import { outputToCSV, outputToTSV, tablesToCSV, tablesToTSV } from "../lib/statsTestsResults";
import type { Dataset } from "../lib/types";
import { addReportWithProvenance } from "./addReportWithProvenance";
import { useApp } from "./useApp";

/** Export one or all compact tables owned directly by a snapshot result. */
export function exportAnalysisInlineTables(id: string, tableIndex?: number, expectedTables?: AnalysisResult["tables"]): boolean {
  const state = useApp.getState();
  const result = state.analysisResults.find((item) => item.id === id);
  const tables = result?.tables;
  const oneTable = tableIndex === undefined ? undefined
    : Number.isInteger(tableIndex) && tableIndex >= 0 ? tables?.[tableIndex] : undefined;
  if (!result) {
    state.setStatus("can't export analysis result: it was deleted", "danger");
    return false;
  }
  if (expectedTables && tables !== expectedTables) {
    state.setStatus(`can't export ${result.name}: its saved tables changed; try again`, "danger");
    return false;
  }
  if (!tables?.length || (tableIndex !== undefined && !oneTable)) {
    state.setStatus(`can't export ${result?.name ?? "analysis result"}: the saved table is unavailable`, "danger");
    return false;
  }
  const sentence = tableIndex === undefined && typeof result.scalarValues?.Interpretation === "string"
    ? result.scalarValues.Interpretation : tableIndex === undefined ? result.name : "";
  const selectedTables = oneTable ? [oneTable] : tables;
  const suffix = oneTable ? `-${oneTable.title || `table-${tableIndex! + 1}`}` : "";
  const filename = stemFromName(`${result.name}${suffix}`).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "") || "analysis-result";
  const csv = oneTable ? tablesToCSV(selectedTables) : outputToCSV({ sentence, tables: selectedTables });
  saveBlob(csvBlob(csv), `${filename}.csv`);
  state.setStatus(`exported ${oneTable ? oneTable.title || "result table" : `${tables.length} result table${tables.length === 1 ? "" : "s"}`}`);
  return true;
}

/** Copy either one saved result table or the complete table set as TSV. The
 * table index is validated against the live result at click time so a stale
 * accordion cannot copy a different result after deletion or replacement. */
export async function copyAnalysisInlineTables(id: string, tableIndex?: number, expectedTables?: AnalysisResult["tables"]): Promise<boolean> {
  const state = useApp.getState();
  const result = state.analysisResults.find((item) => item.id === id);
  const tables = result?.tables;
  const oneTable = tableIndex === undefined ? undefined
    : Number.isInteger(tableIndex) && tableIndex >= 0 ? tables?.[tableIndex] : undefined;
  if (!result) {
    state.setStatus("can't copy analysis result: it was deleted", "danger");
    return false;
  }
  if (expectedTables && tables !== expectedTables) {
    state.setStatus(`can't copy ${result.name}: its saved tables changed; try again`, "danger");
    return false;
  }
  if (!tables?.length || (tableIndex !== undefined && !oneTable)) {
    state.setStatus(`can't copy ${result?.name ?? "analysis result"}: the saved table is unavailable`, "danger");
    return false;
  }
  const sentence = tableIndex === undefined && typeof result.scalarValues?.Interpretation === "string"
    ? result.scalarValues.Interpretation : tableIndex === undefined ? result.name : "";
  const text = oneTable ? tablesToTSV([oneTable]) : outputToTSV({ sentence, tables });
  const copied = await copyText(text);
  useApp.getState().setStatus(copied
    ? `copied ${oneTable ? oneTable.title || "result table" : `${tables.length} result table${tables.length === 1 ? "" : "s"}`}`
    : "clipboard unavailable — use Export instead");
  return copied;
}

function snapshotCurrent(result: AnalysisResult, datasets: readonly Dataset[], results: readonly AnalysisResult[]): boolean {
  return !!result.tables?.length && result.outputs.length === 0 && isSnapshotResult(result) &&
    snapshotResultState(result, datasets, results) === "current";
}

/** Send a saved statistics table through the established report renderer:
 * without `tableIndex` the primary (first) table titled with the result's
 * name (the toolbar's "Send summary"); with one, that table titled
 * "<result> · <table>" (a result-book section). Re-check source freshness and
 * result identity after the request so an edit or deletion in flight cannot
 * publish stale numbers. */
export async function sendAnalysisInlineTableToReport(id: string, tableIndex?: number): Promise<boolean> {
  const initial = useApp.getState();
  const result = initial.analysisResults.find((item) => item.id === id);
  const tables = result?.tables;
  const table = tableIndex === undefined ? tables?.[0]
    : Number.isInteger(tableIndex) && tableIndex >= 0 ? tables?.[tableIndex] : undefined;
  if (!result || !tables || !table) {
    if (result && tableIndex !== undefined) initial.setStatus(`can't add ${result.name} to report: the saved table is unavailable`, "danger");
    return false;
  }
  const title = tableIndex === undefined ? result.name : `${result.name} · ${table.title || `Table ${tableIndex + 1}`}`;
  if (!snapshotCurrent(result, initial.datasets, initial.analysisResults)) {
    initial.setStatus(`can't add ${result.name} to report: its source is missing or out of date`, "danger");
    return false;
  }
  try {
    const { report } = await reportEmit({
      kind: "stats_table",
      records: table.rows.map((row) => Object.fromEntries(table.columns.map((column, index) => [column || "row", row[index]]))),
      columns: table.columns.map((column) => column || "row"),
      title,
      // The interpretation describes the summary (first) table; a later table
      // sent on its own carries no caption rather than a misleading one.
      caption: (tableIndex ?? 0) === 0 && typeof result.scalarValues?.Interpretation === "string" ? result.scalarValues.Interpretation : "",
      source_refs: result.sources.map((source) => ({ kind: "dataset" as const, id: source.datasetId,
        name: initial.datasets.find((dataset) => dataset.id === source.datasetId)?.name ?? source.datasetId })),
    });
    const current = useApp.getState();
    const live = current.analysisResults.find((item) => item.id === id);
    // The rendered sheet embeds the pre-await title, so a rename in flight is a
    // change too: publishing would label the Report list and sheet differently.
    if (!live || live.tables !== tables || live.name !== result.name ||
        !snapshotCurrent(live, current.datasets, current.analysisResults)) {
      current.setStatus("can't add analysis result to report: the result or its source changed while rendering", "danger");
      return false;
    }
    addReportWithProvenance(title, report, live.sources[0]?.datasetId ?? null);
    return true;
  } catch (error) {
    useApp.getState().setStatus(`could not add analysis result to report — ${error instanceof Error ? error.message : "unknown error"}`, "danger");
    return false;
  }
}
