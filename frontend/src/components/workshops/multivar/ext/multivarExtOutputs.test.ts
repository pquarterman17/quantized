import { describe, expect, it } from "vitest";

import type { LdaResult, PlsResult, SpectraPcaResult } from "../../../../lib/api/multivarExt";
import { extFigures, extOutputs } from "./multivarExtOutputs";
import type { ExtMeta } from "./multivarExtRun";

const meta: ExtMeta = { sourceRows: [1, 2, 4], dropped: 1, varLabels: ["a", "b"], varX: [1, 2], yLabels: ["y"], obsLabels: [], classLabel: "k" };

const PLS: PlsResult = {
  n: 3, p: 2, m: 1, n_components: 1, auto_components: true, preprocess: "center", components_max: 2,
  cv: { folds: 3, seed: 0, max_components: 2, best: 1, press: [[1], [2]], rmsecv: [[0.5], [0.8]], q2: [[0.9], [0.7]], q2_mean: [0.9, 0.7] },
  scores: [[-1], [0], [1]], x_weights: [[0.6], [0.8]], x_loadings: [[0.5], [0.7]], y_loadings: [[1]],
  coef: [[2], [-1]], intercept: [0.5], vip: [1.2, null], r2y: [0.99], r2y_mean: 0.99, r2y_cumulative: [[0.99]], r2x: [0.8],
  q2: [0.9], q2_mean: 0.9, rmsec: [0.1], rmsecv: [0.5],
  measured: [[3], [1], [2]], predicted: [[2.9], [1.1], [2]], cv_predicted: [[2.5], [1.5], [2]], residuals: [[0.1], [-0.1], [0]],
};

describe("PLS outputs", () => {
  it("draws CV, predicted-vs-measured (sorted by x) and coefficients", () => {
    const f = extFigures({ tool: "pls", data: PLS }, meta);
    expect(f.map((x) => x.key)).toEqual(["cv", "pvm", "coef"]);
    expect(f[1].payload.data[0]).toEqual([1, 2, 3]);
    expect(f[1].payload.data[1]).toEqual([1.1, 2, 2.9]);
  });
  it("commits three worksheets whose columns line up with the rows they describe", () => {
    const o = extOutputs({ tool: "pls", data: PLS }, meta);
    expect(o.map((x) => x.key)).toEqual(["obs", "coef", "cv"]);
    const obs = o[0].data;
    expect(obs.time).toEqual([1, 2, 4]);
    expect(obs.labels).toEqual(["y measured", "y fitted", "y CV", "y residual", "T1"]);
    expect(obs.values[1]).toEqual([1, 1.1, 1.5, -0.1, 0]);
    const coef = o[1].data;
    expect(coef.labels).toEqual(["coef y", "VIP", "W1", "P1"]);
    expect(coef.values[1][0]).toBe(-1);
    expect(Number.isNaN(coef.values[1][1])).toBe(true);
    expect(o[2].data.time).toEqual([1, 2]);
    expect(o[2].data.metadata).toMatchObject({ pls: { best: 1, components: 1 } });
  });
});

describe("LDA outputs", () => {
  const LDA: LdaResult = {
    n: 3, p: 2, classes: ["0", "1"], n_discriminants: 1, priors: [0.5, 0.5], priors_mode: "equal", explained_variance_ratio: [1],
    scores: [[-1], [0.5], [1]], decision: [[1, 0], [0, 1], [0, 2]], posterior: [[0.7, 0.3], [0.4, 0.6], [0.1, 0.9]],
    actual: [0, 1, 1], predicted: [0, 1, 1], confusion: [[1, 0], [0, 2]], accuracy: 1, means: [[0, 0], [1, 1]], class_means_scores: [[-1], [0.7]],
    cv: { folds: 2, seed: 0, predicted: [0, 1, 0], confusion: [[1, 0], [1, 1]], accuracy: 2 / 3 },
  };
  it("one class series per class, null off its own rows; the worksheet carries CV and posteriors", () => {
    const f = extFigures({ tool: "lda", data: LDA }, meta);
    expect(f[0].payload.series.map((s) => s.label)).toEqual(["0", "1"]);
    expect(f[0].payload.data[1]).toEqual([-1, null, null]);
    expect(f[0].payload.data[2]).toEqual([null, 0.5, 1]);
    const d = extOutputs({ tool: "lda", data: LDA }, meta)[0].data;
    expect(d.labels).toEqual(["class", "predicted", "CV predicted", "LD1", "P(0)", "P(1)"]);
    expect(d.metadata).toMatchObject({ lda: { cvAccuracy: 2 / 3, classLabel: "k" } });
  });
});

describe("spectra PCA outputs", () => {
  const SP: SpectraPcaResult = {
    grid: [10, 20, 30], n_spectra: 2, notes: [], score: [[1, 0.1], [-1, -0.1]], coeff: [[0.5, 0.1], [0.5, 0.2], [0.7, 0.3]],
    explained: [97.5, 2.5], cumulative: [97.5, 100], latent: [2, 0.05],
  };
  it("scores per spectrum and loadings over the grid", () => {
    const m: ExtMeta = { ...meta, varX: SP.grid, obsLabels: ["s1", "s2"] };
    const o = extOutputs({ tool: "spectra", data: SP }, m);
    expect(o[0].data.time).toEqual([1, 2]);
    expect(o[0].data.metadata).toMatchObject({ spectraPca: { spectra: ["s1", "s2"] } });
    expect(o[1].data.time).toEqual([10, 20, 30]);
    expect(o[1].data.values[2]).toEqual([0.7, 0.3]);
    expect(extFigures({ tool: "spectra", data: SP }, m).map((x) => x.key)).toEqual(["scores", "loadings"]);
  });
});
