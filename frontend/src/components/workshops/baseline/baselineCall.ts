// Baseline workshop: the per-method endpoint dispatch (split out of
// useBaseline.ts), plus the large-data transport (plans/LARGE_PAYLOAD_PLAN.md):
//
// - inputs by dataset handle: when the server holds the worksheet, a request
//   names it (handle + channels + rows) instead of posting x/y
//   (lib/fitSource.postBySource; a miss resends once, then posts the arrays);
// - the lean preview for large estimates: the preview draws a per-bucket
//   display and the full baseline (data: it is subtracted) is fetched by
//   result id only when the user subtracts it. Every method supports it.

import {
  baselineALS, baselineAnchor, baselineEstimate, baselineEstimateLean, baselineLean, baselineModPoly,
  baselineModPolyLean, baselineRegion, baselineRollingBall, baselineShirley, baselineXrdLowAngle,
  type LeanBaselineResult,
} from "../../../lib/api/baseline";
import {
  arrayByIdOr, displayColumn, leanTransport,
} from "../../../lib/api/resultArrays";
import { postBySource, type FitSource, type Rows, type SourceOnly } from "../../../lib/fitSource";
import type { DataStruct } from "../../../lib/types";
import type { BaselineMethod, BaselineParams } from "./useBaseline";

type Num = number | null;

/** Where a request's x/y came from: the whole of `data`'s columns (the
 *  baseline workshop estimates over every row of the plotted channels). */
export interface BaselineBy {
  src: FitSource;
  rows: Rows;
}

/** The by-handle source for the whole X/Y columns of `data` (`xKey` null =
 *  time). The server holds the data only when `data` has a remembered handle;
 *  otherwise `postBySource` posts the arrays. */
export function baselineBy(data: DataStruct, xKey: number | null, yKey: number): BaselineBy {
  const n = data.time.length;
  return { src: { data, xKey, yKey }, rows: { runs: n > 0 ? [[0, n]] : [] } };
}

/** The full response of any baseline route, as far as the workshop reads it. */
type RawBaseline = { baseline?: Num[]; background?: Num[] };

interface Plan {
  path: string;
  body: object;
  /** y-only routes name just the Y channel. */
  only?: SourceOnly;
  /** The request with the arrays, as it always was. */
  call: () => Promise<RawBaseline>;
}

/** The full-range polynomial methods reuse the region-fit calc (#8: the
 *  BG-from-region polyfit surfaced as first-class picker choices). */
function regionOrder(method: BaselineMethod, p: BaselineParams): number {
  return method === "linear" ? 1 : method === "quadratic" ? 2 : p.order;
}

/** The data range (loop, not Math.min(...spread): spreading a 100k+-point x
 *  array as call arguments throws RangeError above the engine's arity cap). */
function finiteExtent(x: number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of x) {
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return [lo, hi];
}

function planFor(method: BaselineMethod, x: number[], y: number[], p: BaselineParams, anchors: [number, number][]): Plan {
  switch (method) {
    case "als": {
      const body = { y, lam: p.lam, p: p.p };
      return { path: "/api/baseline/als", body, only: "y", call: () => baselineALS(body) };
    }
    case "rollingball": {
      const body = { y, radius: p.radius };
      return { path: "/api/baseline/rollingball", body, only: "y", call: () => baselineRollingBall(body) };
    }
    case "modpoly": {
      const body = { y, order: p.order };
      return { path: "/api/baseline/modpoly", body, only: "y", call: () => baselineModPoly(body) };
    }
    case "snip": {
      const body = { x, y, method: "snip" };
      return { path: "/api/baseline/estimate", body, call: () => baselineEstimate(body) };
    }
    case "anchor": {
      const body = { x, y, anchors, method: p.anchorMethod };
      return { path: "/api/baseline/anchor", body, call: () => baselineAnchor(body) };
    }
    case "shirley": {
      const body = { x, y, max_iter: p.maxIter };
      return { path: "/api/baseline/shirley", body, call: () => baselineShirley(body) };
    }
    case "xrdla": {
      const body = { x, y };
      return { path: "/api/baseline/xrdlowangle", body, call: () => baselineXrdLowAngle(body) };
    }
    case "region":
    case "linear":
    case "quadratic":
    case "poly": {
      // Default the box to the full x-range; "region" lets the user narrow it
      // to background-only, the analytic methods (#8) always fit the full range.
      const [lo, hi] = finiteExtent(x);
      const useBox = method === "region";
      const xMin = useBox && Number.isFinite(p.regionXMin) ? p.regionXMin : lo;
      const xMax = useBox && Number.isFinite(p.regionXMax) ? p.regionXMax : hi;
      // Optional 2-D y-box (MATLAB `onBGMouseUp` parity, GAP #96/#20): unlike
      // x, an unset edge sends `undefined` (dropped by JSON.stringify), NOT
      // a full-range default — omitting both is exactly today's request body,
      // byte-identical. Only the box method itself uses it; the always-
      // full-range analytic methods (#8) never did and still don't.
      const yMin = useBox && Number.isFinite(p.regionYMin) ? p.regionYMin : undefined;
      const yMax = useBox && Number.isFinite(p.regionYMax) ? p.regionYMax : undefined;
      const body = { x, y, x_min: xMin, x_max: xMax, y_min: yMin, y_max: yMax, order: regionOrder(method, p) };
      return { path: "/api/baseline/region", body, call: () => baselineRegion(body) };
    }
  }
}

/** Dispatch to the right baseline endpoint for the chosen method. `by`: send
 *  the dataset handle + rows instead of x/y when the server holds the data. */
export async function callBaseline(
  method: BaselineMethod,
  x: number[],
  y: number[],
  p: BaselineParams,
  anchors: [number, number][],
  by?: BaselineBy,
): Promise<{ baseline: Num[] }> {
  const plan = planFor(method, x, y, p, anchors);
  const raw = await postBySource<RawBaseline, object>(plan.path, plan.body, by?.src, by?.rows ?? [], plan.call, { only: plan.only });
  // The region endpoint returns the polynomial as `background`; adapt to `baseline`.
  return { baseline: raw.baseline ?? raw.background ?? [] };
}

export interface BaselinePreview {
  /** Full length; for a lean preview only the display rows are set. */
  baseline: Num[];
  /** Lean preview: the full baseline, by id (re-running the request on a miss). */
  full?: () => Promise<Num[]>;
}

/** `callBaseline`, except an estimate of many rows asks for the lean response
 *  (the 38 MB of a 1M-row response stays on the server). */
export async function callBaselinePreview(
  method: BaselineMethod,
  x: number[],
  y: number[],
  p: BaselineParams,
  anchors: [number, number][],
  by?: BaselineBy,
): Promise<BaselinePreview> {
  const lean = leanTransport(y.length);
  if (!("display_points" in lean)) return callBaseline(method, x, y, p, anchors, by);
  const plan = planFor(method, x, y, p, anchors);
  const arrays = (): Promise<LeanBaselineResult> =>
    method === "snip" ? baselineEstimateLean({ x, y, method: "snip", ...lean })
      : method === "modpoly" ? baselineModPolyLean({ y, order: p.order, ...lean })
        : baselineLean(plan.path, { ...plan.body, ...lean });
  const res = await postBySource<LeanBaselineResult, object>(
    plan.path, { ...plan.body, ...lean }, by?.src, by?.rows ?? [], arrays, { only: plan.only });
  if (!res.baselineDisplay) return { baseline: res.baseline ?? [] };
  const rerun = async (): Promise<Num[]> => (await callBaseline(method, x, y, p, anchors, by)).baseline;
  return {
    baseline: displayColumn(res.baselineDisplay, y.length),
    full: () => arrayByIdOr(res.resultId, "baseline", rerun),
  };
}
