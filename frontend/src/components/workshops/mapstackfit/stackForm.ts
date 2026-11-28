// Map stack fit: the form's text fields -> the request, with a reason for
// every refusal (nothing is sent on a bad field).

import type { StackFitRequest } from "../../../lib/api/mapStackFit";
import type { DataStruct, FitModel } from "../../../lib/types";

export interface ParamRow {
  start: string;
  lower: string;
  upper: string;
  fixed: boolean;
}

export interface StackForm {
  model: string;
  xLabel: string;
  keepUnconverged: boolean;
  rows: ParamRow[];
}

export const emptyRows = (model: FitModel | undefined): ParamRow[] =>
  (model?.paramNames ?? []).map(() => ({ start: "", lower: "", upper: "", fixed: false }));

/** "" -> null (open / automatic); a number -> itself; anything else -> NaN. */
const field = (text: string): number | null => (text.trim() === "" ? null : Number(text));

export type Built = { req: StackFitRequest } | { error: string };

export function buildStackRequest(
  form: StackForm,
  model: FitModel,
  layers: readonly { name: string; data: DataStruct }[],
  xText: readonly string[],
): Built {
  if (layers.length < 3) return { error: "Pick at least 3 maps: a curve needs 3 or more points per pixel." };
  const x = xText.map((t) => (t.trim() === "" ? NaN : Number(t)));
  const badX = x.findIndex((v) => !Number.isFinite(v));
  if (badX >= 0) return { error: `Enter a number for ${layers[badX]!.name} (its value of ${form.xLabel || "the independent variable"}).` };
  if (Math.min(...x) === Math.max(...x)) return { error: "The maps all have the same value; a curve needs them to differ." };
  const start = form.rows.map((r) => field(r.start));
  const lower = form.rows.map((r) => field(r.lower));
  const upper = form.rows.map((r) => field(r.upper));
  for (let k = 0; k < model.paramNames.length; k++) {
    const name = model.paramNames[k]!;
    const row = form.rows[k]!;
    for (const [what, v] of [["start", start[k]], ["lower bound", lower[k]], ["upper bound", upper[k]]] as const) {
      if (v !== null && v !== undefined && !Number.isFinite(v)) return { error: `${name}: the ${what} is not a number.` };
    }
    if (row.fixed && start[k] === null) return { error: `${name} is held, so it needs a start value.` };
    const lo = lower[k], hi = upper[k];
    if (lo !== null && lo !== undefined && hi !== null && hi !== undefined && lo >= hi) return { error: `${name}: the lower bound must be below the upper bound.` };
  }
  if (form.rows.every((r) => r.fixed)) return { error: "Every parameter is held; leave at least one free." };
  return {
    req: {
      datasets: layers.map((l) => l.data),
      layer_names: layers.map((l) => l.name),
      x_values: x,
      x_label: form.xLabel.trim() || "x",
      model: model.name,
      p0: start,
      lower,
      upper,
      fixed: form.rows.map((r) => r.fixed),
      keep_unconverged: form.keepUnconverged,
    },
  };
}

/** One line per failure reason, for the result block. */
export function summaryLines(s: { n_pixels: number; n_fitted: number; n_failed: number; n_no_data: number; n_unconverged_kept: number; failures: { reason: string; count: number; first_pixel: { row: number; col: number } }[] }): string[] {
  const lines = [`${s.n_fitted} of ${s.n_pixels} pixels fitted; ${s.n_failed} failed (blank in every map)${s.n_no_data ? `; ${s.n_no_data} had no data` : ""}.`];
  if (s.n_unconverged_kept) lines.push(`${s.n_unconverged_kept} fits that did not converge were kept (0 in the converged map).`);
  for (const f of s.failures) lines.push(`${f.count} × ${f.reason} (first at row ${f.first_pixel.row + 1}, column ${f.first_pixel.col + 1})`);
  return lines;
}
