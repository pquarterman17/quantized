// Fit weighting -> per-point 1-sigma `dy` (Sol GUI audit: connect fitting to the
// plotted error columns). The single shared place that turns a WeightMode into
// the `dy` vector every fit endpoint now takes (backend applies 1/dy^2). Pure:
// dataset + selection in -> dy out. Curve fitting consumes it first; peaks /
// baseline / magnetometry adopt it next (the small reusable helper, short of a
// full AnalysisSelection contract — see quantized-fit-weighting-design memory).
//
// Rows align with the fit's x/y because both read `analysisData` (exclusion +
// filter pruned, the #50/#53 chokepoint) — never `ds.data` directly.

import { analysisData } from "./rowstate";
import type { Dataset, FitWeighting } from "./types";

/** The `/fit` request field for a weighting's error scaling: present only
 *  when scaling is OFF (the route's default is on), so every replay of a
 *  recorded fit reproduces its parameter errors, not just its parameters. */
export function scaleErrorsField(weight: FitWeighting | undefined): { scale_errors?: false } {
  return weight?.scaleErrors === false && weight.mode !== "none" ? { scale_errors: false } : {};
}

/** The `/fit` request fields that carry a resolved weighting vector: `dy`
 *  (1-sigma errors, backend applies 1/dy^2) for the error modes, `weights`
 *  (used as w as given) for `direct` — plus the error-scaling switch. */
export function weightRequestFields(
  weight: FitWeighting | undefined,
  vec: number[],
): { dy?: number[]; weights?: number[]; scale_errors?: false } {
  return weight?.mode === "direct"
    ? { weights: vec, ...scaleErrorsField(weight) }
    : { dy: vec, ...scaleErrorsField(weight) };
}

export interface DyResolution {
  /** The weighting vector aligned to the analysis rows — 1-sigma errors, or
   *  for `direct` the weights themselves — or null = fit unweighted. */
  dy: number[] | null;
  /** Set when a required column is missing/invalid; the caller surfaces it and
   *  falls back to an unweighted fit (never fabricates sigmas). */
  issue?: string;
}

/** Resolve the `dy` vector for `weight` over `dataset`'s primary fit channel
 *  (`yKey`). `none` -> null (unweighted). `poisson` -> sqrt(max(|y|,1)) so
 *  sigma stays > 0. `yerr`/`manual` -> the abs of the `errKey` sigma column,
 *  rejected (issue, unweighted) if that column is missing or not strictly
 *  positive-finite. `direct` -> the `errKey` column AS IS (the weights; never
 *  abs'd — a negative weight is an error, not a typo to repair), rejected if
 *  any is negative/non-finite or all are zero; a zero weight is allowed and
 *  switches that point off.
 *
 *  `keep` (optional): the analysis-row indexes the fit actually uses (e.g.
 *  `dropGapRows(x, y).keep`). Validation then covers ONLY those rows — a gap
 *  row's sigma is dropped with the row, so it must not refuse the weighting.
 *  The returned `dy` stays aligned to ALL analysis rows either way. */
export function dyForFit(
  dataset: Dataset | null | undefined,
  yKey: number,
  weight: FitWeighting,
  keep?: readonly number[],
): DyResolution {
  if (weight.mode === "none") return { dy: null };
  const data = analysisData(dataset);
  if (!data) return { dy: null };

  if (weight.mode === "poisson") {
    // Counting statistics: sigma = sqrt(N), floored at 1 so a zero/near-zero
    // count can't demand infinite weight (backend requires dy > 0).
    const dy = data.values.map((row) => Math.sqrt(Math.max(Math.abs(row[yKey]), 1)));
    return { dy };
  }

  // yerr / manual: read a per-point sigma column by channel index.
  const errKey = weight.errKey;
  if (errKey == null || errKey < 0 || errKey >= data.labels.length) {
    return {
      dy: null,
      issue:
        weight.mode === "yerr"
          ? "no error column is designated for this channel — fitting unweighted"
          : weight.mode === "direct"
            ? "pick a column of weights — fitting unweighted"
            : "pick a column of per-point errors — fitting unweighted",
    };
  }
  if (weight.mode === "direct") {
    const w = data.values.map((row) => row[errKey]);
    const used = keep ? keep.map((i) => w[i]) : w;
    const invalid = (v: number | undefined) => v === undefined || !Number.isFinite(v) || v < 0;
    if (used.some(invalid) || !used.some((v) => (v as number) > 0)) {
      return {
        dy: null,
        issue: "the weight column has negative or invalid values (or is all zero) — fitting unweighted",
      };
    }
    return { dy: w };
  }
  const dy = data.values.map((row) => Math.abs(row[errKey]));
  const bad = (v: number | undefined) => v === undefined || !Number.isFinite(v) || v <= 0;
  if (keep ? keep.some((i) => bad(dy[i])) : dy.some(bad)) {
    return {
      dy: null,
      issue: "the error column has non-positive or invalid values — fitting unweighted",
    };
  }
  return { dy };
}
