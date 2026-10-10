import type { AnalysisResult } from "../lib/analysisResult";
import { isSnapshotResult, snapshotResultState } from "../lib/analysisResultFreshness";
import { reportEmit } from "../lib/api";
import { csvBlob } from "../lib/csvCell";
import { saveBlob } from "../lib/download";
import { stemFromName } from "../lib/exportActive";
import { outputToCSV } from "../lib/statsTestsResults";
import type { Dataset } from "../lib/types";
import { addReportWithProvenance } from "./addReportWithProvenance";
import { useApp } from "./useApp";

/** Export the compact tables owned directly by a snapshot-style result. */
export function exportAnalysisInlineTables(id: string): boolean {
  const state = useApp.getState();
  const result = state.analysisResults.find((item) => item.id === id);
  if (!result?.tables?.length) {
    state.setStatus(`can't export ${result?.name ?? "analysis result"}: it has no saved tables`);
    return false;
  }
  const sentence = typeof result.scalarValues?.Interpretation === "string"
    ? result.scalarValues.Interpretation : result.name;
  const filename = stemFromName(result.name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "") || "analysis-result";
  saveBlob(csvBlob(outputToCSV({ sentence, tables: result.tables })), `${filename}.csv`);
  state.setStatus(`exported ${result.tables.length} result table${result.tables.length === 1 ? "" : "s"}`);
  return true;
}

function snapshotCurrent(result: AnalysisResult, datasets: readonly Dataset[]): boolean {
  return !!result.tables?.length && result.outputs.length === 0 && isSnapshotResult(result) &&
    snapshotResultState(result, datasets) === "current";
}

/** Send the primary saved statistics table through the established report
 * renderer. Re-check source freshness and result identity after the request so
 * an edit or deletion in flight cannot publish stale numbers. */
export async function sendAnalysisInlineTableToReport(id: string): Promise<boolean> {
  const initial = useApp.getState();
  const result = initial.analysisResults.find((item) => item.id === id);
  const tables = result?.tables;
  const table = tables?.[0];
  if (!result || !tables || !table) return false;
  if (!snapshotCurrent(result, initial.datasets)) {
    initial.setStatus(`can't add ${result.name} to report: its source is missing or out of date`);
    return false;
  }
  try {
    const { report } = await reportEmit({
      kind: "stats_table",
      records: table.rows.map((row) => Object.fromEntries(table.columns.map((column, index) => [column || "row", row[index]]))),
      columns: table.columns.map((column) => column || "row"),
      title: result.name,
      caption: typeof result.scalarValues?.Interpretation === "string" ? result.scalarValues.Interpretation : "",
      source_refs: result.sources.map((source) => ({ kind: "dataset" as const, id: source.datasetId,
        name: initial.datasets.find((dataset) => dataset.id === source.datasetId)?.name ?? source.datasetId })),
    });
    const current = useApp.getState();
    const live = current.analysisResults.find((item) => item.id === id);
    // The rendered sheet embeds the pre-await title, so a rename in flight is a
    // change too: publishing would label the Report list and sheet differently.
    if (!live || live.tables !== tables || live.name !== result.name ||
        !snapshotCurrent(live, current.datasets)) {
      current.setStatus("can't add analysis result to report: the result or its source changed while rendering");
      return false;
    }
    addReportWithProvenance(live.name, report, live.sources[0]?.datasetId ?? null);
    return true;
  } catch (error) {
    useApp.getState().setStatus(`could not add analysis result to report — ${error instanceof Error ? error.message : "unknown error"}`);
    return false;
  }
}
