// The "Review inputs" rows of the Multivariate workshop, per open tab: each tab
// reads the same column picks but a different set of settings, so the block
// describes the tool that is open and no other (it used to say "Correlation" and
// "PCA standardize" on the PLS / LDA tab). Pure; the tabs with their own state
// (PLS / LDA / spectra, clustering) render their own block from these.

import { analysisColumnName, type AnalysisInputs } from "../../../lib/analysisInputs";
import type { ReviewRow } from "../analysisselection/statsInputReviewRows";
import type { ClusterOptions, ClusterTool } from "./cluster/clusterRun";
import type { ExtOptions, ExtTool } from "./ext/multivarExtRun";

const on = (v: boolean): string => (v ? "on" : "off");

function named(inputs: AnalysisInputs, keys: readonly number[]): string {
  if (keys.length === 0) return "not picked";
  const ds = inputs.dataset;
  return keys.map((k) => (!ds ? `column ${k + 1}` : k < 0 || k >= ds.data.labels.length ? "missing" : analysisColumnName(ds, k))).join(", ");
}

/** The correlation, SPLOM and PCA tabs (the tabs whose settings live in the panel's own hook). */
export function multivarTabRows(
  tab: "correlation" | "splom" | "pca", inputs: AnalysisInputs, s: { selected: readonly number[]; method: string; standardize: boolean },
): ReviewRow[] {
  const columns = { label: "Columns", value: named(inputs, s.selected) };
  if (tab === "correlation") return [columns, { label: "Correlation", value: s.method }];
  if (tab === "pca") return [columns, { label: "PCA standardize", value: on(s.standardize) }];
  return [columns];
}

/** PLS, LDA and spectra PCA: what the next Run reads (`ExtOptions`, as `prepareExt` validates it). */
export function extRows(inputs: AnalysisInputs, selected: readonly number[], tool: ExtTool, o: ExtOptions): ReviewRow[] {
  if (tool === "pls") {
    const p = o.pls;
    const cols = p.orientation === "cols";
    return [
      { label: "Layout", value: cols ? "columns are variables" : "columns are spectra" },
      cols
        ? { label: "Predictors (X)", value: named(inputs, selected.filter((c) => !p.y.includes(c))) }
        : { label: "Spectra", value: named(inputs, selected) },
      cols ? { label: "Response (Y)", value: named(inputs, p.y) } : { label: "Response per spectrum", value: p.yText.trim() === "" ? "not entered" : p.yText.trim() },
      { label: "Preprocessing", value: p.preprocess },
      { label: "Components", value: p.fixed > 0 ? String(p.fixed) : `chosen by cross-validation (up to ${p.maxComp})` },
      { label: "CV folds", value: String(p.folds) },
      { label: "Seed", value: String(p.seed) },
    ];
  }
  if (tool === "lda") {
    const l = o.lda;
    return [
      { label: "Variables", value: named(inputs, selected.filter((c) => c !== l.classCol)) },
      { label: "Class column", value: l.classCol < -1 ? "not picked" : named(inputs, [l.classCol]) },
      { label: "Priors", value: l.priors === "equal" ? "equal" : "class frequencies" },
      { label: "CV folds", value: l.cvFolds > 0 ? String(l.cvFolds) : "none" },
      { label: "Seed", value: String(l.seed) },
    ];
  }
  return [
    { label: "Spectra", value: named(inputs, selected) },
    { label: "Centre", value: on(o.spectra.center) },
    { label: "Scale", value: on(o.spectra.scale) },
  ];
}

/** k-means and hierarchical clustering. */
export function clusterRows(inputs: AnalysisInputs, selected: readonly number[], tool: ClusterTool, o: ClusterOptions): ReviewRow[] {
  const columns = { label: "Columns", value: named(inputs, selected) };
  if (tool === "kmeans") {
    const k = o.kmeans;
    return [
      columns, { label: "Clusters (k)", value: String(k.k) }, { label: "Standardize", value: k.standardize },
      { label: "Start", value: k.init }, { label: "Restarts", value: String(k.nInit) }, { label: "Seed", value: String(k.seed) },
    ];
  }
  const h = o.hierarchical;
  return [
    columns, { label: "Linkage", value: h.method }, { label: "Distance", value: h.metric }, { label: "Standardize", value: h.standardize },
    h.cutBy === "k" ? { label: "Cut into", value: `${h.k} clusters` } : { label: "Cut at distance", value: String(h.distance) },
  ];
}
