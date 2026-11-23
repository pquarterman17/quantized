// What a committed result records about each of its inputs (result-lifecycle
// acceptance, criterion 9): the source worksheet, its channels with units, how
// many rows the analysis view included out of how many, and the X range those
// rows span. Written once by the shared commit contract (committedOutputResult)
// so EVERY "add output" writer records it, whatever its own settings carry.
// The inputs are as the computation saw them: the commit refuses unless the
// source's analysis view still matches (store/analysisOutputCommit.ts).

import type { AnalysisResultValue } from "./analysisResult";
import { analysisData } from "./rowstate";
import type { Dataset } from "./types";

/** Envelope `parameters` key of the recorded inputs (one entry per source, in source order). */
export const INPUTS_PARAM = "inputs";

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
    channels: source.data.labels.map((label, index) => ({ index, label, unit: source.data.units[index] ?? "" })),
    xLabel: typeof xName === "string" ? xName : null,
    xUnit: typeof xUnit === "string" ? xUnit : null,
    rows: source.data.time.length,
    includedRows: view.time.length,
    xRange: lo <= hi ? [lo, hi] : null,
  };
}
