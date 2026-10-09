import type { AnalysisResult } from "./analysisResult";
import type { Dataset, FitSpec } from "./types";

/** Small eager half of the curve-fit adapter. setFitSpec is a synchronous
 * store action, so result registration must be synchronous too; migrations
 * stay in the lazy sibling module to keep them out of startup. */
export const fitResultId = (datasetId: string): string => `analysis-fit-${datasetId}`;

function yKeyFor(dataset: Dataset, spec: FitSpec): number | null {
  if (spec.yKey !== undefined && Number.isInteger(spec.yKey) && spec.yKey >= 0 && spec.yKey < dataset.data.labels.length) {
    return spec.yKey;
  }
  return dataset.data.labels.length === 1 ? 0 : null;
}

function xKeyFor(dataset: Dataset, spec: FitSpec): number | null | undefined {
  if (spec.xKey === null) return null;
  if (spec.xKey !== undefined && Number.isInteger(spec.xKey) && spec.xKey >= 0 && spec.xKey < dataset.data.labels.length) {
    return spec.xKey;
  }
  return spec.xKey === undefined ? undefined : null;
}

export function fitAnalysisResult(
  dataset: Dataset,
  spec: FitSpec,
  createdAt = spec.fittedAt ?? new Date().toISOString(),
): AnalysisResult {
  const yKey = yKeyFor(dataset, spec);
  const xKey = xKeyFor(dataset, spec);
  const warnings = [
    ...(spec.exitFlag === 0 ? ["The optimizer did not report convergence."] : []),
    ...(!spec.params?.length ? ["This legacy fit does not include fitted parameter values."] : []),
    ...(yKey === null ? ["The fitted Y channel is not recorded unambiguously."] : []),
    ...(xKey === undefined ? ["The fitted X axis is not recorded unambiguously."] : []),
  ];
  return {
    version: 1,
    id: fitResultId(dataset.id),
    name: `${spec.model} fit · ${dataset.name}`,
    producer: { id: "curve-fit", label: "Curve Fit", version: 1 },
    sources: [{ datasetId: dataset.id, role: "input" }],
    outputs: [],
    settingsRef: { datasetId: dataset.id, field: "fitSpec" },
    ...(yKey === null ? {} : {
      selection: {
        datasetId: dataset.id,
        channels: [{
          index: yKey,
          label: dataset.data.labels[yKey] ?? `Channel ${yKey + 1}`,
          unit: dataset.data.units[yKey] ?? "",
        }],
        ...(spec.range ? { xRange: spec.range } : {}),
      },
      ...(xKey === undefined ? {} : { plotBindings: [{
        datasetId: dataset.id,
        channels: [yKey],
        xChannel: xKey,
      }] }),
    }),
    warnings,
    createdAt,
    ...(spec.recomputedAt
      ? { updatedAt: spec.recomputedAt }
      : spec.fittedAt && spec.fittedAt !== createdAt ? { updatedAt: spec.fittedAt } : {}),
  };
}

export const isFitResultForDataset = (result: AnalysisResult, datasetId: string): boolean =>
  (result.settingsRef?.field === "fitSpec" && result.settingsRef.datasetId === datasetId)
  || (result.settingsRef === undefined && result.producer.id === "curve-fit" && result.sources.length === 1 &&
    result.sources[0].datasetId === datasetId);
