// Baseline workshop: the per-method endpoint dispatch (split out of
// useBaseline.ts), plus the lean preview for large SNIP / ModPoly estimates
// (P4 phase 4, plans/LARGE_PAYLOAD_PLAN.md): the preview draws a per-bucket
// display and the full baseline (data: it is subtracted) is fetched by
// result id only when the user subtracts it.

import {
  baselineALS, baselineAnchor, baselineEstimate, baselineEstimateLean, baselineModPoly,
  baselineModPolyLean, baselineRegion, baselineRollingBall, baselineShirley, baselineXrdLowAngle,
} from "../../../lib/api/baseline";
import {
  arrayByIdOr, displayColumn, leanTransport,
} from "../../../lib/api/resultArrays";
import type { BaselineMethod, BaselineParams } from "./useBaseline";

/** The full-range polynomial methods reuse the region-fit calc (#8: the
 *  BG-from-region polyfit surfaced as first-class picker choices). */
function regionOrder(method: BaselineMethod, p: BaselineParams): number {
  return method === "linear" ? 1 : method === "quadratic" ? 2 : p.order;
}

/** Dispatch to the right baseline endpoint for the chosen method. */
export function callBaseline(
  method: BaselineMethod,
  x: number[],
  y: number[],
  p: BaselineParams,
  anchors: [number, number][],
): Promise<{ baseline: (number | null)[] }> {
  switch (method) {
    case "als":
      return baselineALS({ y, lam: p.lam, p: p.p });
    case "rollingball":
      return baselineRollingBall({ y, radius: p.radius });
    case "modpoly":
      return baselineModPoly({ y, order: p.order });
    case "snip":
      return baselineEstimate({ x, y, method: "snip" });
    case "anchor":
      return baselineAnchor({ x, y, anchors, method: p.anchorMethod });
    case "shirley":
      return baselineShirley({ x, y, max_iter: p.maxIter });
    case "xrdla":
      return baselineXrdLowAngle({ x, y });
    case "region":
    case "linear":
    case "quadratic":
    case "poly": {
      // Default the box to the full x-range; "region" lets the user narrow it
      // to background-only, the analytic methods (#8) always fit the full range.
      // Loop, not Math.min(...spread): spreading a 100k+-point x array as
      // call arguments throws RangeError above the engine's arity cap - and
      // the analytic methods (#8) take this path on EVERY compute.
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of x) {
        if (Number.isFinite(v)) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
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
      // The region endpoint returns the polynomial as `background`; adapt to `baseline`.
      return baselineRegion({
        x, y, x_min: xMin, x_max: xMax, y_min: yMin, y_max: yMax, order: regionOrder(method, p),
      }).then((r) => ({ baseline: r.background }));
    }
  }
}

export interface BaselinePreview {
  /** Full length; for a lean preview only the display rows are set. */
  baseline: (number | null)[];
  /** Lean preview: the full baseline, by id (re-running the request on a miss). */
  full?: () => Promise<(number | null)[]>;
}

/** `callBaseline`, except a SNIP / ModPoly estimate of many rows asks for the
 *  lean response (the 38 MB of a 1M-row response stays on the server). */
export async function callBaselinePreview(
  method: BaselineMethod,
  x: number[],
  y: number[],
  p: BaselineParams,
  anchors: [number, number][],
): Promise<BaselinePreview> {
  const lean = leanTransport(y.length);
  if ((method !== "snip" && method !== "modpoly") || !("display_points" in lean)) {
    return callBaseline(method, x, y, p, anchors);
  }
  const res = method === "snip"
    ? await baselineEstimateLean({ x, y, method: "snip", ...lean })
    : await baselineModPolyLean({ y, order: p.order, ...lean });
  if (!res.baselineDisplay) return { baseline: res.baseline ?? [] };
  const rerun = async (): Promise<(number | null)[]> => (await callBaseline(method, x, y, p, anchors)).baseline;
  return {
    baseline: displayColumn(res.baselineDisplay, y.length),
    full: () => arrayByIdOr(res.resultId, "baseline", rerun),
  };
}
