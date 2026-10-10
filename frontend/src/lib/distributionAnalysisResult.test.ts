import { describe, expect, it } from "vitest";

import { analysisDataFingerprint } from "./analysisResultFreshness";
import { sanitizeAnalysisResults } from "./analysisResult";
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
    expect(distributionRecipe(result)).toEqual(recipe);
    expect(JSON.stringify(result)).not.toContain('"values"');
    const [restored] = sanitizeAnalysisResults(JSON.parse(JSON.stringify([result])));
    expect(restored).toEqual(result);
    expect(distributionRecipe(restored, source)).toEqual(recipe);
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
