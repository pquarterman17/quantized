// Fit Model "Save columns" (JMP's Save Columns > Predicted Values / Residuals /
// Mean Confidence Interval / Indiv Confidence Interval): the pure builder of
// the output worksheet. One row per FITTED row, in analysis-view order, with the
// source worksheet's 1-based row number as the X column ("Row") so every value
// can be traced back to its row (excluded, filtered and missing-value rows are
// not fitted, so they are not in the output; appending to the source instead
// would misalign them).
//
// Intervals (JMP, Save Columns, https://www.jmp.com/support/help/en/18.1/jmp/
// save-columns.shtml): the mean interval is  yhat +- t * se_fit  and the
// individual (prediction) interval  yhat +- t * sqrt(se_fit^2 + MSE), with t the
// two-sided critical value on the error df (`fit.t_crit`, at `fit.alpha`).
//
// PREDICTION FORMULA: provisional, owner to confirm. The formula text is stored
// in the output's metadata (`prediction_formula`) but NOT as a live formula
// column: the worksheet formula grammar has no effect-coded nominal terms or
// per-term centring, and the output worksheet does not hold the factor columns.
// The text spells the model out with its coefficients, so it can be reproduced
// by hand or in another tool.

import { fmtNum } from "./format";
import type { FitModelResponse, FittedModel } from "./api/statsModel";
import type { DataStruct } from "./types";

export interface SaveColumnOptions {
  residual: boolean;
  meanInterval: boolean;
  individualInterval: boolean;
}

export const DEFAULT_SAVE_COLUMNS: SaveColumnOptions = { residual: false, meanInterval: false, individualInterval: false };

const num = (v: number): string => String(Number(v.toPrecision(10)));

/** The fitted model written out: `Y = b0 + b1*[A[a]] + ...`, with a note on the coding. */
export function predictionFormula(model: FittedModel, responseLabel: string): { formula: string; note: string } {
  const parts = model.parameters.map((name, j) => ({ name, b: model.coefficients[j] ?? Number.NaN }));
  const terms = parts.map(({ name, b }, j) => {
    const mag = num(Math.abs(b));
    const sign = b < 0 ? "-" : "+";
    return j === 0 ? `${b < 0 ? "-" : ""}${mag}` : ` ${sign} ${mag}*${name}`;
  });
  const hasNominal = model.factors.some((f) => f.kind === "nominal");
  const note = [
    hasNominal ? "NAME[level] is the effect-coded indicator: 1 at that level, -1 at the factor's last level, 0 elsewhere." : "",
    model.factors.some((f) => f.kind === "continuous") && model.center_polynomials
      ? "(X-m) is a continuous factor centred by its mean m inside a crossed or polynomial term." : "",
  ].filter(Boolean).join(" ");
  return { formula: `${responseLabel} = ${terms.join("")}`, note };
}

export interface FitModelColumnsInput {
  fit: FitModelResponse;
  responseLabel: string;
  responseUnit: string;
  /** Original worksheet row behind each fitted request row. */
  rowIds: readonly number[];
}

/** The output worksheet: Row, Predicted, then the chosen optional columns. */
export function fitModelColumnsData(input: FitModelColumnsInput, opts: SaveColumnOptions): DataStruct {
  const { fit, responseLabel: y, responseUnit: unit } = input;
  const level = `${fmtNum((1 - fit.alpha) * 100)}%`;
  const labels = [`${y} predicted`];
  if (opts.residual) labels.push(`${y} residual`);
  if (opts.meanInterval) labels.push(`${y} mean lower ${level}`, `${y} mean upper ${level}`);
  if (opts.individualInterval) labels.push(`${y} indiv lower ${level}`, `${y} indiv upper ${level}`);
  const time: number[] = [];
  const values: number[][] = [];
  fit.predicted.forEach((p, i) => {
    const r = fit.residual[i];
    const se = fit.se_fit[i];
    if (p === null || p === undefined || r === null || r === undefined || se === null || se === undefined) return;
    const row = [p];
    if (opts.residual) row.push(r);
    if (opts.meanInterval) row.push(p - fit.t_crit * se, p + fit.t_crit * se);
    if (opts.individualInterval) {
      const half = fit.t_crit * Math.hypot(se, fit.summary.rmse);
      row.push(p - half, p + half);
    }
    time.push((input.rowIds[i] ?? i) + 1);
    values.push(row);
  });
  const { formula, note } = predictionFormula(fit.model, y);
  return {
    time, values, labels, units: labels.map(() => unit),
    metadata: {
      x_column_name: "Row", x_column_long: "Worksheet row", x_column_unit: "",
      prediction_formula: formula, ...(note ? { prediction_formula_note: note } : {}),
      fit_model_alpha: fit.alpha,
    },
  };
}
