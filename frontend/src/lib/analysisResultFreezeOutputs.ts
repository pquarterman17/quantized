import type { AnalysisResult, AnalysisResultTable } from "./analysisResult";
import type { DataStruct, Dataset } from "./types";

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

/** A table column is numeric (numbers/blanks) or text (stored as a categorical
 *  channel: float codes plus `cat_levels`). A column mixing numbers and strings,
 *  such as a Setting/Value table, is text by nature: its numbers carry over as
 *  their exact decimal text, so no cell is lost or rounded. */
function columnKind(table: AnalysisResultTable, col: number): "numeric" | "text" {
  return table.rows.some((row) => typeof row[col] === "string") ? "text" : "numeric";
}

/** The text a cell of a text column carries (blank / non-finite -> no level). */
function levelText(cell: unknown): string | null {
  if (typeof cell === "string") return cell;
  return typeof cell === "number" && Number.isFinite(cell) ? String(cell) : null;
}

/** Tables become worksheets; text and mixed columns become categorical channels.
 *  Only a boolean or object cell is refused. */
function tableReason(table: AnalysisResultTable): string | undefined {
  if (!table.rows.length || !table.columns.length) return "empty table";
  const odd = table.rows.some((row) => row.some((cell) => cell !== null && cell !== undefined && typeof cell !== "number" && typeof cell !== "string"));
  return odd ? "contains unsupported cells" : undefined;
}

/** Worksheet form of a freezable table: rows numbered 1..n on X, numeric
 *  columns as-is (blank -> NaN), text (and mixed) columns as categorical channels whose
 *  levels are the distinct strings in first-appearance order (blank -> NaN). */
export function tableToDataStruct(table: AnalysisResultTable, metadata: Record<string, unknown>): DataStruct {
  const levels: Record<number, string[]> = {};
  const codes = table.columns.map((_name, col) => {
    if (columnKind(table, col) !== "text") return null;
    const list: string[] = [];
    levels[col] = list;
    return new Map<string, number>();
  });
  const values = table.rows.map((row) => table.columns.map((_name, col) => {
    const cell = row[col];
    const map = codes[col];
    if (map) {
      const text = levelText(cell);
      if (text === null) return Number.NaN;
      if (!map.has(text)) { map.set(text, levels[col].length); levels[col].push(text); }
      return map.get(text)!;
    }
    return typeof cell === "number" ? cell : Number.NaN;
  }));
  return {
    time: table.rows.map((_row, index) => index + 1), values,
    labels: [...table.columns], units: table.columns.map(() => ""),
    metadata: { xLabel: "Row", x_column_name: "Row", ...metadata },
    ...(Object.keys(levels).length ? { cat_levels: levels } : {}),
  };
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
  "fit-model": both,
  "variability-analysis": both,
  "outlier-screening": both,
  "multivariate-analysis": both,
  "williamson-hall": both,
  "williamson-hall-batch": both,
  "analysis-batch": both,
  "time-series-analysis": both,
  "doe-design": both,
  "doe-effects": both,
  "profiler": both,
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
