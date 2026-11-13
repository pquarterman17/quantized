// Curve Fit — residual diagnostic plot payloads (pure: no React, no store).
//
// Origin's NLFit residual plots: residual vs independent variable, residual
// vs fitted value, a histogram of the residuals and a normal Q-Q plot. Each
// is a PlotPayload for SmallUPlot (lib/uplotOpts' buildOpts).
//
// uPlot assumes an ascending x column for its scales, so the two scatter
// panels are SORTED by their abscissa — order does not matter for a point
// cloud, and sorting keeps a non-monotonic X (a hysteresis loop) plotting
// every point at its true coordinates. The histogram is an outline drawn as
// one stepped line (edges repeated), so it needs no bar renderer. The Q-Q
// pairs come from POST /api/fitting/diagnostics (calc.fit_stats'
// residual_diagnostics), which already returns them sorted.

import type { PlotPayload } from "../../../lib/plotdata";

type Num = number | null;

const finitePairs = (a: readonly Num[], b: readonly Num[]): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const u = a[i];
    const v = b[i];
    if (u != null && v != null && Number.isFinite(u) && Number.isFinite(v)) out.push([u, v]);
  }
  return out.sort((p, q) => p[0] - q[0]);
};

function scatter(pairs: [number, number][], xLabel: string, yLabel: string): PlotPayload {
  return {
    data: [pairs.map((p) => p[0]), pairs.map((p) => p[1])],
    series: [{ label: yLabel, unit: "", kind: "points" }],
    xLabel,
    xUnit: "",
  };
}

/** Sturges' rule bin count, at least 1 (n > 0). */
export function binCount(n: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(n, 1))) + 1);
}

/** Histogram counts over `bins` equal-width bins spanning [min, max]; the
 *  max lands in the last bin. Empty input -> no edges. */
export function histogram(values: readonly number[], bins = binCount(values.length)): { edges: number[]; counts: number[] } {
  if (values.length === 0) return { edges: [], counts: [] };
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) {
    lo -= 0.5;
    hi += 0.5;
  }
  const w = (hi - lo) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]!++;
  return { edges: Array.from({ length: bins + 1 }, (_, k) => lo + k * w), counts };
}

/** The histogram outline as one stepped line: 0 → each bar's top → 0. */
function histogramPayload(values: readonly number[]): PlotPayload {
  const { edges, counts } = histogram(values);
  const x: number[] = [];
  const y: number[] = [];
  counts.forEach((c, k) => {
    x.push(edges[k]!, edges[k]!, edges[k + 1]!, edges[k + 1]!);
    y.push(0, c, c, 0);
  });
  return { data: [x, y], series: [{ label: "count", unit: "" }], xLabel: "residual", xUnit: "" };
}

export interface ResidualPlots {
  vsX: PlotPayload;
  vsFitted: PlotPayload;
  histogram: PlotPayload;
  qq: PlotPayload | null;
}

/** The four residual panels for one fit. `qq` is null until the Q-Q pairs arrive. */
export function residualPlots(
  x: readonly number[],
  yFit: readonly Num[],
  residuals: readonly Num[],
  xLabel: string,
  qq?: { qqX: readonly Num[]; qqY: readonly Num[] } | null,
): ResidualPlots {
  const finite = residuals.filter((v): v is number => v != null && Number.isFinite(v));
  return {
    vsX: scatter(finitePairs(x, residuals), xLabel, "residual"),
    vsFitted: scatter(finitePairs(yFit, residuals), "fitted value", "residual"),
    histogram: histogramPayload(finite),
    qq: qq ? scatter(finitePairs(qq.qqX, qq.qqY), "normal quantile", "ordered residual") : null,
  };
}
