// Fit Y by X — the per-(X,Y,order) analysis dispatch, factored out of
// useFitYByX.ts (JMP_GAP_PLAN J7) so the SAME leg computation can run once
// for the whole dataset (the un-partitioned view) and once per level of an
// optional By column without duplicating the fetch sequencing. Pure async
// orchestration — no React, no store; every dependency (data, kind,
// columns, order) is passed in explicitly, so a caller can run it on any
// DataStruct (the analysis view, or one By level's sliced subset).

import { statsAnova, statsChiSquareIndependence, statsFisherExact, statsLevene, statsRecommend, statsRegression, statsTukey, type RegressionBand } from "../../../lib/api";
import { categoryLevels, resolveCategoryLabels } from "../../../lib/barlayout";
import type { Recommendation } from "../../../lib/statschooser";
import type { CalcResult, DataStruct } from "../../../lib/types";

/** "unsupported" = a nominal/ordinal Y against a continuous X — JMP maps
 *  that combination to logistic fitting, out of this workbench's 3 legs. */
export type FitYByXKind = "oneway" | "bivariate" | "contingency" | "unsupported";

export interface OnewayGroup {
  label: string;
  values: number[];
}

export interface OnewayResult {
  groups: OnewayGroup[];
  anova: CalcResult;
  /** null when a group has <2 observations (Levene needs variance per group). */
  levene: CalcResult | null;
  /** null when only 2 levels (Tukey needs >2 to be more than a t-test). */
  tukey: CalcResult | null;
  recommend: Recommendation | null;
  /** Why an optional sub-test that RAN came back empty, keyed by test — so
   *  the view can say "<test> failed: <reason>" instead of dropping it. */
  failed?: SubtestFailures<"levene" | "tukey" | "recommend">;
}

export type SubtestFailures<K extends string> = Partial<Record<K, string>>;

export interface BivariateResult {
  x: number[];
  y: number[];
  order: number;
  regression: CalcResult;
  /** Standard OLS mean-response confidence band (JMP_GAP J3 residual), over
   *  a grid spanning [min(x), max(x)]. Null only if the band request itself
   *  failed independently of the main regression. */
  band: RegressionBand | null;
}

export interface ContingencyResult {
  rowLabels: string[];
  colLabels: string[];
  table: number[][];
  chiSquare: CalcResult;
  /** null unless the table is 2x2 (Fisher exact's only valid shape). */
  fisher: CalcResult | null;
  failed?: SubtestFailures<"fisher">;
}

/** One leg's landed result — exactly one of the three is set, matching
 *  whichever `kind` was run. */
export interface LegResult {
  oneway?: OnewayResult;
  bivariate?: BivariateResult;
  contingency?: ContingencyResult;
}

/** Run an optional sub-test: a rejection becomes null (the leg still lands)
 *  but its reason is recorded in `failed` (silent-failure audit 2026-10-01). */
function optional<K extends string, T>(failed: SubtestFailures<K>, key: K, p: Promise<T>): Promise<T | null> {
  return p.catch((e: unknown) => {
    failed[key] = e instanceof Error ? e.message : String(e);
    return null;
  });
}

const withFailures = <K extends string>(failed: SubtestFailures<K>): { failed?: SubtestFailures<K> } =>
  Object.keys(failed).length ? { failed } : {};

/** Only local minimum-sample validation is safe to omit from a By report. */
export class InsufficientDataError extends Error {}

export const colValues = (data: DataStruct, index: number): number[] =>
  index < 0 ? data.time : data.values.map((row) => row[index]);

/** Confidence-band evaluation grid: `n` evenly spaced points spanning
 *  [min(xs), max(xs)] inclusive. A degenerate (single-value) domain returns
 *  that one value repeated -- `polynomial_confidence_band` handles a
 *  repeated grid point fine (it's independent of the fitted x). */
export function bandGrid(xs: number[], n = 40): number[] {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (!(hi > lo)) return xs.length ? [lo] : [];
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

/** Partition yCol's finite values by xCol's finite levels, labeled the same
 *  way bar charts resolve category labels (an Origin text column when one
 *  consistently covers every level, else formatted numeric levels). */
export function groupsForOneway(data: DataStruct, xCol: number, yCol: number): OnewayGroup[] {
  const levels = categoryLevels(data, xCol);
  const labels = resolveCategoryLabels(data, xCol, levels);
  const xv = colValues(data, xCol);
  const yv = colValues(data, yCol);
  const buckets = new Map<number, number[]>();
  const n = Math.min(xv.length, yv.length);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(xv[i]) || !Number.isFinite(yv[i])) continue;
    const bucket = buckets.get(xv[i]);
    if (bucket) bucket.push(yv[i]);
    else buckets.set(xv[i], [yv[i]]);
  }
  return levels.map((lvl, i) => ({ label: labels[i], values: buckets.get(lvl) ?? [] }));
}

/** Run the dispatched leg (oneway / bivariate / contingency) on `data`,
 *  which may be the whole analysis view or one By level's sliced subset —
 *  identical validation/fetch sequencing either way. Throws a short,
 *  user-facing message ("need at least 2 non-empty levels for oneway", …)
 *  when `data` doesn't have enough rows/levels for the leg; callers running
 *  this per By level turn that into an honest "not enough data" line
 *  instead of letting it surface as a crash (JMP_GAP_PLAN J7 acceptance). */
export async function runLeg(
  data: DataStruct,
  kind: FitYByXKind,
  xCol: number,
  yCol: number,
  order: number,
  bandInterval: "confidence" | "prediction" = "confidence",
): Promise<LegResult> {
  if (kind === "oneway") {
    const groups = groupsForOneway(data, xCol, yCol).filter((g) => g.values.length > 0);
    if (groups.length < 2) throw new InsufficientDataError("need at least 2 non-empty levels for oneway");
    const valueArrays = groups.map((g) => g.values);
    const failed: SubtestFailures<"levene" | "tukey" | "recommend"> = {};
    const [anova, levene, recommend] = await Promise.all([
      statsAnova(valueArrays),
      valueArrays.every((g) => g.length >= 2) ? optional(failed, "levene", statsLevene(valueArrays)) : Promise.resolve(null),
      optional(failed, "recommend", statsRecommend({ groups: valueArrays })),
    ]);
    const tukey = groups.length > 2 ? await optional(failed, "tukey", statsTukey(valueArrays)) : null;
    return { oneway: { groups, anova, levene, tukey, recommend, ...withFailures(failed) } };
  }

  if (kind === "bivariate") {
    const xv = colValues(data, xCol);
    const yv = colValues(data, yCol);
    const n = Math.min(xv.length, yv.length);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(xv[i]) && Number.isFinite(yv[i])) {
        xs.push(xv[i]);
        ys.push(yv[i]);
      }
    }
    if (xs.length < order + 2) {
      throw new InsufficientDataError(`need at least ${order + 2} paired points for order-${order} regression`);
    }
    const regression = await statsRegression({
      x: xs, y: ys, order, band_x: bandGrid(xs), band_interval: bandInterval,
    });
    const band = (regression.band as RegressionBand | undefined) ?? null;
    return { bivariate: { x: xs, y: ys, order, regression, band } };
  }

  if (kind === "contingency") {
    const xLevels = categoryLevels(data, xCol);
    const yLevels = categoryLevels(data, yCol);
    if (xLevels.length < 2 || yLevels.length < 2) {
      throw new InsufficientDataError("need at least 2 levels in both columns for a contingency table");
    }
    const rowLabels = resolveCategoryLabels(data, xCol, xLevels);
    const colLabels = resolveCategoryLabels(data, yCol, yLevels);
    const xv = colValues(data, xCol);
    const yv = colValues(data, yCol);
    const rowIndex = new Map(xLevels.map((lvl, i) => [lvl, i]));
    const colIndex = new Map(yLevels.map((lvl, i) => [lvl, i]));
    const table: number[][] = xLevels.map(() => yLevels.map(() => 0));
    const n = Math.min(xv.length, yv.length);
    for (let i = 0; i < n; i++) {
      const ri = rowIndex.get(xv[i]);
      const ci = colIndex.get(yv[i]);
      if (ri === undefined || ci === undefined) continue;
      table[ri][ci] += 1;
    }
    const chiSquare = await statsChiSquareIndependence(table);
    const failed: SubtestFailures<"fisher"> = {};
    const fisher =
      xLevels.length === 2 && yLevels.length === 2 ? await optional(failed, "fisher", statsFisherExact(table)) : null;
    return { contingency: { rowLabels, colLabels, table, chiSquare, fisher, ...withFailures(failed) } };
  }

  return {};
}
