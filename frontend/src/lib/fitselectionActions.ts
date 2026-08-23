// Plotted-channel helpers + the fit-provenance recipe builder, split out of
// `lib/fitselection.ts` (2026-08-23, C2 bundle pass — see
// `frontend/scripts/check-bundle-size.mjs`'s header for the ratchet this
// split feeds). `lib/fitselection.ts` keeps `FitSelection` + the functions
// `store/useApp.ts`/`store/recalcFits.ts`/
// `components/workshops/pipeline/executeSteps.ts` need EAGERLY
// (`fitStepParams`/`fitSpecFromStepParams`/`fitDataForSpec`/`stampRecompute`,
// plus `selectedFitData` — which `fitDataForSpec` calls internally, so it
// stays put too). Everything below is reached only from the interactive fit
// workshops (curve fit, baseline, peaks, peak wizard, mag tools) — all
// already lazy `workshops/` panels, never the eager recompute path. Verified
// before moving: none of `fitStepParams`/`fitSpecFromStepParams`/
// `fitDataForSpec`/`stampRecompute`/`selectedFitData` calls any export below,
// and every real (non-test) importer of what moved is one of those lazy
// workshop hooks.

import { effectiveChannels } from "./plotdata";
import type { FitSelection } from "./fitselection";
import type { CalcResult, CorrectionParams, Dataset, DataStruct, FitSpec, FitWeighting } from "./types";

/** The FULL plotted-X column (not analysis-pruned): `time` when `xKey` is null,
 *  else the `xKey` channel. Used by overlays that must align to the full-length
 *  plot x while the analysis itself ran on the pruned rows. */
export function fullPlottedX(data: DataStruct, xKey: number | null): number[] {
  return xKey == null || xKey < 0 || xKey >= data.labels.length
    ? data.time
    : data.values.map((row) => row[xKey]);
}

/** The primary plotted Y CHANNEL index (first effective, after series order),
 *  or null when nothing is plotted. Column-only (no row pruning) — for tools
 *  that operate on the FULL data column (e.g. magnetometry transforms that
 *  convert every row) yet must still follow the plotted channel. */
export function plottedYKey(
  ds: Dataset,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
): number | null {
  const channels = effectiveChannels(ds.data, yKeys, xKey, ds.channelRoles, seriesOrder);
  return channels[0] ?? null;
}

/** Min/max of the finite values, or null when nothing is finite. Pure. */
export function finiteRange(xs: readonly number[]): [number, number] | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of xs) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Build a durable fit recipe (audit P1 #3) from the model, the plotted X, the
 *  fit selection (its `yKey`), and the fit result — so a later recompute
 *  reproduces the SAME channels and the workspace records what was produced. */
export function fitSpecFrom(
  model: string,
  xKey: number | null,
  sel: FitSelection,
  result: CalcResult,
  weight?: FitWeighting,
  /** Corrections active on the source at fit time (MAIN_PLAN #30). */
  preprocessing?: string[],
  /** Starting values / bounds / fixed flags, when the user changed them from
   *  the model defaults (MAIN_PLAN #30). Omitted when untouched — recording the
   *  registry default says nothing about what was CHOSEN. */
  starts?: {
    p0?: number[];
    lower?: (number | null)[];
    upper?: (number | null)[];
    fixed?: boolean[];
  },
  /** Injected so the recipe is reproducible in tests. */
  now: () => string = () => new Date().toISOString(),
): FitSpec {
  const spec: FitSpec = { model, xKey, yKey: sel.yKey, fittedAt: now() };
  // #30: the x-WINDOW the fit consumed, after exclusions/filters pruned it.
  // Without it a recipe names the channels but not which part of them, so
  // "fit the peak" and "fit the whole scan" look identical on reopening.
  const range = finiteRange(sel.x);
  if (range) {
    spec.range = range;
    spec.nPoints = sel.x.length;
  }
  if (preprocessing && preprocessing.length > 0) spec.preprocessing = preprocessing;
  if (starts?.p0) spec.p0 = starts.p0;
  if (starts?.lower) spec.lower = starts.lower;
  if (starts?.upper) spec.upper = starts.upper;
  if (starts?.fixed?.some(Boolean)) spec.fixed = starts.fixed;
  // Errors come from the fitter's covariance matrix whenever it returned
  // any — recording WHICH method produced them is the audit's point, since
  // "±0.02" means different things depending on its origin.
  spec.uncertainty = Array.isArray(result.errors) ? "covariance" : "none";
  // Record the weighting so recompute + pipeline reproduce it (audit P1 #3);
  // `none` is the default, so it stays absent to keep specs minimal.
  if (weight && weight.mode !== "none") spec.weight = weight;
  const params = result.params;
  if (Array.isArray(params) && params.every((v) => typeof v === "number")) {
    spec.params = params as number[];
  }
  if (typeof result.exitFlag === "number") spec.exitFlag = result.exitFlag;
  return spec;
}

/** Names of the corrections active on a dataset (MAIN_PLAN #30 provenance).
 *
 *  Names only, never values: the point is "this fit ran on smoothed,
 *  background-subtracted data", which is what makes a reproduction honest.
 *  Duplicating the parameter values here would be a second copy of
 *  `Dataset.corrections` that can drift from the real one. */
export function activeCorrectionNames(corrections: CorrectionParams | undefined): string[] {
  if (!corrections) return [];
  const on: string[] = [];
  const c = corrections as Record<string, unknown>;
  for (const [key, value] of Object.entries(c)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "number" && value === 0) continue; // an unset offset
    if (typeof value === "boolean" && !value) continue;
    if (typeof value === "string" && (value === "" || value === "None")) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    on.push(key);
  }
  return on.sort();
}
