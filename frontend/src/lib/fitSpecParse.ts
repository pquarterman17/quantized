// `.dwk` read side of `Dataset.fitSpec` (lib/types.ts `FitSpec`), split out of
// lib/workspaceDatasetParse.ts so every recorded field has ONE reader.
//
// The 2026-10-01 round-trip audit found that the MAIN_PLAN #30 half of the
// recipe (`range`/`nPoints`/`fittedAt`/`recomputedAt`/`preprocessing`/`p0`/
// `lower`/`upper`/`fixed`/`uncertainty`) was WRITTEN by `fitSpecFrom` and the
// serializer but never read back. After a reopen the recalc graph
// (store/recalcFits.ts) refit from the model's registry defaults instead of the
// user's start values, bounds and fixed flags, and the Library's "recomputed"
// mark disappeared. lib/workspaceRoundTrip.test.ts pins the round trip.
//
// Additive and tolerant: every field is validated on its own and simply left
// absent when missing or malformed, so an older file (`{model}` only, or the
// audit-P1 #3 subset) reads exactly as it did before.

import type { FitSpec, FitWeighting, WeightMode } from "./types";

const WEIGHT_MODES: readonly WeightMode[] = ["yerr", "poisson", "manual"];

const isFinite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A finite-number list, or undefined when any entry is not one. */
function numbers(v: unknown): number[] | undefined {
  return Array.isArray(v) && v.every(isFinite) ? [...v] : undefined;
}

function nullableNumbers(v: unknown): (number | null)[] | undefined {
  return Array.isArray(v) && v.every((item) => item === null || isFinite(item)) ? [...v] : undefined;
}

/** A bound list: finite numbers, `null` where unbounded (the wire form). */
function bounds(v: unknown): (number | null)[] | undefined {
  return Array.isArray(v) && v.every((b) => b === null || isFinite(b)) ? [...v] : undefined;
}

function weighting(v: unknown): FitWeighting | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const w = v as Record<string, unknown>;
  // `none` is the default and is never stored, so it is not accepted here.
  if (!WEIGHT_MODES.includes(w.mode as WeightMode)) return undefined;
  const out: FitWeighting = { mode: w.mode as WeightMode };
  if (Number.isInteger(w.errKey) && (w.errKey as number) >= 0) out.errKey = w.errKey as number;
  return out;
}

/** Validate a persisted fit recipe; undefined when it names no model. */
export function parseFitSpec(v: unknown): FitSpec | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const fs = v as Record<string, unknown>;
  if (typeof fs.model !== "string") return undefined;
  const spec: FitSpec = { model: fs.model };
  // Audit P1 #3 provenance: the channels that were fit, and the weighting.
  if (fs.xKey === null || Number.isInteger(fs.xKey)) spec.xKey = fs.xKey as number | null;
  if (Number.isInteger(fs.yKey) && (fs.yKey as number) >= 0) spec.yKey = fs.yKey as number;
  const weight = weighting(fs.weight);
  if (weight) spec.weight = weight;
  const params = numbers(fs.params);
  if (params) spec.params = params;
  const errors = nullableNumbers(fs.errors);
  if (errors && (!params || errors.length === params.length)) spec.errors = errors;
  for (const field of ["R2", "RMSE", "AIC", "chiSqRed"] as const) {
    if (isFinite(fs[field])) spec[field] = fs[field];
  }
  if (Number.isInteger(fs.nFree) && (fs.nFree as number) >= 0) spec.nFree = fs.nFree as number;
  if (typeof fs.exitFlag === "number") spec.exitFlag = fs.exitFlag;
  // MAIN_PLAN #30: the rest of the reproducible recipe.
  const range = numbers(fs.range);
  if (range && range.length === 2) spec.range = [range[0], range[1]];
  if (Number.isInteger(fs.nPoints) && (fs.nPoints as number) >= 0) spec.nPoints = fs.nPoints as number;
  if (typeof fs.fittedAt === "string" && fs.fittedAt) spec.fittedAt = fs.fittedAt;
  if (typeof fs.recomputedAt === "string" && fs.recomputedAt) spec.recomputedAt = fs.recomputedAt;
  if (Array.isArray(fs.preprocessing) && fs.preprocessing.every((s) => typeof s === "string")) {
    spec.preprocessing = [...(fs.preprocessing as string[])];
  }
  const p0 = numbers(fs.p0);
  if (p0) spec.p0 = p0;
  const lower = bounds(fs.lower);
  if (lower) spec.lower = lower;
  const upper = bounds(fs.upper);
  if (upper) spec.upper = upper;
  if (Array.isArray(fs.fixed) && fs.fixed.every((f) => typeof f === "boolean")) {
    spec.fixed = [...(fs.fixed as boolean[])];
  }
  if (fs.uncertainty === "covariance" || fs.uncertainty === "none") spec.uncertainty = fs.uncertainty;
  return spec;
}
