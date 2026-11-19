import type { AnalysisResult, AnalysisResultTable } from "./analysisResult";
import type { Dataset } from "./types";

/** One output a result owns that "Freeze" could turn into an independent
 *  worksheet. Enumeration is pure and read-only: it never touches the result
 *  or its linked worksheets. */
export interface FreezeOutput {
  /** Stable within a result: `ds:<datasetId>` or `tbl:<index>`. */
  key: string;
  label: string;
  kind: "Linked worksheet" | "Result table";
  rows: number;
  cols: number;
  freezable: boolean;
  /** Why it cannot be frozen (shown beside the disabled choice). */
  reason?: string;
  /** Identity of the live data this entry was read from (dataset.data or the
   *  saved table object). The freeze action re-reads and refuses on mismatch,
   *  so a result that changes while the user is choosing fails closed. */
  ref: object;
}

type Adapter = (result: AnalysisResult, datasets: readonly Dataset[]) => FreezeOutput[];

/** Linked worksheets (`outputs` plus `tableRefs`), deduplicated, in record order. */
export const linkedWorksheetOutputs: Adapter = (result, datasets) => {
  const entries = [
    ...result.outputs.map((output) => ({ datasetId: output.datasetId, label: undefined as string | undefined })),
    ...(result.tableRefs ?? []).map((ref) => ({ datasetId: ref.datasetId, label: ref.label })),
  ];
  const out: FreezeOutput[] = [];
  for (const entry of entries) {
    if (out.some((item) => item.key === `ds:${entry.datasetId}`)) continue;
    const dataset = datasets.find((item) => item.id === entry.datasetId);
    if (!dataset) continue; // an unresolved reference is a diagnostic, not a choice
    out.push({
      key: `ds:${dataset.id}`, label: entry.label || dataset.name, kind: "Linked worksheet",
      rows: dataset.data.time.length, cols: dataset.data.labels.length,
      freezable: !!dataset.derivedFrom,
      ...(dataset.derivedFrom ? {} : { reason: "already independent" }),
      ref: dataset.data,
    });
  }
  return out;
};

/** Numeric/blank-only tables become worksheets; a table with text cells has no
 *  faithful worksheet form here, so it is listed but not offered. */
function tableReason(table: AnalysisResultTable): string | undefined {
  if (!table.rows.length || !table.columns.length) return "empty table";
  return table.rows.every((row) => row.every((cell) => cell === null || typeof cell === "number"))
    ? undefined : "contains text cells";
}

/** Saved inline tables (`result.tables`), one output per table. */
export const inlineTableOutputs: Adapter = (result) => (result.tables ?? []).map((table, index) => {
  const reason = tableReason(table);
  return {
    key: `tbl:${index}`, label: table.title || `Table ${index + 1}`, kind: "Result table" as const,
    rows: table.rows.length, cols: table.columns.length, freezable: !reason,
    ...(reason ? { reason } : {}), ref: table,
  };
});

const both: Adapter = (result, datasets) => [...linkedWorksheetOutputs(result, datasets), ...inlineTableOutputs(result, datasets)];
/** Producers whose data lives on the source worksheet (peak table, fit spec,
 *  reflectivity record) own no result-level output; nothing is guessed. */
const none: Adapter = () => [];

/** Per-producer output enumeration, as data: a new producer plugs in with one
 *  entry. Unknown producers fall back to their linked worksheets only. */
export const FREEZE_ADAPTERS: Readonly<Record<string, Adapter>> = {
  "signal-processing": linkedWorksheetOutputs,
  "statistical-test": both,
  "distribution-analysis": both,
  "fit-y-by-x": both,
  "variability-analysis": both,
  "outlier-screening": both,
  "multivariate-analysis": both,
  "williamson-hall": both,
  "williamson-hall-batch": both,
  "analysis-batch": both,
  "peak-analysis": none,
  "curve-fit": none,
  "reflectivity-fit": none,
};

export function enumerateFreezeOutputs(result: AnalysisResult, datasets: readonly Dataset[]): FreezeOutput[] {
  return (FREEZE_ADAPTERS[result.producer.id] ?? linkedWorksheetOutputs)(result, datasets);
}

/** Independent worksheet name: `<result> — <output> (frozen)`. */
export const frozenOutputName = (result: AnalysisResult, output: FreezeOutput): string =>
  `${result.name} — ${output.label} (frozen)`;
