// Saving a snapshot result (Distribution, Fit Y by X, Variability, Outlier
// screening, Multivariate): one undo step, no duplicate for the same
// computation, Save works again after Undo / delete / a real change, and
// recalc mode never changes what counts as current. Written as
// characterization tests BEFORE the five hand-written duplicate checks were
// folded into store/snapshotResultSave.ts.
import { beforeEach, describe, expect, it } from "vitest";

import { analysisDataFingerprint, snapshotResultState } from "../lib/analysisResultFreshness";
import { distributionAnalysisResult } from "../lib/distributionAnalysisResult";
import type { DistributionRecipe, DistributionSnapshot } from "../lib/distributionAnalysisResult";
import type { FitYByXRecipe, FitYByXSnapshot } from "../lib/fitYByXAnalysisResult";
import type { MultivariateRecipe, MultivariateSnapshot } from "../lib/multivariateAnalysisResult";
import type { OutlierScreeningRecipe, OutlierScreeningSnapshot } from "../lib/outlierScreeningAnalysisResult";
import type { Dataset } from "../lib/types";
import type { VariabilitySnapshot } from "../lib/variabilityAnalysisResult";
import { publishDistributionResult } from "./distributionResults";
import { publishFitYByXResult } from "./fitYByXResults";
import { publishMultivariateResult } from "./multivariateResults";
import { publishOutlierScreeningResult } from "./outlierScreeningResults";
import { useApp } from "./useApp";
import { publishVariabilityResult } from "./variabilityResults";

const SOURCE: Dataset = {
  id: "src", name: "run.csv",
  data: {
    time: [0, 1, 2, 3], values: [[1, 0, 5], [2, 0, 6], [3, 1, 7], [4, 1, 9]],
    labels: ["a", "b", "c"], units: ["V", "", "nm"], metadata: {},
  },
  channelTypes: { 0: "continuous", 1: "nominal", 2: "continuous" },
};

const distRecipe: DistributionRecipe = { col: 0, byCol: null, fitDist: "normal", compareOpen: false, percentileInput: 90 };
const distSnapshot: DistributionSnapshot = {
  label: "a", byLabel: null, hist: { counts: [2, 1], centers: [15, 25], edges: [10, 20, 30] },
  desc: { N: 3, mean: 20, median: 20, std: 10, min: 10, q1: 15, q3: 25, max: 30 },
  norm: { W: 0.99, p: 0.7, N: 3 }, normNote: null, levels: [], totalLevels: 0, rankedFits: [],
  rankingMetric: "ks_p", quantiles: { q1: 13, median: 20, q3: 27 }, percentileValue: 32, skipped: [],
};
const fitRecipe: FitYByXRecipe = { xCol: 1, yCol: 2, byCol: null, order: 1, bandInterval: "confidence" };
const fitSnapshot: FitYByXSnapshot = {
  mode: "oneway", xLabel: "b", yLabel: "c", byLabel: null, levels: [], totalLevels: 0,
  oneway: {
    groups: [{ label: "0", values: [5, 6] }, { label: "1", values: [7, 9] }],
    anova: { fStat: 5, df1: 1, df2: 2, pValue: 0.1, reject: false }, levene: { p: 0.8 }, tukey: null,
    recommend: { recommendation: "One-way ANOVA", endpoint: "/api/stats/anova", parametric: true,
      n_groups: 2, paired: false, checks: { alpha: 0.05, shapiro_p: [0.5, 0.6] }, reasons: [] },
    failed: {},
  },
};
const varRecipe = { responseCol: 2, factorACol: 1, factorBCol: 0 };
const varSnapshot: VariabilitySnapshot = {
  responseLabel: "c", factorALabel: "b", factorBLabel: "a",
  levelLabels: [{ aLabel: "0", bLabels: ["1", "2"] }, { aLabel: "1", bLabels: ["3", "4"] }],
  anova: {
    table: [{ source: "A", SS: 16, df: 1, MS: 16, F: 4, p: 0.1 }, { source: "B(A)", SS: 4, df: 2, MS: 2, F: null, p: null }],
    a_levels: 2, b_per_a: [2, 2], n_per_cell: [[1, 1], [1, 1]], n_total: 4, grand_mean: 5, alpha: 0.05,
    a_tested_against: "B(A)", b_within_a_estimable: true, error_estimable: true, balanced: true,
  },
  summary: {
    cells: [{ a_index: 0, b_index: 0, n: 1, mean: 2, sd: null }], a_groups: [{ a_index: 0, n: 2, mean: 3 }],
    grand_mean: 5, grand_n: 4, a_levels: 2, balanced: true,
  },
  varComp: null, varCompNote: "not estimable",
};
const outRecipe: OutlierScreeningRecipe = { col: 0, method: "mad", alpha: 0.05, k: 2, threshold: 3.5 };
const outSnapshot: OutlierScreeningSnapshot = {
  channelLabel: "a",
  result: { method: "mad", data: {
    modified_z_scores: [0, 0.67, 65.4, null], median: 2, mad: 1, scale_method: "MAD",
    threshold: 3.5, flagged_indices: [2], N: 3, excluded_indices: [3], method: "modified z-score",
  } },
  flaggedRows: [{ rowIndex: 2, value: 99, score: 65.4 }], omittedRows: [3], rosnerSteps: [],
};
const mvRecipe: MultivariateRecipe = { columns: [0, 2], method: "pearson", standardize: true, pcX: 0, pcY: 1 };
const mvSnapshot: MultivariateSnapshot = {
  labels: ["a", "c"], sourceRows: [1, 2, 3, 4], inputRows: 4,
  correlation: { r: [[1, 0.9], [0.9, 1]], p: [[0, 0.01], [0.01, 0]], N: 4, method: "pearson" },
  pca: {
    coeff: [[0.7, 0.7], [0.7, -0.7]], score: [[1, 0], [0, 1], [-1, 0], [0, -1]],
    latent: [1.9, 0.1], explained: [95, 5], cumulative: [95, 100], mu: [2.5, 6.75], sigma: [1, 1], singular: [2, 1],
  },
};

interface Case {
  name: string;
  producerId: string;
  publish: (source: Dataset, variant: boolean) => string | null;
}
const CASES: Case[] = [
  { name: "Distribution", producerId: "distribution-analysis",
    publish: (s, v) => publishDistributionResult(s, v ? { ...distRecipe, percentileInput: 75 } : distRecipe, distSnapshot) },
  { name: "Fit Y by X", producerId: "fit-y-by-x",
    publish: (s, v) => publishFitYByXResult(s, v ? { ...fitRecipe, order: 2 } : fitRecipe, fitSnapshot) },
  { name: "Variability", producerId: "variability-analysis",
    publish: (s, v) => publishVariabilityResult(s, v ? { responseCol: 0, factorACol: 1, factorBCol: 2 } : varRecipe, varSnapshot) },
  { name: "Outlier screening", producerId: "outlier-screening",
    publish: (s, v) => publishOutlierScreeningResult(s, v ? { ...outRecipe, threshold: 5 } : outRecipe, outSnapshot) },
  { name: "Multivariate", producerId: "multivariate-analysis",
    publish: (s, v) => publishMultivariateResult(s, v ? { ...mvRecipe, standardize: false } : mvRecipe, mvSnapshot) },
];

const live = () => useApp.getState().datasets.find((d) => d.id === "src")!;
const results = () => useApp.getState().analysisResults;
const shifted = (): Dataset => ({
  ...SOURCE, data: { ...SOURCE.data, values: SOURCE.data.values.map((row) => [row[0]! + 1, row[1]!, row[2]! + 1]) },
});

beforeEach(() => {
  useApp.setState({
    datasets: [SOURCE], activeId: "src", analysisResults: [], history: [], future: [],
    staleDatasets: [], staleFits: [], recalcMode: "auto",
  });
});

describe.each(CASES)("saving a $name result", ({ producerId, publish }) => {
  it("creates one result as ONE undo step; Undo removes it and Redo restores it", () => {
    const id = publish(live(), false);
    expect(id).toBeTruthy();
    expect(results().map((r) => r.producer.id)).toEqual([producerId]);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(results()).toHaveLength(0);
    useApp.getState().redo();
    expect(results().map((r) => r.id)).toEqual([id]);
  });

  it("a repeat Save of the same computation creates nothing", () => {
    expect(publish(live(), false)).toBeTruthy();
    expect(publish(live(), false)).toBeNull();
    expect(results()).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(1);
    expect(useApp.getState().status).toMatch(/already saved/);
  });

  it("a different question saves normally", () => {
    expect(publish(live(), false)).toBeTruthy();
    expect(publish(live(), true)).toBeTruthy();
    expect(results()).toHaveLength(2);
  });

  it("Save works again after Undo", () => {
    publish(live(), false);
    useApp.getState().undo();
    expect(publish(live(), false)).toBeTruthy();
    expect(results()).toHaveLength(1);
  });

  it("Save works again after the saved result is deleted", () => {
    publish(live(), false);
    useApp.setState({ analysisResults: [] });
    expect(publish(live(), false)).toBeTruthy();
    expect(results()).toHaveLength(1);
  });

  it("Save works again once the source data changed (the old result is out of date)", () => {
    publish(live(), false);
    useApp.setState({ datasets: [shifted()] });
    expect(analysisDataFingerprint(live())).not.toBe(results()[0]!.sourceFingerprint);
    expect(publish(live(), false)).toBeTruthy();
    expect(results()).toHaveLength(2);
  });

  it("refuses (writes nothing) when the source changed after the analysis ran", () => {
    const computedOn = live();
    useApp.setState({ datasets: [shifted()] });
    expect(publish(computedOn, false)).toBeNull();
    expect(results()).toHaveLength(0);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it.each(["auto", "manual", "off"] as const)(
    "freshness follows the data fingerprint in recalc mode %s (a snapshot is never 'Current' for changed data)",
    (recalcMode) => {
      useApp.setState({ recalcMode });
      publish(live(), false);
      expect(snapshotResultState(results()[0]!, [live()])).toBe("current");
      expect(snapshotResultState(results()[0]!, [shifted()])).toBe("out-of-date");
    },
  );
});

describe("a saved result reopened from an older file", () => {
  it("still blocks a duplicate (matched by recipe, not by a stored key)", () => {
    const old = distributionAnalysisResult("old", live(), distRecipe, distSnapshot);
    useApp.setState({ analysisResults: [old] });
    expect(publishDistributionResult(live(), distRecipe, distSnapshot)).toBeNull();
    expect(results()).toHaveLength(1);
  });

  it("a result already marked stale does not block a new save", () => {
    useApp.setState({ analysisResults: [{ ...distributionAnalysisResult("old", live(), distRecipe, distSnapshot), stale: true }] });
    expect(publishDistributionResult(live(), distRecipe, distSnapshot)).toBeTruthy();
  });
});
