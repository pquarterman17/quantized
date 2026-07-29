// Multivariate workbench (JMP_GAP J10: correlation heatmap + SPLOM + PCA) —
// pure helpers shared by useMultivar.ts and the canvas SPLOM renderer. No
// React/store/fetch here — mirrors lib/statstage.ts / lib/distribution.ts:
// everything below is plain arrays in, plain numbers out, so it unit-tests
// standalone without a DOM or a mocked fetch.

import { channelModelingType, isCategorical } from "./modeling";
import type { DataStruct, Dataset } from "./types";

export interface MultivarColumn {
  /** -1 = the shared x column, 0.. = a data channel — same convention as
   *  Distribution/Tabulate's column pickers. */
  index: number;
  label: string;
}

/** Every selectable column (x + channels), for the picker's option list. */
export function multivarColumns(ds: Dataset | null): MultivarColumn[] {
  if (!ds) return [];
  const xName = String(ds.data.metadata?.["x_column_name"] ?? "x");
  return [
    { index: -1, label: xName },
    ...ds.data.labels.map((lab, i) => ({ index: i, label: lab })),
  ];
}

/** Default selection: every channel (0..; never the x column) that reads as
 *  continuous. Falls back to every channel when none read as continuous
 *  (e.g. an all-discrete dataset), so the picker never starts empty. */
export function defaultContinuousColumns(ds: Dataset | null): number[] {
  if (!ds) return [];
  const n = ds.data.labels.length;
  const continuous: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!isCategorical(channelModelingType(ds, i))) continuous.push(i);
  }
  return continuous.length ? continuous : Array.from({ length: n }, (_, i) => i);
}

/** A selected column's raw values (index -1 = x), from the given (already
 *  row-state-pruned, per lib/rowstate.analysisData) DataStruct. */
export function multivarColumnValues(data: DataStruct, index: number): number[] {
  return index < 0 ? data.time : data.values.map((row) => row[index]);
}

/** Row-major matrix of LISTWISE-COMPLETE rows across `columns`: a row
 *  survives only if every column is finite there. Mirrors
 *  `calc.stats_multivar.correlation_matrix`'s own dropping (so the
 *  correlation request, the PCA request — which raises on any NaN/Inf — and
 *  the SPLOM scatter all agree on the same N). Empty for <2 columns or no
 *  complete rows. */
export function listwiseComplete(columns: readonly (readonly number[])[]): number[][] {
  if (columns.length < 2) return [];
  const n = columns[0]?.length ?? 0;
  const rows: number[][] = [];
  for (let r = 0; r < n; r++) {
    const row: number[] = new Array(columns.length);
    let ok = true;
    for (let c = 0; c < columns.length; c++) {
      const v = columns[c][r];
      if (!Number.isFinite(v)) {
        ok = false;
        break;
      }
      row[c] = v;
    }
    if (ok) rows.push(row);
  }
  return rows;
}

/** Column-major transpose of a row-major matrix (the shape
 *  `/api/stats/correlation`'s `columns` field wants). */
export function transposeRows(rows: readonly (readonly number[])[]): number[][] {
  if (!rows.length) return [];
  const k = rows[0].length;
  const cols: number[][] = Array.from({ length: k }, () => []);
  for (const row of rows) for (let j = 0; j < k; j++) cols[j].push(row[j]);
  return cols;
}

/** SPLOM per-panel point cap (item 3): above this, downsample and say so. */
export const SPLOM_MAX_POINTS = 5000;

/** Deterministic stride-based index sample capping at `cap` — no randomness,
 *  so the same dataset always downsamples to the same panel and a re-render
 *  never jitters. Returns every index unchanged when `n <= cap`. */
export function downsampleIndices(n: number, cap: number = SPLOM_MAX_POINTS): number[] {
  if (n <= cap) return Array.from({ length: n }, (_, i) => i);
  const stride = n / cap;
  const idx: number[] = new Array(cap);
  for (let i = 0; i < cap; i++) idx[i] = Math.min(n - 1, Math.floor(i * stride));
  return idx;
}

export interface MiniHist {
  counts: number[];
  max: number;
}

/** A small equal-width histogram over finite values (SPLOM diagonal
 *  sparkline) — computed client-side so the diagonal needs no extra fetch. */
export function miniHistogram(values: readonly number[], bins = 12): MiniHist {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return { counts: [], max: 0 };
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of finite) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi <= lo) return { counts: [finite.length], max: finite.length };
  const counts = new Array(bins).fill(0) as number[];
  const width = (hi - lo) / bins;
  for (const v of finite) {
    const b = Math.min(bins - 1, Math.floor((v - lo) / width));
    counts[b]++;
  }
  return { counts, max: Math.max(...counts) };
}

/** Copy-TSV for the correlation matrix: a header row of labels, then one row
 *  per column with its `r` against every other (4 decimal places). */
export function correlationToTSV(labels: readonly string[], r: readonly (readonly number[])[]): string {
  const header = ["", ...labels].join("\t");
  const body = labels.map((lab, i) => [lab, ...(r[i] ?? []).map((v) => (Number.isFinite(v) ? v.toFixed(4) : ""))].join("\t"));
  return [header, ...body].join("\n");
}
