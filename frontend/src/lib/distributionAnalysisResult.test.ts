import { describe, expect, it } from "vitest";

import { analysisDataFingerprint } from "./analysisResultFreshness";
import { sanitizeAnalysisResults, type AnalysisResult, type AnalysisResultValue } from "./analysisResult";
import { distributionAnalysisResult, distributionRecipe, type DistributionRecipe, type DistributionSnapshot } from "./distributionAnalysisResult";
import type { Dataset } from "./types";

const source: Dataset = {
  id: "source", name: "measurements.csv",
  data: { time: [0, 1, 2], values: [[10, 0], [20, 1], [30, 0]], labels: ["signal", "lot"], units: ["V", ""], metadata: {} },
};
const recipe: DistributionRecipe = { col: 0, byCol: null, fitDist: "normal", compareOpen: true, percentileInput: 90 };
const snapshot: DistributionSnapshot = {
  label: "signal", byLabel: null,
  hist: { counts: [2, 1], centers: [15, 25], edges: [10, 20, 30] },
  desc: { N: 3, mean: 20, median: 20, std: 10, min: 10, q1: 15, q3: 25, max: 30 },
  norm: { W: 0.99, p: 0.7, N: 3 }, normNote: null, levels: [], totalLevels: 0,
  rankedFits: [{ dist: "normal", params: { mu: 20, sigma: 10 }, loglike: -10, aic: 24,
    n_params: 2, ks_d: 0.1, ks_p: 0.9, N: 3, aicc: null }],
  rankingMetric: "ks_p", quantiles: { q1: 13, median: 20, q3: 27 }, percentileValue: 32,
  skipped: [{ dist: "lognormal", reason: "requires positive data" }],
};

describe("distributionAnalysisResult", () => {
  it("preserves the summary, histogram, fits, and exact reopen recipe without source samples", () => {
    const result = distributionAnalysisResult("result", source, recipe, snapshot, "2026-10-09T00:00:00Z");
    expect(result).toMatchObject({
      producer: { id: "distribution-analysis" }, sources: [{ datasetId: "source" }], outputs: [],
      sourceFingerprint: analysisDataFingerprint(source), parameters: { recipe },
      selection: { channels: [{ index: 0, label: "signal", unit: "V" }] },
      tables: [
        { title: "Summary", columns: ["statistic", "value"] },
        { title: "Histogram", rows: [[10, 15, 20, 2], [20, 25, 30, 1]] },
        { title: "Distribution fits · ranked by KS p" },
        { title: "Fitted quantiles" },
      ],
    });
    expect(distributionRecipe(result)).toEqual({ ...recipe, ciPercent: 95, ciBootstrap: false });
    expect(JSON.stringify(result)).not.toContain('"values"');
    const [restored] = sanitizeAnalysisResults(JSON.parse(JSON.stringify([result])));
    expect(restored).toEqual(result);
    expect(distributionRecipe(restored, source)).toEqual({ ...recipe, ciPercent: 95, ciBootstrap: false });
  });

  it("saves By summaries and refuses malformed or future recipes", () => {
    const byRecipe = { ...recipe, byCol: 1, fitDist: "none" as const, compareOpen: false };
    const result = distributionAnalysisResult("by", source, byRecipe, {
      ...snapshot, byLabel: "lot", hist: null, desc: null, norm: null,
      levels: [{ label: "A", n: 2, hist: snapshot.hist, desc: snapshot.desc, norm: snapshot.norm, normNote: null, error: null }],
      totalLevels: 2, rankedFits: [], quantiles: null, percentileValue: null,
    });
    expect(result.tables?.[0]).toMatchObject({ title: "Summary by lot", rows: [["A", 2, 20, 20, 10, 10, 15, 25, 30, 0.99, 0.7]] });
    expect(result.warnings).toContain("Only 1 of 2 By levels were saved.");
    expect(distributionRecipe({ ...result, parameters: { recipe: { ...byRecipe, fitDist: "future" } } })).toBeNull();
    expect(distributionRecipe({ ...result, parameters: { recipe: { ...byRecipe, byCol: 0 } } })).toBeNull();
  });

  it("omits malformed histogram geometry instead of silently truncating it", () => {
    const result = distributionAnalysisResult("bad-hist", source, recipe, {
      ...snapshot, hist: { counts: [2, -1], centers: [15], edges: [10, 20, 20] },
    });
    expect(result.tables?.map((table) => table.title)).not.toContain("Histogram");
    expect(result.warnings).toContain("Histogram was not saved because its bin geometry was incomplete or invalid.");
  });
});

describe("distributionAnalysisResult records its input (acceptance C9)", () => {
  it("records channels, units, included rows out of total and the X range of the included rows", () => {
    const trimmed: Dataset = { ...source, excludedRows: [0] };
    const result = distributionAnalysisResult("result", trimmed, recipe, snapshot, "2026-10-09T00:00:00Z");
    expect(result.parameters?.["inputs"]).toMatchObject({ total: 1, items: [{
      datasetId: "source", rows: 3, includedRows: 2, xRange: null,
      channels: [{ label: "signal", unit: "V" }, { label: "lot", unit: "" }],
    }] });
  });
});

describe("distributionRecipe: the confidence-interval settings", () => {
  const saved = () => distributionAnalysisResult("r", source, { ...recipe, ciPercent: 99.5, ciBootstrap: true }, snapshot);
  const withCi = (ci: Record<string, unknown>): AnalysisResult => {
    const r = saved();
    const rec = (r.parameters as { recipe: Record<string, unknown> }).recipe;
    return { ...r, parameters: { ...r.parameters, recipe: { ...rec, ...ci } as AnalysisResultValue } };
  };

  it("round-trips the level and the switch exactly", () => {
    expect(distributionRecipe(saved())).toMatchObject({ ciPercent: 99.5, ciBootstrap: true });
  });

  it("a result saved before the table reads back as 95% without the bootstrap", () => {
    const r = saved();
    const { ciPercent: _p, ciBootstrap: _b, ...old } = (r.parameters as { recipe: Record<string, unknown> }).recipe;
    expect(distributionRecipe({ ...r, parameters: { ...r.parameters, recipe: old as AnalysisResultValue } })).toMatchObject({ ciPercent: 95, ciBootstrap: false });
  });

  it("an invalid level or switch fails closed instead of being guessed", () => {
    for (const bad of [{ ciPercent: 49.9 }, { ciPercent: 100 }, { ciPercent: "95" }, { ciPercent: null }, { ciBootstrap: "yes" }]) {
      expect(distributionRecipe(withCi(bad))).toBeNull();
    }
  });

  it("saves the interval table only when one was computed", () => {
    const ci = { n: 3, n_dropped: 0, level: 0.95, bootstrap: null, rows: [{ statistic: "mean", method: "t interval", estimate: 20, low: 5, high: 35, level: 0.95, note: null }] };
    const titles = (snap: DistributionSnapshot) => distributionAnalysisResult("r", source, recipe, snap).tables!.map((t) => t.title);
    expect(titles({ ...snapshot, ci })).toContain("Confidence intervals");
    expect(titles(snapshot)).not.toContain("Confidence intervals");
    expect(titles({ ...snapshot, ci: null })).not.toContain("Confidence intervals");
  });
});

