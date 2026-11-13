// Curve Fit — "Output to worksheet" builders (pure: no React, no store).
//
// Origin's NLFit writes the fitted curve and residuals back to the source
// worksheet. Two destinations here:
//
//  * LINKED columns in the source worksheet: formula columns
//      fitted   = fitval("Model", X)
//      residual = Y - fitval("Model", X)
//    over the fit's own X and Y columns. fitval() reads the worksheet's saved
//    fit (lib/formulaFitRefs.ts), so the columns follow every re-fit and
//    recompute, carry their formula as provenance, and are ordinary undoable
//    column adds. Only closed-form models (lib/derivedFitModels.ts) have a
//    formula; for any other model fitval() would refuse, so the panel offers
//    the result worksheet instead.
//  * A RESULT worksheet beside the source (same workbook/folder): the fitted
//    rows' X, Y, fitted value, residual and, optionally, the confidence and
//    prediction limits — values, with the fit recorded in
//    `metadata.fitOutput` (model, parameters, errors, level, source, time).
//    Bands have no formula form (they need the covariance), which is why they
//    are offered only here.

import { FIT_MODEL_EXPRS } from "../../../lib/derivedFitModels";
import type { BandsResult } from "../../../lib/api/fitStats";
import type { CalcResult, DataStruct, Dataset } from "../../../lib/types";
import { levelLabel } from "./fitBandData";
import type { FittedData } from "./curveFitSession";

/** Worksheet formula letter of channel `i` (0 -> "A", 26 -> "AA"). */
export function colLetter(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** True when `model` has a formula form, so linked columns can evaluate it. */
export const canLinkModel = (model: string): boolean => Object.hasOwn(FIT_MODEL_EXPRS, model);

/** A name not already among `taken`: "name", "name (2)", … */
function freeName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  let k = 2;
  while (taken.has(`${name} (${k})`)) k++;
  return `${name} (${k})`;
}

export interface LinkedColumn {
  name: string;
  expr: string;
}

/** The linked formula columns for a fit of `model` on (xKey, yKey) of `ds`. */
export function linkedColumns(
  ds: Pick<Dataset, "data" | "formulas">,
  model: string,
  xKey: number | null,
  yKey: number,
  want: { fitted: boolean; residual: boolean },
): LinkedColumn[] {
  const x = xKey == null ? "x" : colLetter(xKey);
  const fit = `fitval(${JSON.stringify(model)}, ${x})`;
  const taken = new Set([...ds.data.labels, ...(ds.formulas ?? []).map((f) => f.name)]);
  const yName = ds.data.labels[yKey] ?? "y";
  const out: LinkedColumn[] = [];
  if (want.fitted) {
    const name = freeName(`${yName} fit`, taken);
    taken.add(name);
    out.push({ name, expr: fit });
  }
  if (want.residual) out.push({ name: freeName(`${yName} residual`, taken), expr: `${colLetter(yKey)} - ${fit}` });
  return out;
}

export interface ResultSheetInput {
  source: Pick<Dataset, "id" | "name" | "data">;
  model: string;
  paramNames: readonly string[];
  result: CalcResult;
  fitData: FittedData;
  /** Band limits at fitData.x (null = no band columns). */
  band: BandsResult | null;
  prediction: boolean;
  /** Which fit columns to write (X and Y are always written). */
  want: { fitted: boolean; residual: boolean };
}

const num = (v: number | null | undefined): number => (v == null || !Number.isFinite(v) ? Number.NaN : v);

/** The result worksheet's data: one row per fitted point. */
export function resultSheetData(i: ResultSheetInput): DataStruct {
  const d = i.source.data;
  const yName = d.labels[i.fitData.yKey] ?? "y";
  const yUnit = d.units[i.fitData.yKey] ?? "";
  const meta = d.metadata ?? {};
  const xName = i.fitData.xKey == null ? String(meta["x_column_name"] || "x") : (d.labels[i.fitData.xKey] ?? "x");
  const xUnit = i.fitData.xKey == null ? String(meta["x_column_unit"] ?? "") : (d.units[i.fitData.xKey] ?? "");
  const yFit = (i.result.yFit as (number | null)[] | undefined) ?? [];
  const res = (i.result.residuals as (number | null)[] | undefined) ?? [];
  const labels = [yName];
  const cols: (number | null)[][] = [i.fitData.y];
  if (i.want.fitted) {
    labels.push(`${yName} fit`);
    cols.push(yFit);
  }
  if (i.want.residual) {
    labels.push(`${yName} residual`);
    cols.push(res);
  }
  if (i.band) {
    const lv = levelLabel(i.band.level);
    labels.push(`${lv} CI low`, `${lv} CI high`);
    cols.push(i.band.ciLo, i.band.ciHi);
    if (i.prediction) {
      labels.push(`${lv} PI low`, `${lv} PI high`);
      cols.push(i.band.piLo, i.band.piHi);
    }
  }
  return {
    time: [...i.fitData.x],
    values: i.fitData.x.map((_, r) => cols.map((c) => num(c[r]))),
    labels,
    units: labels.map(() => yUnit),
    metadata: {
      x_column_name: xName,
      x_column_unit: xUnit,
      fitOutput: {
        source: { id: i.source.id, name: i.source.name },
        model: i.model,
        paramNames: [...i.paramNames],
        params: (i.result.params as number[] | undefined) ?? [],
        errors: (i.result.errors as (number | null)[] | undefined) ?? [],
        weighted: i.fitData.dy != null,
        ...(i.band ? { level: i.band.level, prediction: i.prediction } : {}),
        createdAt: new Date().toISOString(),
      },
    },
  };
}
