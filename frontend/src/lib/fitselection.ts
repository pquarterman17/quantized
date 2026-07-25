// Shared plotted-channel -> fit-input bridge. Curve fitting must consume the
// same primary X/Y pair the Stage shows, after row exclusions and filters.
// Also the provenance bridge (audit P1 #3): `fitSpecFrom` records the fit's
// recipe and `fitDataForSpec` reproduces it on recompute.

import { dyForFit } from "./fitweights";
import { effectiveChannels } from "./plotdata";
import { analysisData } from "./rowstate";
import type {
  CorrectionParams,
  CalcResult,
  Dataset,
  DataStruct,
  FitSpec,
  FitWeighting,
  WeightMode,
} from "./types";

export interface FitSelection {
  x: number[];
  y: number[];
  yKey: number;
  /** 1-sigma errors for the recorded weighting (recompute path only); null/
   *  absent = unweighted. Only `fitDataForSpec` populates it — the interactive
   *  hook resolves weighting from the live UI state instead. */
  dy?: number[] | null;
}

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

export function selectedFitData(
  dataset: Dataset | null | undefined,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
): FitSelection | null {
  const data = analysisData(dataset);
  if (!dataset || !data) return null;
  const channels = effectiveChannels(
    data,
    yKeys,
    xKey,
    dataset.channelRoles,
    seriesOrder,
  );
  const yKey = channels[0];
  if (yKey === undefined) return null;
  const x = xKey == null ? data.time : data.values.map((row) => row[xKey]);
  const y = data.values.map((row) => row[yKey]);
  return { x, y, yKey };
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

// ── Pipeline fit-step params bridge (#6) ───────────────────────────────────
// A recorded "fit" step must carry the SAME recipe as the FitSpec so a template
// batch reproduces the interactive fit's channels + weighting, not time/
// values[0]. These are the pure encoder/decoder between a FitSpec and the
// step's untrusted `params` bag (round-trips through localStorage
// `qz.analysisTemplates` + saved .dwk workspaces — validate, never cast).

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

/** Encode a FitSpec into a fit step's `params` object. Minimal + mirrors
 *  `fitSpecFrom`: the channels the fit used plus a non-`none` weighting; the
 *  result snapshot (`params`/`exitFlag`) is NEVER encoded — a step is a recipe,
 *  not a result. Absent channels are omitted (legacy `{model}` shape). */
export function fitStepParams(model: string, spec: FitSpec): Record<string, unknown> {
  const params: Record<string, unknown> = { model };
  if (spec.yKey !== undefined) {
    params.yKey = spec.yKey;
    if (spec.xKey !== undefined) params.xKey = spec.xKey; // `null` (time axis) round-trips
  }
  if (spec.weight && spec.weight.mode !== "none") params.weight = spec.weight;
  return params;
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
  return spec;
}

/** Fit inputs for a SAVED spec on recompute: reproduce the spec's recorded
 *  channels (provenance) over the current analysis rows (#50/#53). Legacy specs
 *  without channels — or a stored channel that no longer exists after a column
 *  change — fall back to the live plotted selection. */
export function fitDataForSpec(
  dataset: Dataset | null | undefined,
  spec: FitSpec,
  liveXKey: number | null,
  liveYKeys: number[] | null,
  liveSeriesOrder: number[] | null,
): FitSelection | null {
  if (spec.xKey === undefined && spec.yKey === undefined) {
    return selectedFitData(dataset, liveXKey, liveYKeys, liveSeriesOrder);
  }
  const data = analysisData(dataset);
  if (!dataset || !data) return null;
  const width = data.labels.length;
  const yKey = spec.yKey ?? 0;
  if (yKey < 0 || yKey >= width) {
    return selectedFitData(dataset, liveXKey, liveYKeys, liveSeriesOrder);
  }
  const xKey = spec.xKey ?? null;
  const x =
    xKey == null || xKey < 0 || xKey >= width ? data.time : data.values.map((row) => row[xKey]);
  const y = data.values.map((row) => row[yKey]);
  if (!spec.weight) return { x, y, yKey };
  // Reproduce the recorded weighting over the same analysis rows (Sol audit);
  // a missing/invalid error column refits unweighted (dyForFit returns null).
  return { x, y, yKey, dy: dyForFit(dataset, yKey, spec.weight).dy };
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

/** Stamp a spec with the result of a RECOMPUTE (MAIN_PLAN #30).
 *
 *  Params are refreshed together with the timestamp on purpose: leaving the
 *  original numbers beside a fresh `recomputedAt` would claim the fit was
 *  re-run while showing the values it produced last time, which is worse than
 *  either alone. Pure, so the recalc path stays a thin caller. */
export function stampRecompute(
  spec: FitSpec,
  result: CalcResult,
  now: () => string = () => new Date().toISOString(),
): FitSpec {
  const params = result.params;
  return {
    ...spec,
    recomputedAt: now(),
    ...(Array.isArray(params) && params.every((v) => typeof v === "number")
      ? { params: params as number[] }
      : {}),
    ...(typeof result.exitFlag === "number" ? { exitFlag: result.exitFlag } : {}),
  };
}
