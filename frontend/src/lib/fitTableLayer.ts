// "Add results table to graph" (Origin's NLFit parameter table on the graph):
// a fit result (single, global or batch) as the cells of a graph TABLE layer
// (lib/graphLayers.ts `TableLayer`, added through store/graphLayerEdit.ts).
// Pure.
//
// The layer holds text cells and nothing else, so the screen and the vector
// export draw exactly these strings (screen and export agree by
// construction). It is a SNAPSHOT of the fit as it was when added: a re-fit
// does not move it. `replaceLayerRows` (the dialog's "Update table") rewrites
// the same layer from the new fit as one undo step.
//
// Number format: a parameter with a usable error reads "value ± error", the
// error to two significant figures and the value rounded to the same decimal
// place (1.234 ± 0.012); a value/error pair at a very large or small
// magnitude shares one exponent, (1.23 ± 0.04)e-5. A parameter without an
// error (a fixed one, or a failed covariance) prints its value to four
// significant figures with no "±". A missing number is an en dash.

import { DEFAULT_LAYER_AT, MAX_TABLE_COLS, MAX_TABLE_ROWS, type TableLayer } from "./graphLayersSanitize";
import type { CalcResult } from "./types";

const DASH = "–";
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const wide = (a: number) => a !== 0 && (a < 1e-3 || a >= 1e5);

/** "value ± error" with matching decimals (see the module header). A value
 *  with no usable error is marked "(no error)": a held (fixed) parameter and
 *  one the data could not determine both reach here, and neither may read as
 *  an exact number. */
export function valueWithError(v: unknown, e: unknown): string {
  if (!fin(v)) return DASH;
  if (!fin(e) || e <= 0) return `${plain(v, 4)} (no error)`;
  // One exponent for the pair, from the larger of the two.
  const top = Math.max(Math.abs(v), e);
  const mag = wide(top) ? Math.floor(Math.log10(top)) : 0;
  const s = 10 ** mag;
  const ve = v / s;
  const ee = e / s;
  // Two significant figures of the error set the decimals of both.
  const dec = 1 - Math.floor(Math.log10(ee));
  // So small an error against the value that no decimals can show both.
  if (dec > 20) return `${plain(v, 4)} ± ${e.toExponential(1)}`;
  let out: string;
  if (dec >= 0) out = `${ve.toFixed(dec)} ± ${ee.toFixed(dec)}`;
  else {
    // An error of 100 or more: round both to its second significant figure.
    const unit = 10 ** -dec;
    out = `${Math.round(ve / unit) * unit} ± ${Math.round(ee / unit) * unit}`;
  }
  return mag === 0 ? out : `(${out})e${mag}`;
}

/** A statistic to `sig` significant figures, exponent when very large or small. */
export function plain(v: unknown, sig = 4): string {
  if (!fin(v)) return DASH;
  if (wide(Math.abs(v))) return v.toExponential(sig - 1).replace("e+", "e");
  return String(Number(v.toPrecision(sig)));
}

/** Which goodness-of-fit rows a table carries. */
export interface FitTableWant {
  r2: boolean;
  chiSqRed: boolean;
  chiSq: boolean;
  n: boolean;
}
export const DEFAULT_WANT: FitTableWant = { r2: true, chiSqRed: true, chiSq: false, n: false };

/** The cap on a table's cells, as text the dialog can show. */
export const TABLE_LIMIT = `${MAX_TABLE_ROWS} rows x ${MAX_TABLE_COLS} columns`;

/** `rows` cut to the table caps; `cut` says whether anything was dropped. */
export function fitToCaps(rows: string[][]): { rows: string[][]; cut: boolean } {
  const kept = rows.slice(0, MAX_TABLE_ROWS).map((r) => r.slice(0, MAX_TABLE_COLS));
  return { rows: kept, cut: rows.length > kept.length || rows.some((r, i) => r.length > (kept[i]?.length ?? 0)) };
}

/** A single fit: a Parameter / Value ± error table, then the chosen statistics. */
export function singleFitTable(names: readonly string[], result: CalcResult, want: FitTableWant): string[][] {
  const params = Array.isArray(result.params) ? (result.params as unknown[]) : [];
  const errors = Array.isArray(result.errors) ? (result.errors as unknown[]) : [];
  const rows: string[][] = [["Parameter", "Value"]];
  params.forEach((v, i) => rows.push([names[i] ?? `p${i}`, valueWithError(v, errors[i])]));
  if (want.r2) rows.push(["R²", plain(result.R2, 5)]);
  if (want.chiSqRed) rows.push(["Reduced χ²", plain(result.chiSqRed)]);
  if (want.chiSq) rows.push(["χ²", plain(result.chiSq)]);
  if (want.n) rows.push(["N", plain(result.nPoints, 6)]);
  return rows;
}

/** One series of a global fit, as `useGlobalFit`'s result carries it. */
export interface GlobalTableInput {
  paramNames: readonly string[];
  /** Per series: label, and per-parameter value/error (a shared one repeats). */
  members: readonly { label: string; params: readonly unknown[]; errors: readonly unknown[]; R2: unknown; chiSq: unknown }[];
  /** Parameters shared by every series listed (by index) are printed once. */
  sharedIdx: readonly number[];
  chiSqRed: unknown;
  nTotal: number;
}

/** A global fit: the shared parameters in their own Parameter / Value block,
 *  then one row per series (a column per own parameter), then the chosen
 *  statistics. A series row with nothing to show is left out. */
export function globalFitTable(g: GlobalTableInput, want: FitTableWant): string[][] {
  const own = g.paramNames.map((_, j) => j).filter((j) => !g.sharedIdx.includes(j));
  const rows: string[][] = [];
  const first = g.members[0];
  if (g.sharedIdx.length > 0 && first) {
    rows.push(["Shared parameter", "Value"]);
    for (const j of g.sharedIdx) rows.push([g.paramNames[j] ?? `p${j}`, valueWithError(first.params[j], first.errors[j])]);
  }
  const head = ["Series", ...own.map((j) => g.paramNames[j]!), ...(want.r2 ? ["R²"] : []), ...(want.chiSq ? ["χ²"] : [])];
  if (head.length > 1) {
    rows.push(head);
    for (const m of g.members) {
      rows.push([m.label, ...own.map((j) => valueWithError(m.params[j], m.errors[j])),
        ...(want.r2 ? [plain(m.R2, 5)] : []), ...(want.chiSq ? [plain(m.chiSq)] : [])]);
    }
  }
  if (want.chiSqRed) rows.push(["Reduced χ²", plain(g.chiSqRed)]);
  if (want.n) rows.push(["N", plain(g.nTotal, 6)]);
  return rows;
}

/** A batch: one row per input (its parameters ± SE and, as chosen, R² and χ²). */
export function batchFitTable(
  names: readonly string[],
  inputs: readonly { name: string; params: readonly unknown[]; errors: readonly unknown[]; R2: unknown; chiSqRed: unknown }[],
  want: FitTableWant,
): string[][] {
  const rows: string[][] = [["Input", ...names, ...(want.r2 ? ["R²"] : []), ...(want.chiSqRed ? ["Reduced χ²"] : [])]];
  for (const r of inputs) {
    rows.push([r.name, ...names.map((_, j) => valueWithError(r.params[j], r.errors[j])),
      ...(want.r2 ? [plain(r.R2, 5)] : []), ...(want.chiSqRed ? [plain(r.chiSqRed)] : [])]);
  }
  return rows;
}

/** The table layer for `rows` (header row bold, the table's default spot). */
export function fitTableLayer(id: string, rows: string[][]): TableLayer {
  return { id, kind: "table", at: [...DEFAULT_LAYER_AT.table], rows: fitToCaps(rows).rows, header: true };
}
