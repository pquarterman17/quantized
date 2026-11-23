import type { AnalysisResult, AnalysisResultValue } from "./analysisResult";
import type { PeakTable } from "./peakTable";
import { peakTableMatchesData } from "./peakTableFreshness";
import { INPUTS_PARAM, recordedInputs, recordFingerprint } from "./resultInputsRecord";
import { analysisView } from "./rowstate";
import type { Dataset } from "./types";

/** One catalog record per dataset peak table. The table on Dataset remains the
 * scientific authority; this stable id lets a re-fit update the same Library
 * item without multiplying results. */
export const peakResultId = (datasetId: string): string => `analysis-peaks-${datasetId}`;

function validYKey(dataset: Dataset, yKey: number | null | undefined): number | null {
  if (yKey !== null && yKey !== undefined && Number.isInteger(yKey) && yKey >= 0 && yKey < dataset.data.labels.length) {
    return yKey;
  }
  // A legacy table did not record its Y column. With exactly one value column
  // there is no ambiguity; otherwise omit the figure binding rather than open
  // a scientifically unrelated curve.
  return dataset.data.labels.length === 1 ? 0 : null;
}

function validXKey(dataset: Dataset, table: PeakTable, xKey: number | null | undefined): number | null | undefined {
  if (xKey === null) return null;
  if (xKey !== undefined && Number.isInteger(xKey) && xKey >= 0 && xKey < dataset.data.labels.length) return xKey;
  const provenance = table.provenance;
  const timeLabel = String(dataset.data.metadata?.["x_column_long"] || dataset.data.metadata?.["x_column_name"] || "x");
  const timeUnit = String(dataset.data.metadata?.["x_column_unit"] ?? "");
  if (provenance.xLabel === timeLabel && provenance.xUnit === timeUnit) return null;
  const matches = dataset.data.labels.flatMap((label, index) =>
    label === provenance.xLabel && (dataset.data.units[index] ?? "") === provenance.xUnit ? [index] : [],
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** C9 inputs of a peak table (acceptance C9, audit row 35): the analysis view
 *  the fit read (narrowed to its recorded rows, if any), with the X it ran on.
 *  Only while the table's own data fingerprint still matches the source: a
 *  legacy table without one, or changed data, records nothing (fail closed).
 *  Scope of the claim: the VIEW (and recorded rows) the fit was offered. A
 *  method "independent" table fits one window per seed and does not store those
 *  windows (`PeakTableProvenance` has none), so the rows each peak actually
 *  used are narrower than this record and are NOT restated here. */
function peakResultInputs(dataset: Dataset, table: PeakTable, xKey: number | null | undefined): AnalysisResultValue | undefined {
  if (dataset.pending || table.provenance.fingerprint === null || !peakTableMatchesData(table, dataset)) return undefined;
  const view = analysisView(dataset);
  if (!view.data) return undefined;
  const wanted = table.provenance.rowIds ? new Set(table.provenance.rowIds) : null;
  const rows = view.data.time.map((_x, index) => index)
    .filter((index) => !wanted || wanted.has(view.rowIds ? view.rowIds[index]! : index));
  const data = wanted ? { ...view.data, time: rows.map((i) => view.data!.time[i]!), values: rows.map((i) => view.data!.values[i]!) } : view.data;
  return recordedInputs([dataset], { xKey, views: [data] });
}

export function peakAnalysisResult(
  dataset: Dataset,
  table: PeakTable,
  yKey?: number | null,
  xKey?: number | null,
): AnalysisResult {
  const plotted = validYKey(dataset, yKey);
  const plottedX = validXKey(dataset, table, xKey);
  const inputs = peakResultInputs(dataset, table, plottedX);
  const fingerprint = recordFingerprint("peakTable", table);
  return {
    version: 1,
    id: peakResultId(dataset.id),
    name: `Peak analysis · ${dataset.name}`,
    producer: { id: "peak-analysis", label: "Peak Analysis", version: 1 },
    sources: [{ datasetId: dataset.id, role: "input" }],
    outputs: [],
    // Points at the Dataset.peakTable authority (never a copy) and the record it was (lib/resultInputsRecord.ts).
    settingsRef: { datasetId: dataset.id, field: "peakTable", ...(fingerprint ? { fingerprint } : {}) },
    ...(inputs !== undefined ? { parameters: { [INPUTS_PARAM]: inputs } } : {}),
    ...(plotted === null ? {} : {
      selection: {
        datasetId: dataset.id,
        channels: [{
          index: plotted,
          label: dataset.data.labels[plotted] ?? `Channel ${plotted + 1}`,
          unit: dataset.data.units[plotted] ?? "",
        }],
      },
      plotBindings: [{
        datasetId: dataset.id,
        channels: [plotted],
        ...(plottedX !== undefined ? { xChannel: plottedX } : {}),
      }],
    }),
    warnings: [],
    createdAt: table.provenance.fittedAt,
  };
}

/** Add peak-table catalog records to a pre-adapter workspace exactly once.
 * Existing envelopes win, preserving user names/notes and explicit records. */
export function migratePeakAnalysisResults(
  datasets: readonly Dataset[],
  existing: readonly AnalysisResult[],
): AnalysisResult[] {
  const ids = new Set(existing.map((result) => result.id));
  const linkedDatasets = new Set(existing.flatMap((result) =>
    result.settingsRef?.field === "peakTable" ? [result.settingsRef.datasetId] : [],
  ));
  const migrated = datasets.flatMap((dataset) => {
    if (!dataset.peakTable || ids.has(peakResultId(dataset.id)) || linkedDatasets.has(dataset.id)) return [];
    return [peakAnalysisResult(dataset, dataset.peakTable)];
  });
  return [...existing, ...migrated];
}
