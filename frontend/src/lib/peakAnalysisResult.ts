import type { AnalysisResult } from "./analysisResult";
import type { PeakTable } from "./peakTable";
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

export function peakAnalysisResult(
  dataset: Dataset,
  table: PeakTable,
  yKey?: number | null,
  xKey?: number | null,
): AnalysisResult {
  const plotted = validYKey(dataset, yKey);
  const plottedX = validXKey(dataset, table, xKey);
  return {
    version: 1,
    id: peakResultId(dataset.id),
    name: `Peak analysis · ${dataset.name}`,
    producer: { id: "peak-analysis", label: "Peak Analysis", version: 1 },
    sources: [{ datasetId: dataset.id, role: "input" }],
    outputs: [],
    settingsRef: { datasetId: dataset.id, field: "peakTable" },
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
