// PLS / LDA / spectra PCA tab: a result as drawn figures and as the worksheets
// it commits (result-lifecycle contract). Pure.

import type { PlotPayload } from "../../../../lib/plotdata";
import type { DataStruct, RefLine } from "../../../../lib/types";
import type { ExtMeta, ExtResult } from "./multivarExtRun";

export interface ExtFigure { key: string; title: string; payload: PlotPayload; refLines?: RefLine[] }
export interface ExtOutput { key: string; button: string; name: string; data: DataStruct }

type Spec = PlotPayload["series"][number];
type Col = (number | null)[];
const pts = (label: string): Spec => ({ label, unit: "", kind: "points" });
const line = (label: string, overlay = true): Spec => ({ label, unit: "", kind: "line", overlay });
const nul = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const nan = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN);
const col = (rows: readonly (readonly number[])[], j: number): number[] => rows.map((r) => r[j]);

/** Rows ordered by x (uPlot reads x ascending). */
function figure(key: string, title: string, xLabel: string, xs: number[], cols: [Spec, Col][], refLines?: RefLine[]): ExtFigure {
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const data = [order.map((i) => xs[i]), ...cols.map(([, c]) => order.map((i) => c[i]))];
  return { key, title, ...(refLines ? { refLines } : {}), payload: { data: data as PlotPayload["data"], series: cols.map(([s]) => s), xLabel, xUnit: "" } };
}

function struct(time: number[], cols: [string, number[]][], xName: string, meta: Record<string, unknown>): DataStruct {
  return {
    time, values: time.map((_, i) => cols.map(([, c]) => c[i])), labels: cols.map(([n]) => n), units: cols.map(() => ""),
    metadata: { x_column_name: xName, technique: "multivariate", ...meta },
  };
}

const names = (prefix: string, k: number): string[] => Array.from({ length: k }, (_, i) => `${prefix}${i + 1}`);

export function extFigures(r: ExtResult, meta: ExtMeta): ExtFigure[] {
  if (r.tool === "pls") {
    const d = r.data;
    const a = d.cv.press.length;
    const comps = Array.from({ length: a }, (_, i) => i + 1);
    const yName = meta.yLabels[0] ?? "Y";
    const coefX = meta.varX;
    return [
      figure("cv", "RMSECV by number of components", "components", comps,
        d.cv.rmsecv[0].map((_, k) => [line(`RMSECV ${meta.yLabels[k] ?? `Y${k + 1}`}`, k > 0), col(d.cv.rmsecv, k)] as [Spec, Col])),
      figure("pvm", `Predicted vs measured, ${yName}`, `measured ${yName}`, col(d.measured, 0), [
        [pts("fitted"), col(d.predicted, 0)], [pts("cross-validated"), col(d.cv_predicted, 0)],
        [line("1:1"), col(d.measured, 0).map((v) => v)],
      ]),
      figure("coef", `Regression coefficients, ${yName}`, meta.obsLabels.length ? "x" : "variable", coefX,
        [[line("coefficient", false), col(d.coef, 0)]], [{ id: "zero", axis: "y", value: 0 }]),
    ];
  }
  if (r.tool === "lda") {
    const d = r.data;
    const two = d.n_discriminants >= 2;
    const xs = two ? col(d.scores, 0) : meta.sourceRows;
    return [figure("lda", two ? "Discriminant scores (LD1 vs LD2)" : "Discriminant score LD1 by row", two ? "LD1" : "worksheet row", xs,
      d.classes.map((c, k) => [pts(c), d.actual.map((a, i) => (a === k ? nul(d.scores[i][two ? 1 : 0]) : null))] as [Spec, Col]))];
  }
  const d = r.data;
  const k = d.score[0]?.length ?? 0;
  return [
    ...(k >= 2 ? [figure("scores", `Spectra scores (PC1 ${d.explained[0].toFixed(1)}%, PC2 ${d.explained[1].toFixed(1)}%)`, "PC1", col(d.score, 0), [[pts("spectra"), col(d.score, 1)]])] : []),
    figure("loadings", "Loadings over the grid", "x", d.grid, Array.from({ length: Math.min(k, 3) }, (_, j) => [line(`PC${j + 1}`, j > 0), col(d.coeff, j)] as [Spec, Col]),
      [{ id: "zero", axis: "y", value: 0 }]),
  ];
}

export function extOutputs(r: ExtResult, meta: ExtMeta): ExtOutput[] {
  if (r.tool === "pls") {
    const d = r.data;
    const m = d.m;
    const ys = meta.yLabels;
    const obs: [string, number[]][] = [];
    for (let k = 0; k < m; k++) {
      obs.push([`${ys[k]} measured`, col(d.measured, k)], [`${ys[k]} fitted`, col(d.predicted, k)],
        [`${ys[k]} CV`, col(d.cv_predicted, k)], [`${ys[k]} residual`, col(d.residuals, k)]);
    }
    names("T", d.n_components).forEach((n, j) => obs.push([n, col(d.scores, j)]));
    const info = { tool: "pls", components: d.n_components, auto: d.auto_components, preprocess: d.preprocess, cvFolds: d.cv.folds, seed: d.cv.seed,
      r2y: d.r2y, q2: d.q2, rmsec: d.rmsec, rmsecv: d.rmsecv, intercept: d.intercept, dropped: meta.dropped };
    const varCols: [string, number[]][] = ys.map((y, k) => [`coef ${y}`, col(d.coef, k)] as [string, number[]]);
    varCols.push(["VIP", d.vip.map(nan)]);
    names("W", d.n_components).forEach((n, j) => varCols.push([n, col(d.x_weights, j)]));
    names("P", d.n_components).forEach((n, j) => varCols.push([n, col(d.x_loadings, j)]));
    const a = d.cv.press.length;
    const cvCols: [string, number[]][] = [];
    ys.forEach((y, k) => cvCols.push([`PRESS ${y}`, col(d.cv.press, k)], [`RMSECV ${y}`, col(d.cv.rmsecv, k)], [`Q2 ${y}`, col(d.cv.q2, k)]));
    cvCols.push(["Q2 mean", d.cv.q2_mean]);
    return [
      { key: "obs", button: "scores and predictions", name: `PLS scores and predictions (${d.n_components} comp.)`, data: struct(meta.sourceRows, obs, "worksheet row", { pls: info }) },
      { key: "coef", button: "coefficients and VIP", name: `PLS coefficients and VIP (${d.n_components} comp.)`,
        data: struct(meta.varX, varCols, meta.obsLabels.length ? "x" : "variable", { pls: { ...info, variables: meta.varLabels } }) },
      { key: "cv", button: "cross-validation", name: "PLS cross-validation by component",
        data: struct(Array.from({ length: a }, (_, i) => i + 1), cvCols, "components", { pls: { ...info, best: d.cv.best } }) },
    ];
  }
  if (r.tool === "lda") {
    const d = r.data;
    const cols: [string, number[]][] = [["class", d.actual], ["predicted", d.predicted]];
    if (d.cv) cols.push(["CV predicted", d.cv.predicted]);
    names("LD", d.n_discriminants).forEach((n, j) => cols.push([n, col(d.scores, j)]));
    d.classes.forEach((c, k) => cols.push([`P(${c})`, col(d.posterior, k)]));
    return [{ key: "scores", button: "scores and classes", name: `LDA scores (${meta.classLabel})`, data: struct(meta.sourceRows, cols, "worksheet row", {
      lda: { classes: d.classes, priors: d.priors, priorsMode: d.priors_mode, accuracy: d.accuracy, cvAccuracy: d.cv?.accuracy ?? null,
        explained: d.explained_variance_ratio, confusion: d.confusion, classLabel: meta.classLabel, variables: meta.varLabels },
    }) }];
  }
  const d = r.data;
  const k = d.score[0]?.length ?? 0;
  const info = { spectraPca: { spectra: meta.obsLabels, explained: d.explained, resampleNotes: d.notes } };
  return [
    { key: "scores", button: "scores", name: "Spectra PCA scores", data: struct(d.score.map((_, i) => i + 1),
      names("PC", k).map((n, j) => [n, col(d.score, j)] as [string, number[]]), "spectrum (column order)", info) },
    { key: "loadings", button: "loadings", name: "Spectra PCA loadings", data: struct(d.grid,
      names("PC", k).map((n, j) => [n, col(d.coeff, j)] as [string, number[]]), "x", info) },
  ];
}
