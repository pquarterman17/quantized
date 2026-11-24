// Fit Model (GAP_AUDIT_9 G1) as a saved snapshot result: the recipe a result
// reruns from, the tables it saves (the in-tool book copies the same ones),
// and the AnalysisResult envelope (source, analysis-view fingerprint for
// staleness, recorded inputs, warnings). The fitted model itself (spec,
// coefficients, covariance) is kept in `parameters.model`, so a later
// prediction profiler (G7) can evaluate a SAVED result without refitting.

import type { FitModelResponse } from "./api/statsModel";
import { ANALYSIS_RESULT_VERSION, type AnalysisResult, type AnalysisResultTable, type AnalysisResultValue } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import { FIT_MODEL_PRODUCER, type FitModelRecipe } from "./fitModelRecipe";
import { fmtNum } from "./format";
import { INPUTS_PARAM, recordedInputs } from "./resultInputsRecord";
import type { Dataset } from "./types";
import { boundedTables } from "./variabilityAnalysisResult";

export { FIT_MODEL_PRODUCER, fitModelRecipe } from "./fitModelRecipe";
export const FIT_MODEL_METHOD = "Fit Model: standard least squares";

export interface FitModelSnapshot {
  responseLabel: string;
  /** Human labels of the model terms, in model order. */
  termLabels: string[];
  /** Original dataset row behind each fitted request row (analysis view -> worksheet). */
  rowIds: number[];
  fit: FitModelResponse;
}

const finite = (v: number | null | undefined): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;

/** Table titles, fixed: the book, the saved result and Copy all key on them. */
export const FIT_MODEL_TABLES = {
  summary: "Summary of fit",
  anova: "Analysis of variance",
  effects: "Effect tests",
  estimates: "Parameter estimates",
  residuals: "Predicted and residuals",
} as const;

export const lsMeansTitle = (effect: string): string => `Least squares means: ${effect}`;

/** The tables a Fit Model result saves, in saved order. */
export function fitModelResultTables(snapshot: FitModelSnapshot): AnalysisResultTable[] {
  const { fit } = snapshot;
  const s = fit.summary;
  const level = `${fmtNum((1 - fit.alpha) * 100)}%`;
  const tables: AnalysisResultTable[] = [
    { title: FIT_MODEL_TABLES.summary, columns: ["statistic", "value"], rows: [
      ["RSquare", finite(s.r2)], ["RSquare Adj", finite(s.adj_r2)], ["Root Mean Square Error", finite(s.rmse)],
      ["Mean of Response", finite(s.mean_response)], ["Observations", s.n],
    ] },
    { title: FIT_MODEL_TABLES.anova, columns: ["source", "DF", "Sum of Squares", "Mean Square", "F Ratio", "Prob > F"],
      rows: fit.anova.map((r) => [r.source, r.df, finite(r.ss), finite(r.ms), finite(r.f), finite(r.p)]) },
    { title: FIT_MODEL_TABLES.effects, columns: ["source", "Nparm", "DF", "Sum of Squares", "F Ratio", "Prob > F"],
      rows: fit.effect_tests.map((r, i) => [snapshot.termLabels[i] ?? r.effect, r.nparm, r.df, finite(r.ss), finite(r.f), finite(r.p)]) },
    { title: FIT_MODEL_TABLES.estimates, columns: ["term", "Estimate", "Std Error", "t Ratio", "Prob > |t|", `Lower ${level}`, `Upper ${level}`],
      rows: fit.parameter_estimates.map((r) => [r.term, finite(r.estimate), finite(r.se), finite(r.t), finite(r.p), finite(r.lower), finite(r.upper)]) },
  ];
  for (const ls of fit.ls_means) {
    tables.push({ title: lsMeansTitle(ls.effect), columns: [...ls.factors, "Least Sq Mean", "Std Error", "Mean", "N"],
      rows: ls.rows.map((r) => [...r.levels, finite(r.ls_mean), finite(r.se), finite(r.mean), r.n]) });
  }
  const rows: (string | number | null)[][] = [];
  fit.predicted.forEach((p, i) => {
    if (p === null) return;
    const actual = p + (fit.residual[i] ?? Number.NaN);
    rows.push([(snapshot.rowIds[i] ?? i) + 1, finite(actual), finite(p), finite(fit.residual[i])]);
  });
  tables.push({ title: FIT_MODEL_TABLES.residuals, columns: ["row", snapshot.responseLabel, "Predicted", "Residual"], rows });
  return tables;
}

export function fitModelAnalysisResult(
  id: string,
  source: Dataset,
  recipe: FitModelRecipe,
  snapshot: FitModelSnapshot,
  createdAt = new Date().toISOString(),
): AnalysisResult {
  const { fit } = snapshot;
  const bounded = boundedTables(fitModelResultTables(snapshot));
  const whole = fit.anova[0];
  const cols = [recipe.responseCol, ...new Set(recipe.terms.flat())];
  const warnings = [
    ...(fit.n_dropped_missing > 0 ? [`${fit.n_dropped_missing} row(s) with a missing response or factor value were left out of the fit.`] : []),
    ...bounded.warnings,
  ];
  return {
    version: ANALYSIS_RESULT_VERSION,
    id,
    name: `${snapshot.responseLabel} fit model · ${source.name}`,
    producer: { id: FIT_MODEL_PRODUCER, label: "Fit Model", version: 1 },
    sources: [{ datasetId: source.id, role: "input" }], outputs: [],
    selection: {
      datasetId: source.id,
      channels: cols.filter((c) => c >= 0).map((c) => ({ index: c, label: source.data.labels[c] ?? `col ${c}`, unit: source.data.units[c] ?? "" })),
    },
    sourceFingerprint: analysisDataFingerprint(source),
    scalarValues: {
      Test: "Standard least squares",
      Interpretation: `R² ${fmtNum(fit.summary.r2)}, RMSE ${fmtNum(fit.summary.rmse)}; whole model F ${fmtNum(whole?.f)} (p ${fmtNum(whole?.p)}).`,
      Response: snapshot.responseLabel, Effects: snapshot.termLabels.join(", "),
      N: fit.n, RSquare: finite(fit.summary.r2), "RSquare Adj": finite(fit.summary.adj_r2), RMSE: finite(fit.summary.rmse),
      "Center polynomials": recipe.center ? "yes" : "no", Alpha: fit.alpha,
    },
    parameters: {
      recipe: {
        responseCol: recipe.responseCol, terms: recipe.terms, kinds: recipe.kinds, center: recipe.center,
        ...(recipe.textDigest ? { textDigest: recipe.textDigest } : {}),
      },
      model: fit.model as unknown as AnalysisResultValue,
      [INPUTS_PARAM]: recordedInputs([source], { xKey: undefined }),
    },
    tables: bounded.tables, warnings, createdAt,
  };
}
