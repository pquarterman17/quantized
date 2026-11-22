// "Clean data" as recordable transforms (gap audit 8, lane CLEAN): remove
// duplicate rows, fill or drop missing values, z-score / min-max / rank
// columns. The `dedupe` / `fillmissing` / `standardize` ops of lib/transformRun:
// the Reshape & combine workshop's live preview, the commit and the pipeline
// replay all call `computeClean`, so what was previewed is what gets created.
//
// Pure client maths, no backend. The source is the dataset's ANALYSIS rows
// (exclusions/filters pruned, as every reshape reads them) and is never
// changed: the result is a NEW worksheet.
//
// Conventions (each pinned by a test; none is silent):
//  - "Missing" is NaN (blank cells are stored as NaN: lib/blankCells.ts).
//    +/-Infinity is a value, never a gap, and is never filled over.
//  - Dedupe: rows match when every chosen key column is equal (NaN equals NaN,
//    a blank text cell equals a blank). No key columns = the whole row (X, every
//    column, every text column). The first (or last) of each group survives, in
//    the original row order; a group whose dropped rows DIFFER from the survivor
//    in a non-key column is warned about, because those values are lost.
//  - Fill: "linear" interpolates on X and only BETWEEN two present values whose
//    X brackets the gap (never extrapolates, never divides by a zero X span);
//    "previous" carries the last present value forward; "drop" deletes every
//    row that is missing in any chosen column. Whatever cannot be filled stays
//    NaN and is counted in a warning. Dropping every row is refused.
//  - Standardize: z-score uses the SAMPLE standard deviation (n-1); min-max
//    maps to 0..1; rank is 1-based with tied values sharing their average
//    rank. NaN stays NaN. A constant column (z-score / min-max) or a
//    categorical column (level CODES carry no magnitude) is refused, never
//    quietly turned into zeros or nonsense. Output columns are relabelled
//    "<label> (z-score)" etc. and carry no unit.
//
// Lazy: only the workshop, the pipeline and the transform runner import it.

import { isCategoricalChannel } from "./categorical";
import { originTextColumnNames, textColumnCells } from "./originTextColumnCells";
import { sliceRowSidecars } from "./rowSidecars";
import type { TransformWarning } from "./transformWarnings";
import type { DataStruct } from "./types";
import type { JoinKey } from "./worksheetJoin";

export type DedupeKeep = "first" | "last";
export type FillMethod = "linear" | "previous" | "drop";
export type StandardizeMethod = "zscore" | "minmax" | "rank";

export const FILL_METHODS: readonly FillMethod[] = ["linear", "previous", "drop"];
export const STANDARDIZE_METHODS: readonly StandardizeMethod[] = ["zscore", "minmax", "rank"];

/** `keys`: -1 = X, 0.. = a column, a string = a text column; empty = the whole row. */
export interface DedupeParams { op: "dedupe"; keys: JoinKey[]; keep: DedupeKeep }
export interface FillMissingParams { op: "fillmissing"; method: FillMethod; channels: number[] }
export interface StandardizeParams { op: "standardize"; method: StandardizeMethod; channels: number[] }
export type CleanParams = DedupeParams | FillMissingParams | StandardizeParams;

export const CLEAN_OPS: readonly CleanParams["op"][] = ["dedupe", "fillmissing", "standardize"];

export interface CleanComputed {
  data: DataStruct;
  name: string;
  warnings: TransformWarning[];
}

const stem = (name: string): string => name.replace(/\.[^.]+$/, "");
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const info = (text: string, count?: number): TransformWarning => ({ code: "clean", text, info: true, ...(count === undefined ? {} : { count }) });

const STANDARDIZE_SUFFIX: Record<StandardizeMethod, string> = { zscore: "z-score", minmax: "min-max", rank: "rank" };
const FILL_NAME: Record<FillMethod, string> = { linear: "interpolated", previous: "filled forward", drop: "missing dropped" };

/** Pipeline label for a clean step. */
export function cleanLabel(p: CleanParams, primaryName: string): string {
  switch (p.op) {
    case "dedupe": return `Remove duplicate rows (keep ${p.keep}) · ${primaryName}`;
    case "fillmissing": return `${p.method === "drop" ? "Drop rows with missing values" : `Fill missing values (${p.method})`} · ${primaryName}`;
    default: return `${STANDARDIZE_SUFFIX[p.method][0].toUpperCase()}${STANDARDIZE_SUFFIX[p.method].slice(1)} columns · ${primaryName}`;
  }
}

/** Validate a recorded step's params (a .dwk / template is user-editable JSON). */
export function cleanParamsOf(raw: Record<string, unknown>): CleanParams {
  const op = String(raw.op ?? "");
  const channelsOf = (): number[] => {
    const c = raw.channels;
    if (!Array.isArray(c) || !c.length || !c.every((x) => Number.isInteger(x) && x >= 0)) {
      throw new Error(`"${op}" needs at least one whole-number column in "channels"`);
    }
    return [...new Set(c as number[])].sort((a, b) => a - b);
  };
  if (op === "dedupe") {
    const keep = String(raw.keep ?? "first");
    if (keep !== "first" && keep !== "last") throw new Error(`unknown duplicate rule "${keep}"`);
    const keys = raw.keys ?? [];
    if (!Array.isArray(keys) || !keys.every((k) => (Number.isInteger(k) && k >= -1) || (typeof k === "string" && k !== ""))) {
      throw new Error('"dedupe" "keys" must be column numbers (-1 = X) or text column names');
    }
    return { op, keys: keys as JoinKey[], keep };
  }
  if (op === "fillmissing") {
    const method = String(raw.method ?? "");
    if (!FILL_METHODS.includes(method as FillMethod)) throw new Error(`unknown fill method "${method}"`);
    return { op, method: method as FillMethod, channels: channelsOf() };
  }
  if (op === "standardize") {
    const method = String(raw.method ?? "");
    if (!STANDARDIZE_METHODS.includes(method as StandardizeMethod)) throw new Error(`unknown standardize method "${method}"`);
    return { op, method: method as StandardizeMethod, channels: channelsOf() };
  }
  throw new Error(`unknown clean operation "${op}"`);
}

const rowCount = (d: DataStruct): number => Math.max(d.time.length, d.values.length);
const cell = (d: DataStruct, r: number, c: number): number => d.values[r]?.[c] ?? Number.NaN;

function checkChannels(d: DataStruct, channels: readonly number[]): void {
  for (const c of channels) if (c >= d.labels.length) throw new Error(`column ${c + 1} is not in this dataset (it has ${plural(d.labels.length, "column")})`);
}

const labelOf = (d: DataStruct, c: number): string => d.labels[c] || `column ${c + 1}`;

/** The result worksheet: `data` with its rows replaced, text sidecars kept aligned. */
function withRows(src: DataStruct, rows: readonly number[], op: string, name: string, extra: Partial<DataStruct> = {}): DataStruct {
  const kept = rows.length === rowCount(src) && rows.every((r, i) => r === i);
  return {
    ...src,
    ...extra,
    time: rows.map((r) => src.time[r] ?? Number.NaN),
    values: rows.map((r) => (src.values[r] ?? []).slice()),
    metadata: { ...(kept ? src.metadata : sliceRowSidecars(src.metadata, rows)), clean_of: name, clean_op: op },
  };
}

function dedupe(p: DedupeParams, name: string, src: DataStruct): CleanComputed {
  const n = rowCount(src);
  const textNames = originTextColumnNames(src);
  const all: JoinKey[] = [-1, ...src.labels.map((_, i) => i), ...textNames];
  const keys = p.keys.length ? p.keys : all;
  checkChannels(src, keys.filter((k): k is number => typeof k === "number" && k >= 0));
  const texts = new Map<string, readonly unknown[]>();
  for (const k of [...keys, ...all]) {
    if (typeof k !== "string" || texts.has(k)) continue;
    const cells = textColumnCells(src, k);
    if (!cells) throw new Error(`text column "${k}" is not in this dataset`);
    texts.set(k, cells);
  }
  const part = (r: number, k: JoinKey): string => {
    if (typeof k === "string") return `t${String(texts.get(k)?.[r] ?? "").trim()}`;
    return `n${k < 0 ? src.time[r] ?? Number.NaN : cell(src, r, k)}`;
  };
  const sig = (r: number, cols: readonly JoinKey[]): string => JSON.stringify(cols.map((k) => part(r, k)));
  const groups = new Map<string, number[]>();
  for (let r = 0; r < n; r += 1) {
    const g = sig(r, keys);
    const list = groups.get(g);
    if (list) list.push(r);
    else groups.set(g, [r]);
  }
  const survivor = (list: number[]): number => (p.keep === "last" ? list[list.length - 1] : list[0]);
  const kept = [...groups.values()].map(survivor).sort((a, b) => a - b);
  const removed = n - kept.length;
  const warnings: TransformWarning[] = [];
  if (!removed) warnings.push(info("No duplicate rows were found; the result is a copy of the source.", 0));
  else warnings.push(info(`Removed ${plural(removed, "duplicate row")} (kept the ${p.keep} of each group).`, removed));
  if (p.keys.length) {
    // A duplicate group whose rows differ outside the keys loses those values.
    let conflicts = 0;
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const keepSig = sig(survivor(list), all);
      if (list.some((r) => sig(r, all) !== keepSig)) conflicts += 1;
    }
    if (conflicts) {
      warnings.push({
        code: "dedupe-conflict",
        count: conflicts,
        text: `${plural(conflicts, "duplicate group")} had rows that differ in other columns; only the ${p.keep} row of each was kept, so the others' values are lost.`,
      });
    }
  }
  return { data: withRows(src, kept, "dedupe", name), name: `${stem(name)} (deduplicated)`, warnings };
}

function fillMissing(p: FillMissingParams, name: string, src: DataStruct): CleanComputed {
  checkChannels(src, p.channels);
  const n = rowCount(src);
  const names = p.channels.map((c) => labelOf(src, c));
  const outName = `${stem(name)} (${FILL_NAME[p.method]})`;
  if (p.method === "drop") {
    const kept = Array.from({ length: n }, (_, r) => r).filter((r) => p.channels.every((c) => !Number.isNaN(cell(src, r, c))));
    if (n && !kept.length) throw new Error("every row has a missing value in the chosen columns; dropping them would leave nothing");
    const removed = n - kept.length;
    const text = removed
      ? `Dropped ${plural(removed, "row")} with a missing value in ${names.join(", ")}.`
      : `No rows had a missing value in ${names.join(", ")}; the result is a copy of the source.`;
    return { data: withRows(src, kept, "fillmissing", name), name: outName, warnings: [info(text, removed)] };
  }
  const categorical = p.channels.filter((c) => isCategoricalChannel(src, c));
  if (p.method === "linear" && categorical.length) {
    throw new Error(`"${labelOf(src, categorical[0])}" is categorical; interpolating level codes is meaningless — fill it with "previous" instead`);
  }
  const values = src.values.map((row) => row.slice());
  let filled = 0;
  let unfilled = 0;
  for (const c of p.channels) {
    let nextAt = -1; // cached end of the current gap, so a long run is scanned once
    let prev = -1; // row of the last present (finite) value, -1 after an Infinity or at the start
    for (let r = 0; r < n; r += 1) {
      const v = cell(src, r, c);
      if (!Number.isNaN(v)) {
        prev = Number.isFinite(v) ? r : -1;
        continue;
      }
      if (p.method === "previous") {
        if (prev < 0) unfilled += 1;
        else { values[r][c] = values[prev][c]; filled += 1; }
        continue;
      }
      if (nextAt <= r) {
        nextAt = r + 1;
        while (nextAt < n && Number.isNaN(cell(src, nextAt, c))) nextAt += 1;
      }
      const next = nextAt;
      const [x0, x1, x] = [src.time[prev], src.time[next], src.time[r]];
      const bracketed = prev >= 0 && next < n && Number.isFinite(cell(src, next, c)) &&
        [x0, x1, x].every(Number.isFinite) && x1 !== x0 && (x - x0) * (x1 - x) >= 0;
      if (!bracketed) { unfilled += 1; continue; }
      const y0 = cell(src, prev, c);
      values[r][c] = y0 + ((cell(src, next, c) - y0) * (x - x0)) / (x1 - x0);
      filled += 1;
    }
  }
  const warnings = [info(`Filled ${plural(filled, "missing value")} in ${names.join(", ")} (${p.method}).`, filled)];
  if (unfilled) {
    warnings.push({
      code: "gaps-unfilled",
      count: unfilled,
      text: `${plural(unfilled, "missing value")} could not be filled (${p.method === "linear" ? "no present value on one side, or X does not bracket the gap" : "no earlier value"}) and stay blank.`,
    });
  }
  const data = { ...withRows(src, Array.from({ length: n }, (_, r) => r), "fillmissing", name), values };
  return { data, name: outName, warnings };
}

/** 1-based ranks, tied values sharing their average rank; NaN stays NaN. */
function ranks(vals: readonly number[]): number[] {
  const order = vals.map((_, i) => i).filter((i) => !Number.isNaN(vals[i])).sort((a, b) => vals[a] - vals[b]);
  const out = vals.map(() => Number.NaN);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && vals[order[j + 1]] === vals[order[i]]) j += 1;
    for (let k = i; k <= j; k += 1) out[order[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

function standardize(p: StandardizeParams, name: string, src: DataStruct): CleanComputed {
  checkChannels(src, p.channels);
  const n = rowCount(src);
  const values = src.values.map((row) => row.slice());
  const labels = src.labels.slice();
  const units = src.units.slice();
  let blanks = 0;
  for (const c of p.channels) {
    const label = labelOf(src, c);
    if (isCategoricalChannel(src, c)) throw new Error(`"${label}" is categorical; its level codes have no magnitude to standardize`);
    const col = Array.from({ length: n }, (_, r) => cell(src, r, c));
    blanks += col.filter(Number.isNaN).length;
    let out: number[];
    if (p.method === "rank") out = ranks(col);
    else {
      const finite = col.filter(Number.isFinite);
      if (p.method === "zscore") {
        const mean = finite.reduce((s, v) => s + v, 0) / (finite.length || 1);
        const sd = Math.sqrt(finite.reduce((s, v) => s + (v - mean) ** 2, 0) / (finite.length - 1));
        if (finite.length < 2 || !(sd > 0)) throw new Error(`"${label}" is constant or has fewer than two values; its z-score is undefined`);
        out = col.map((v) => (Number.isFinite(v) ? (v - mean) / sd : v));
      } else {
        const [lo, hi] = [Math.min(...finite), Math.max(...finite)];
        if (!(hi > lo)) throw new Error(`"${label}" is constant (or empty); min-max scaling is undefined`);
        out = col.map((v) => (Number.isFinite(v) ? (v - lo) / (hi - lo) : v));
      }
    }
    out.forEach((v, r) => { if (values[r]) values[r][c] = v; });
    labels[c] = `${label} (${STANDARDIZE_SUFFIX[p.method]})`;
    units[c] = "";
  }
  const warnings = [info(`${STANDARDIZE_SUFFIX[p.method][0].toUpperCase()}${STANDARDIZE_SUFFIX[p.method].slice(1)} applied to ${plural(p.channels.length, "column")}; their units were cleared.`)];
  if (blanks) warnings.push(info(`${plural(blanks, "blank cell")} stayed blank.`, blanks));
  const data = { ...withRows(src, Array.from({ length: n }, (_, r) => r), "standardize", name), values, labels, units };
  return { data, name: `${stem(name)} (${STANDARDIZE_SUFFIX[p.method]})`, warnings };
}

/** THE compute for the three clean ops. `source.data` is the analysis rows. */
export function computeClean(p: CleanParams, source: { name: string; data: DataStruct }): CleanComputed {
  switch (p.op) {
    case "dedupe": return dedupe(p, source.name, source.data);
    case "fillmissing": return fillMissing(p, source.name, source.data);
    default: return standardize(p, source.name, source.data);
  }
}
