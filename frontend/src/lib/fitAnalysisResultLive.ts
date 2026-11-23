import type { AnalysisResult } from "./analysisResult";
import { dataFingerprint } from "./analysisResultFreshness";
import { fitResultInputs } from "./fitResultInputs";
import { INPUTS_PARAM, recordFingerprint } from "./resultInputsRecord";
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

/** The current plot binding comes from the live FitSpec authority. Persisted
 * envelope indices are only a launch snapshot and may be stale after columns
 * are inserted, removed, or remapped. */
export function liveFitPlotBinding(result: AnalysisResult, dataset: Dataset): {
  datasetId: string;
  channels: number[];
  /** Absent = a legacy fit that never recorded its X: the plot keeps its X, and
   *  the fit is refused there (lib/fitDrawBinding, asked by store/analysisResultPlotOpen). */
  xChannel?: number | null;
} | null {
  if (result.settingsRef?.field !== "fitSpec" || result.settingsRef.datasetId !== dataset.id || !dataset.fitSpec) return null;
  const yKey = yKeyFor(dataset, dataset.fitSpec);
  const xKey = xKeyFor(dataset, dataset.fitSpec);
  if (yKey === null) return null;
  return { datasetId: dataset.id, channels: [yKey], ...(xKey === undefined ? {} : { xChannel: xKey }) };
}

export function fitAnalysisResult(
  dataset: Dataset,
  spec: FitSpec,
  createdAt = spec.fittedAt ?? new Date().toISOString(),
  /** Record the C9 inputs (lib/fitResultInputs.ts). Only where the fit was just
   *  computed or recomputed on the live data: a catalog migration of an old file
   *  (the data may have changed since) and a warnings-only read pass false. */
  options: { inputs?: boolean } = {},
): AnalysisResult {
  const inputs = options.inputs === false ? undefined : fitResultInputs(dataset, spec);
  const fingerprint = recordFingerprint("fitSpec", spec);
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
    // Points at the Dataset.fitSpec authority (never a copy) and the record it was (lib/resultInputsRecord.ts).
    settingsRef: { datasetId: dataset.id, field: "fitSpec", ...(fingerprint ? { fingerprint } : {}) },
    ...(inputs !== undefined ? { parameters: { [INPUTS_PARAM]: inputs } } : {}),
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
    sourceFingerprint: dataFingerprint(dataset.data),
    createdAt,
    ...(spec.recomputedAt
      ? { updatedAt: spec.recomputedAt }
      : spec.fittedAt && spec.fittedAt !== createdAt ? { updatedAt: spec.fittedAt } : {}),
  };
}

/** Refresh the presentation envelope after a fit changes while preserving
 * user-owned identity, name, notes, and creation time. */
export function refreshFitAnalysisResults(
  existing: readonly AnalysisResult[],
  dataset: Dataset,
  createIfMissing = true,
): AnalysisResult[] {
  const linked = existing.filter((result) => isFitResultForDataset(result, dataset.id));
  const spec = dataset.fitSpec;
  if (!spec) return [...existing];
  if (!linked.length) return createIfMissing ? [...existing, fitAnalysisResult(dataset, spec)] : [...existing];
  return existing.map((result) => {
    if (!isFitResultForDataset(result, dataset.id)) return result;
    const fresh = fitAnalysisResult(dataset, spec, result.createdAt);
    return {
      ...fresh, id: result.id, name: result.name, createdAt: result.createdAt,
      ...(result.notes ? { notes: result.notes } : {}),
    };
  });
}

export const isFitResultForDataset = (result: AnalysisResult, datasetId: string): boolean =>
  (result.settingsRef?.field === "fitSpec" && result.settingsRef.datasetId === datasetId)
  || (result.settingsRef === undefined && result.producer.id === "curve-fit" && result.sources.length === 1 &&
    result.sources[0].datasetId === datasetId);
