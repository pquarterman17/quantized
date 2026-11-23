// What a committed result records about each of its inputs (result-lifecycle
// acceptance, criterion 9): the source worksheet, its channels with units, how
// many rows the analysis view included out of how many, and the X range those
// rows span. Written once by the shared commit contract (committedOutputResult)
// so EVERY "add output" writer records it, whatever its own settings carry.
// The inputs are as the computation saw them: the commit refuses unless the
// source's analysis view still matches (store/analysisOutputCommit.ts).

import type { AnalysisResult, AnalysisResultValue } from "./analysisResult";
import { analysisData } from "./rowstate";
import type { DataStruct, Dataset } from "./types";

/** Envelope `parameters` key of the recorded inputs (one entry per source, in source order). */
export const INPUTS_PARAM = "inputs";

/** The sanitizer on reopen drops a result's whole `parameters` when the tree passes
 *  its node budget (lib/analysisResult.ts: 100,000 nodes, 10,000 per array). A batch
 *  trend over hundreds of wide worksheets would pass it and lose its commit key and
 *  reopen record, so the record is capped: the first MAX_RECORDED_INPUTS sources, the
 *  first MAX_RECORDED_CHANNELS channels of each, plus the true counts. */
export const MAX_RECORDED_INPUTS = 32;
export const MAX_RECORDED_CHANNELS = 64;

/** The X column a tool actually read from a source: a value-channel index, `null` for
 *  the time axis, `undefined` when the tool has no X or it cannot be determined. Only
 *  an explicit column yields a recorded range (acceptance C9: the range is what the
 *  tool used); `undefined`, a non-integer or an out-of-range index record NO range. */
export type InputX = number | null | undefined;

/** One X for every source, or each source's own: a list in source order, or a map by
 *  dataset id (robust to a writer that de-duplicates or reorders its sources). A source
 *  missing from a list or map has no X, so no range. */
export type InputXSpec = InputX | readonly InputX[] | { readonly [datasetId: string]: InputX };

export interface RecordedInputsOptions {
  /** Required: there is no default. */
  xKey: InputXSpec;
  /** `views[i]`, when given, is the exact rows source `i` was computed on (a batch
   *  selection narrows the analysis view to chosen rows or a range); otherwise the
   *  source's analysis view. */
  views?: readonly (DataStruct | undefined)[];
}

export function recordedInputs(sources: readonly Dataset[], options: RecordedInputsOptions): AnalysisResultValue {
  const { xKey } = options;
  const xAt = (index: number): InputX => {
    if (Array.isArray(xKey)) return (xKey as readonly InputX[])[index];
    if (xKey !== null && typeof xKey === "object") {
      const id = sources[index]!.id;
      return Object.prototype.hasOwnProperty.call(xKey, id) ? (xKey as { readonly [id: string]: InputX })[id] : undefined;
    }
    return xKey as InputX;
  };
  return {
    total: sources.length,
    items: sources.slice(0, MAX_RECORDED_INPUTS).map((source, index) => recordedInput(source, { xKey: xAt(index), computedOn: options.views?.[index] })),
  };
}

export function recordedInput(source: Dataset, options: { xKey: InputX; computedOn?: DataStruct }): AnalysisResultValue {
  const view = options.computedOn ?? analysisData(source) ?? source.data;
  const { xKey } = options;
  const width = source.data.labels.length;
  const channel = typeof xKey === "number" && Number.isInteger(xKey) && xKey >= 0 && xKey < width ? xKey : undefined;
  let lo = Infinity;
  let hi = -Infinity;
  if (xKey === null || channel !== undefined) {
    const xs = channel === undefined ? view.time : view.values.map((row) => row[channel]);
    for (const x of xs) {
      if (typeof x === "number" && Number.isFinite(x)) {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
  }
  const meta = source.data.metadata ?? {};
  // The names follow the column the range came from: the time axis' own, or the channel's.
  const timeName = meta["x_column_name"];
  const timeUnit = meta["x_column_unit"];
  const xLabel = channel !== undefined ? (source.data.labels[channel] ?? null) : xKey === null && typeof timeName === "string" ? timeName : null;
  const xUnit = channel !== undefined ? (source.data.units[channel] ?? "") : xKey === null && typeof timeUnit === "string" ? timeUnit : null;
  return {
    datasetId: source.id,
    name: source.name,
    channelCount: width,
    channels: source.data.labels.slice(0, MAX_RECORDED_CHANNELS).map((label, index) => ({ index, label, unit: source.data.units[index] ?? "" })),
    xLabel,
    xUnit,
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
