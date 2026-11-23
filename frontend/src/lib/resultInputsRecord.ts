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
  /** The inclusive X window the tool actually read (an optional X range): the recorded
   *  `includedRows` / `xRange` then describe only the rows inside it. Applied to every
   *  source; omitted = the whole analysis view. */
  xWindow?: XWindow;
  /** A signal column the tool also needed finite (the spectrogram drops non-finite Y rows):
   *  `includedRows` / `xRange` then count finite (X, Y) pairs. Only with the time axis as X. */
  yChannel?: number;
}

/** An inclusive X window `[min, max]`; either end may be omitted (open). */
export type XWindow = readonly [number | null, number | null];

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
    items: sources.slice(0, MAX_RECORDED_INPUTS).map((source, index) => recordedInput(source, { xKey: xAt(index), computedOn: options.views?.[index], xWindow: options.xWindow, yChannel: options.yChannel })),
  };
}

export function recordedInput(source: Dataset, options: { xKey: InputX; computedOn?: DataStruct; xWindow?: XWindow; yChannel?: number }): AnalysisResultValue {
  const view = options.computedOn ?? analysisData(source) ?? source.data;
  const { xKey } = options;
  const width = source.data.labels.length;
  const channel = typeof xKey === "number" && Number.isInteger(xKey) && xKey >= 0 && xKey < width ? xKey : undefined;
  let lo = Infinity;
  let hi = -Infinity;
  const [wLo, wHi] = options.xWindow ?? [null, null];
  const inWindow = (x: number): boolean => (wLo === null || x >= wLo) && (wHi === null || x <= wHi);
  // The X the tool read (the time axis, or the chosen channel); none = no X, so no window applies.
  const xs: readonly (number | null | undefined)[] | null =
    xKey === null ? view.time : channel !== undefined ? view.values.map((row) => row[channel]) : null;
  // Rows the tool really read: finite X, inside the window, and (spectrogram) finite Y.
  const yCol = xKey === null && Number.isInteger(options.yChannel) ? options.yChannel! : undefined;
  const reads = (i: number, x: unknown): x is number =>
    typeof x === "number" && Number.isFinite(x) && inWindow(x) &&
    (yCol === undefined || Number.isFinite(view.values[i]?.[yCol]));
  let included = view.time.length;
  if ((options.xWindow || yCol !== undefined) && xs) {
    included = 0;
    (xs as readonly unknown[]).forEach((x, i) => { if (reads(i, x)) included += 1; });
  }
  (xs ?? []).forEach((x, i) => {
    if (reads(i, x)) {
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  });
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
    includedRows: included,
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

// ── The record a result POINTS at ─────────────────────────────────────────────
// (Here, not a module of its own: a new shared chunk grows the eager preload map.)
//
// A curve fit (`Dataset.fitSpec`), a peak table (`Dataset.peakTable`) and a
// reflectivity fit (`Dataset.reflFits[]`) stay the scientific authority on their
// source worksheet (acceptance C9, audit row 35; owner-approved recommendation
// 2026-11-23): the envelope is never a copy. It records the reference
// (`settingsRef`) plus the record's fingerprint when the envelope was written,
// so a reader can tell the record it finds is the SAME record. A record that no
// longer matches is "changed" and is shown as unavailable (fail closed), never
// silently read in its place.
//
// The fingerprint covers what the record says scientifically, not where it
// points: column indices (a fit's `xKey`/`yKey`/error column, which a column
// delete remaps), dataset ids/names (a project merge re-keys them) and the parts
// a later step adds on purpose (a reflectivity fit's stored curves, trimmed from
// older history, and its DREAM posterior) are left out.

export type RecordField = "fitSpec" | "peakTable" | "reflFits";

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** JSON with sorted keys; the forms a .dwk round trip cannot keep are written
 *  the way it reads them back (non-finite numbers as null, -0 as 0, undefined
 *  object fields omitted), so a save and reopen fingerprint the same. */
function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value + 0) : "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

function digest(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x5bd1e995);
    b ^= b >>> 15;
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

/** What the fingerprint covers (see the header). */
function identity(field: RecordField, record: Record<string, unknown>): unknown {
  if (field === "fitSpec") {
    const { xKey: _x, yKey: _y, weight, ...rest } = record;
    const w = object(weight);
    return { ...rest, weight: w ? { ...w, errKey: undefined } : weight };
  }
  if (field === "peakTable") {
    const provenance = object(record.provenance) ?? {};
    const { datasetId: _id, datasetName: _name, rowIds, ...rest } = provenance;
    // The reader sorts and de-duplicates row ids (lib/peakTable.ts).
    const rows = Array.isArray(rowIds) ? [...new Set(rowIds)].sort((p, q) => Number(p) - Number(q)) : rowIds;
    return { version: record.version, peaks: record.peaks, provenance: { ...rest, rowIds: rows } };
  }
  const request = object(record.request) ?? {};
  return {
    version: record.version, id: record.id, fittedAt: record.fittedAt, model: record.model, result: record.result,
    parameters: request.parameters, settings: request.settings, weighting: request.weighting, graded: request.graded,
  };
}

/** The record's fingerprint, or null for a value that is not a record. */
export function recordFingerprint(field: RecordField, record: unknown): string | null {
  const raw = object(record);
  return raw ? `${field}:${digest(canonical(identity(field, raw)))}` : null;
}

/** The record `result` points at, as stored, and the worksheet it was read
 *  from. THE one lookup (the fingerprint check and the result workspace's
 *  decoded record both use it, so they judge the same copy): a reflectivity
 *  fit is the first source, in the envelope's order, holding a copy with the id. */
export function referencedRecordSource(
  result: AnalysisResult, datasets: readonly Dataset[],
): { record: unknown; datasetId: string } | undefined {
  const ref = result.settingsRef;
  if (!ref || ref.field === "analysisRecipe") return undefined;
  if (ref.field !== "reflFits") {
    const record = datasets.find((dataset) => dataset.id === ref.datasetId)?.[ref.field];
    return record === undefined ? undefined : { record, datasetId: ref.datasetId };
  }
  for (const source of result.sources) {
    const fits = datasets.find((dataset) => dataset.id === source.datasetId)?.reflFits;
    const hit = Array.isArray(fits) ? fits.find((stored) => object(stored)?.id === ref.recordId) : undefined;
    if (hit) return { record: hit, datasetId: source.datasetId };
  }
  return undefined;
}

export function referencedRecord(result: AnalysisResult, datasets: readonly Dataset[]): unknown {
  return referencedRecordSource(result, datasets)?.record;
}

/** "unrecorded": no fingerprint was written (an envelope saved before it, or
 *  no record reference), or the source is a lazy preview; nothing is claimed.
 *  "missing": the record is gone. "changed": a different record is there now.
 *  "current": the same record. */
export type RecordRefState = "unrecorded" | "missing" | "changed" | "current";

export function referencedRecordState(result: AnalysisResult, datasets: readonly Dataset[]): RecordRefState {
  const ref = result.settingsRef;
  if (!ref || ref.field === "analysisRecipe" || !ref.fingerprint) return "unrecorded";
  if (result.sources.concat({ datasetId: ref.datasetId, role: "input" })
    .some((source) => datasets.find((dataset) => dataset.id === source.datasetId)?.pending)) return "unrecorded";
  const record = referencedRecord(result, datasets);
  if (record === undefined || record === null) return "missing";
  return recordFingerprint(ref.field, record) === ref.fingerprint ? "current" : "changed";
}

const RECORD_NAMES: Record<RecordField, string> = {
  fitSpec: "curve fit", peakTable: "peak table", reflFits: "reflectivity fit",
};

/** The diagnostic for a "changed" record. */
export function recordChangedText(field: RecordField): string {
  return `The saved ${RECORD_NAMES[field]} on the source worksheet is not the one this result recorded, so it is not shown here. Run the ${RECORD_NAMES[field]} again to record it.`;
}
