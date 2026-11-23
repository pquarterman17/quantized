// What a committed result records about each of its inputs (result-lifecycle
// acceptance, criterion 9): the source worksheet, its channels with units, how
// many rows the analysis view included out of how many, and the X range those
// rows span. Written once by the shared commit contract (committedOutputResult)
// so EVERY "add output" writer records it, whatever its own settings carry.
// The inputs are as the computation saw them: the commit refuses unless the
// source's analysis view still matches (store/analysisOutputCommit.ts).

import type { AnalysisResult, AnalysisResultValue } from "./analysisResult";
import { analysisData } from "./rowstate";
import type { Dataset } from "./types";

/** Envelope `parameters` key of the recorded inputs (one entry per source, in source order). */
export const INPUTS_PARAM = "inputs";

/** The sanitizer on reopen drops a result's whole `parameters` when the tree passes
 *  its node budget (lib/analysisResult.ts: 100,000 nodes, 10,000 per array). A batch
 *  trend over hundreds of wide worksheets would pass it and lose its commit key and
 *  reopen record, so the record is capped: the first MAX_RECORDED_INPUTS sources, the
 *  first MAX_RECORDED_CHANNELS channels of each, plus the true counts. */
export const MAX_RECORDED_INPUTS = 32;
export const MAX_RECORDED_CHANNELS = 64;

export function recordedInputs(sources: readonly Dataset[]): AnalysisResultValue {
  return { total: sources.length, items: sources.slice(0, MAX_RECORDED_INPUTS).map(recordedInput) };
}

export function recordedInput(source: Dataset): AnalysisResultValue {
  const view = analysisData(source) ?? source.data;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of view.time) {
    if (Number.isFinite(x)) {
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  }
  const meta = source.data.metadata ?? {};
  const xName = meta["x_column_name"];
  const xUnit = meta["x_column_unit"];
  return {
    datasetId: source.id,
    name: source.name,
    channelCount: source.data.labels.length,
    channels: source.data.labels.slice(0, MAX_RECORDED_CHANNELS).map((label, index) => ({ index, label, unit: source.data.units[index] ?? "" })),
    xLabel: typeof xName === "string" ? xName : null,
    xUnit: typeof xUnit === "string" ? xUnit : null,
    rows: source.data.time.length,
    includedRows: view.time.length,
    xRange: lo <= hi ? [lo, hi] : null,
  };
}

/** `parameters` with the recorded inputs left out, for "is this the same run?"
 *  comparisons. The record describes the input, derived from the same data the
 *  source fingerprint already covers, so it never decides identity: results saved
 *  before it existed must still match an identical re-run. */
export function parametersWithoutInputs(parameters: AnalysisResult["parameters"]): unknown {
  if (!parameters || !(INPUTS_PARAM in parameters)) return parameters;
  const { [INPUTS_PARAM]: _recorded, ...rest } = parameters;
  return rest;
}
