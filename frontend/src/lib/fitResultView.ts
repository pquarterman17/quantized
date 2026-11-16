// The Curve Fit result as table cells, pure: the panel renders `fitResultView`,
// and the copy buttons serialize the SAME rows (`fitResultTsv`, TSV for
// Excel; `fitResultMarkdown`), so what is copied is exactly what is shown.
// Number rules live in lib/fitValueFormat.ts, shared with the graph table layer.

import { paramUnit } from "./fitParamUnits";
import { fmtLimits, fmtR2, fmtValueErr, isExactFit, limitParts, roundToError, sigFigs } from "./fitValueFormat";
import type { CalcResult } from "./types";

export interface FitResultInput {
  model: string;
  names: readonly string[];
  result: CalcResult;
  /** Held parameters (no uncertainty by construction). */
  fixed?: readonly boolean[] | undefined;
  xUnit: string;
  yUnit: string;
}

export interface FitResultView {
  paramColumns: string[];
  paramRows: string[][];
  statRows: string[][];
  /** Plain-language warnings: an exact fit, a singular covariance. */
  notes: string[];
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const COLUMNS = ["Parameter", "Value ± SE", "95 % CI", "Units"];
const list = (v: unknown): unknown[] => (Array.isArray(v) ? (v as unknown[]) : []);

/** Degrees of freedom of a fit result (points minus free parameters), or 0. */
export function fitDof(result: CalcResult): number {
  const d = Number(result.nPoints) - Number(result.nFree);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

export function fitResultView(i: FitResultInput): FitResultView {
  const params = list(i.result.params);
  const errors = list(i.result.errors);
  const dof = fitDof(i.result);
  const exact = isExactFit(i.result.R2);
  const undetermined: string[] = [];
  const paramRows = params.map((v, k) => {
    const name = i.names[k] ?? `p${k}`;
    const e = errors[k];
    const held = i.fixed?.[k] === true;
    const usable = fin(e) && e > 0;
    if (!held && !usable) undetermined.push(name);
    const unit = paramUnit(i.model, name, i.xUnit, i.yUnit) ?? "—";
    if (held) return [name, `${sigFigs(v, 4)} (fixed)`, "—", unit];
    if (!usable) return [name, `${sigFigs(v, 4)} (no error)`, "—", unit];
    return [name, fmtValueErr(v, e), exact ? "—" : fmtLimits(v, e, dof), unit];
  });
  const notes: string[] = [];
  if (exact) notes.push("Exact fit (R² = 1 to machine precision): the data has no scatter about the model, so the standard errors are not meaningful.");
  if (undetermined.length > 0) {
    notes.push(`Singular covariance: ${undetermined.join(", ")} could not be estimated (the data does not determine ${undetermined.length === 1 ? "it" : "them"}).`);
  }
  const statRows = [
    ["N", sigFigs(i.result.nPoints, 6)],
    ["dof", dof > 0 ? String(dof) : "—"],
    ["R²", fmtR2(i.result.R2)],
    ["reduced χ²", sigFigs(i.result.chiSqRed, 6)],
    ["RMSE", sigFigs(i.result.RMSE, 6)],
    ["AIC", sigFigs(i.result.AIC, 6)],
  ];
  return { paramColumns: COLUMNS, paramRows, statRows, notes };
}

/** Value and error as plain spreadsheet numbers ("5.4e-13": Excel parses it). */
function numberCells(v: unknown, e: unknown): [string, string] {
  const r = fin(v) && fin(e) ? roundToError(v, e) : null;
  if (!r) return [fin(v) ? sigFigs(v, 6) : "", ""];
  const tail = r.mag === 0 ? "" : `e${r.mag}`;
  return [r.value + tail, r.error + tail];
}

/** TSV for Excel: separate numeric columns (value, SE, CI limits), then the
 *  statistics block. Plain text cells: no ± or ×10ⁿ glyphs. */
export function fitResultTsv(i: FitResultInput): string {
  const errors = list(i.result.errors);
  const dof = fitDof(i.result);
  const exact = isExactFit(i.result.R2);
  const view = fitResultView(i);
  const rows = [["Parameter", "Value", "Std. error", "95 % CI low", "95 % CI high", "Units"]];
  list(i.result.params).forEach((v, k) => {
    const held = i.fixed?.[k] === true;
    const [val, err] = held ? [fin(v) ? sigFigs(v, 6) : "", ""] : numberCells(v, errors[k]);
    const lim = held || exact ? null : limitParts(v, errors[k], dof);
    const tail = lim && lim.mag !== 0 ? `e${lim.mag}` : "";
    const unit = view.paramRows[k]![3]!;
    rows.push([view.paramRows[k]![0]!, val, err, lim ? lim.lo + tail : "", lim ? lim.hi + tail : "", unit === "—" ? "" : unit]);
  });
  return [...rows, [], ...view.statRows].map((r) => r.join("\t")).join("\n");
}

/** Markdown: the displayed parameter table, then the statistics table. */
export function fitResultMarkdown(i: FitResultInput): string {
  const v = fitResultView(i);
  const md = (head: string[], rows: string[][]) =>
    [head, head.map(() => "---"), ...rows].map((r) => `| ${r.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`).join("\n");
  return [md(v.paramColumns, v.paramRows), md(["Statistic", "Value"], v.statRows), ...v.notes.map((n) => `> ${n}`)].join("\n\n");
}
