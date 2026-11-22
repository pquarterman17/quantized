// Saved statistics results for the result-book tests (lane RB).

import type { AnalysisResult } from "../../../lib/analysisResult";
import { distributionAnalysisResult } from "../../../lib/distributionAnalysisResult";
import { fitYByXAnalysisResult } from "../../../lib/fitYByXAnalysisResult";
import { multivariateAnalysisResult } from "../../../lib/multivariateAnalysisResult";
import { outlierScreeningAnalysisResult } from "../../../lib/outlierScreeningAnalysisResult";
import type { Dataset } from "../../../lib/types";
import { variabilityAnalysisResult } from "../../../lib/variabilityAnalysisResult";

export const source: Dataset = {
  id: "source", name: "Raw trace",
  data: { time: [0, 1, 2], values: [[1], [2], [4]], labels: ["Signal"], units: ["V"], metadata: { xLabel: "Time" } },
};

export const distribution = (): AnalysisResult => distributionAnalysisResult(
  "distribution", source,
  { col: 0, byCol: null, fitDist: "none", compareOpen: false, percentileInput: 90 },
  { label: "Signal", byLabel: null, hist: { counts: [2, 1], centers: [1.5, 3.5], edges: [1, 2.5, 4] },
    desc: { N: 3, mean: 2.33, median: 2, std: 1.5, min: 1, q1: 1.5, q3: 3, max: 4 },
    norm: null, normNote: "need more values", levels: [], totalLevels: 0, rankedFits: [],
    rankingMetric: "ks_p", quantiles: null, percentileValue: null, skipped: [] },
);
export const fitYByX = (): AnalysisResult => fitYByXAnalysisResult(
  "fit-y-by-x", source,
  { xCol: -1, yCol: 0, byCol: null, order: 1, bandInterval: "confidence" },
  { mode: "bivariate", xLabel: "Time", yLabel: "Signal", byLabel: null, levels: [], totalLevels: 0,
    bivariate: { x: [0, 1, 2], y: [1, 2, 4], order: 1,
      regression: { N: 3, coeffs: [0.83, 1.5], R2: 0.96, fPvalue: 0.1 }, band: null } },
);
export const multivariate = (): AnalysisResult => multivariateAnalysisResult(
  "multivariate", source,
  { columns: [-1, 0], method: "pearson", standardize: true, pcX: 0, pcY: 1 },
  {
    labels: ["Time", "Signal"], sourceRows: [0, 1, 2], inputRows: 3,
    correlation: { r: [[1, 0.98], [0.98, 1]], p: [[0, 0.1], [0.1, 0]], N: 3, method: "pearson" },
    pca: { coeff: [[0.7, 0.7], [0.7, -0.7]], score: [[-1, 0], [0, 0], [1, 0]],
      latent: [2, 0], explained: [99, 1], cumulative: [99, 100], mu: [1, 2.33],
      sigma: [1, 1.5], singular: [1, 0] },
  },
);


/** A two-column source for the nested Variability chart (response + batch). */
export const variabilitySource: Dataset = {
  ...source,
  data: { ...source.data, values: [[1, 10], [2, 20], [4, 20]], labels: ["Signal", "Batch"], units: ["V", ""] },
};
export const variability = (): AnalysisResult => variabilityAnalysisResult(
  "variability", variabilitySource, { responseCol: 0, factorACol: -1, factorBCol: 1 }, {
    responseLabel: "Signal", factorALabel: "Time", factorBLabel: "Batch", levelLabels: [],
    anova: { table: [], a_levels: 2, b_per_a: [], n_per_cell: [], n_total: 3, grand_mean: 2.33,
      alpha: 0.05, a_tested_against: "Error", b_within_a_estimable: false,
      error_estimable: false, balanced: false },
    summary: { cells: [], a_groups: [], grand_mean: 2.33, grand_n: 3, a_levels: 2, balanced: false },
    varComp: null, varCompNote: "not estimable",
  },
);
export const outlier = (): AnalysisResult => outlierScreeningAnalysisResult(
  "outlier", source, { col: 0, method: "mad", alpha: 0.01, k: 4, threshold: 3.5 }, {
    channelLabel: "Signal", flaggedRows: [{ rowIndex: 2, value: 4, score: 4 }], omittedRows: [], rosnerSteps: [],
    result: { method: "mad", data: {
      modified_z_scores: [0, 0, 4], median: 2, mad: 0.5, scale_method: "MAD", threshold: 3.5,
      flagged_indices: [2], N: 3, excluded_indices: [], method: "modified z-score",
    } },
  },
);
