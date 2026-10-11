// The pipeline fit-step decoder (#6), moved verbatim out of
// lib/fitselection.ts (bundle diet slice 22, plans/BUNDLE_HEADROOM.md). Only
// the lazy pipeline executor (`workshops/pipeline/executeSteps.ts`) calls it,
// so it loads with it. lib/fitselection.ts keeps the encoder
// (`fitStepParams`), which the eager fit path records with. Import this by
// path; lib/fitselection.ts does not re-export it.

import type { FitSpec, FitWeighting, WeightMode } from "./types";

const WEIGHT_MODES: readonly WeightMode[] = ["none", "yerr", "poisson", "manual"];

function decodeWeight(v: unknown): FitWeighting | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.mode !== "string" || !WEIGHT_MODES.includes(o.mode as WeightMode)) return undefined;
  const mode = o.mode as WeightMode;
  if (mode === "none") return undefined; // `none` = unweighted; keep specs minimal
  const weight: FitWeighting = { mode };
  if (typeof o.errKey === "number" && Number.isInteger(o.errKey)) weight.errKey = o.errKey;
  return weight;
}

/** Decode an untrusted fit-step `params` bag back into a FitSpec. A step with no
 *  numeric `yKey` decodes to a legacy `{model}` recipe (no channels) so the
 *  executor keeps the old time/values[0] behavior; a valid `yKey` restores the
 *  recorded channels + weighting. Every field is type-checked (never cast). */
export function fitSpecFromStepParams(params: Record<string, unknown>): FitSpec {
  const spec: FitSpec = { model: typeof params.model === "string" ? params.model : "Linear" };
  if (typeof params.yKey !== "number" || !Number.isInteger(params.yKey)) return spec;
  spec.yKey = params.yKey;
  spec.xKey =
    params.xKey === null || (typeof params.xKey === "number" && Number.isInteger(params.xKey))
      ? (params.xKey as number | null)
      : null;
  const weight = decodeWeight(params.weight);
  if (weight) spec.weight = weight;
  if (Array.isArray(params.range) && params.range.length === 2 &&
      params.range.every((value) => typeof value === "number" && Number.isFinite(value)) && params.range[0] <= params.range[1]) {
    spec.range = [params.range[0] as number, params.range[1] as number];
  }
  if (Object.hasOwn(params, "rowIds")) {
    spec.rowIds = Array.isArray(params.rowIds) && params.rowIds.length <= 1_000_000 &&
      params.rowIds.every((row) => Number.isInteger(row) && (row as number) >= 0)
      ? [...new Set(params.rowIds as number[])].sort((a, b) => a - b)
      : [];
  }
  if (Number.isInteger(params.sourceRowCount) && (params.sourceRowCount as number) >= 0) {
    spec.sourceRowCount = params.sourceRowCount as number;
  }
  if (typeof params.rowXFingerprint === "string" && /^x1:\d{1,7}:[0-9a-f]{16}$/.test(params.rowXFingerprint)) {
    spec.rowXFingerprint = params.rowXFingerprint;
  }
  if (Number.isInteger(params.nPoints) && (params.nPoints as number) >= 0) {
    spec.nPoints = params.nPoints as number;
  }
  return spec;
}
