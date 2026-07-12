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

export interface DyResolution {
  /** 1-sigma errors aligned to the analysis rows, or null = fit unweighted. */
  dy: number[] | null;
  /** Set when a required column is missing/invalid; the caller surfaces it and
   *  falls back to an unweighted fit (never fabricates sigmas). */
  issue?: string;
}

/** Resolve the `dy` vector for `weight` over `dataset`'s primary fit channel
 *  (`yKey`). `none` -> null (unweighted). `poisson` -> sqrt(max(|y|,1)) so
 *  sigma stays > 0. `yerr`/`manual` -> the abs of the `errKey` sigma column,
 *  rejected (issue, unweighted) if that column is missing or not strictly
 *  positive-finite. */
export function dyForFit(
  dataset: Dataset | null | undefined,
  yKey: number,
  weight: FitWeighting,
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
          : "pick a column of per-point errors — fitting unweighted",
    };
  }
  const dy = data.values.map((row) => Math.abs(row[errKey]));
  if (dy.some((v) => !Number.isFinite(v) || v <= 0)) {
    return {
      dy: null,
      issue: "the error column has non-positive or invalid values — fitting unweighted",
    };
  }
  return { dy };
}
