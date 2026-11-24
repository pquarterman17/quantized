// The duplicate-save key for snapshot results (lane RL3). Distribution, Fit Y
// by X, Variability, Outlier screening and Multivariate each save a result
// that owns its tables (no output worksheet). "The same computation" is, as for
// committed outputs, BY VALUE: producer + source id + the source's analysis-view
// fingerprint + the question the tool answered. This reuses
// `committedOutputKey` (lib/committedOutput.ts) so there is one key shape.
//
// The key is derived from the recipe a result already stores in
// `parameters.recipe`, never from a stored key field, so results from files
// saved before this module existed are recognised too. View-only choices (the
// multivariate score axes, a Rosner `k` under MAD) are not part of the question.
//
// Statistical tests are deliberately absent: each Run is a new run.

import type { AnalysisResult } from "./analysisResult";
import { committedOutputKey, type CommitSettings } from "./committedOutput";
import { distributionRecipe, type DistributionRecipe } from "./distributionAnalysisResult";
import { fitModelRecipe, termKey, type FitModelRecipe } from "./fitModelRecipe";
import { fitYByXRecipe, type FitYByXMode, type FitYByXRecipe } from "./fitYByXAnalysisResult";
import { multivariateRecipe, type MultivariateRecipe } from "./multivariateAnalysisResult";
import { outlierScreeningRecipe, type OutlierScreeningRecipe } from "./outlierScreeningAnalysisResult";
import { variabilityRecipe, type VariabilityRecipe } from "./variabilityAnalysisResult";

export const distributionQuestion = (r: DistributionRecipe): CommitSettings => ({
  col: r.col, byCol: r.byCol, fitDist: r.fitDist, compareOpen: r.compareOpen, percentileInput: r.percentileInput,
});
export const fitYByXQuestion = (r: FitYByXRecipe, mode: FitYByXMode): CommitSettings => ({
  xCol: r.xCol, yCol: r.yCol, byCol: r.byCol, order: r.order, bandInterval: r.bandInterval, mode,
});
export const variabilityQuestion = (r: VariabilityRecipe): CommitSettings => ({
  responseCol: r.responseCol, factorACol: r.factorACol, factorBCol: r.factorBCol,
});
/** Terms compare order-free and in model order; kinds only for used columns. */
export const fitModelQuestion = (r: FitModelRecipe): CommitSettings => ({
  responseCol: r.responseCol, terms: r.terms.map(termKey), center: r.center,
  kinds: Object.keys(r.kinds).sort().map((k) => `${k}:${r.kinds[k]}`),
  ...(r.textDigest ? { textDigest: r.textDigest } : {}),
});
export const outlierQuestion = (r: OutlierScreeningRecipe): CommitSettings => (
  r.method === "mad" ? { col: r.col, method: r.method, threshold: r.threshold }
    : r.method === "rosner" ? { col: r.col, method: r.method, alpha: r.alpha, k: r.k }
      : { col: r.col, method: r.method, alpha: r.alpha });
export const multivariateQuestion = (r: MultivariateRecipe): CommitSettings => ({
  method: r.method, standardize: r.standardize, columns: r.columns,
});

export function snapshotResultKey(
  producerId: string, sourceId: string, sourceFingerprint: string, question: CommitSettings,
): string {
  return committedOutputKey(producerId, sourceId, sourceFingerprint, question);
}

function savedQuestion(result: AnalysisResult): CommitSettings | null {
  switch (result.producer.id) {
    case "distribution-analysis": {
      const recipe = distributionRecipe(result);
      return recipe && distributionQuestion(recipe);
    }
    case "fit-y-by-x": {
      const recipe = fitYByXRecipe(result);
      const mode = result.parameters?.["mode"];
      return recipe && (mode === "oneway" || mode === "bivariate" || mode === "contingency")
        ? fitYByXQuestion(recipe, mode) : null;
    }
    case "variability-analysis": {
      const recipe = variabilityRecipe(result);
      return recipe && variabilityQuestion(recipe);
    }
    case "fit-model": {
      const recipe = fitModelRecipe(result);
      return recipe && fitModelQuestion(recipe);
    }
    case "outlier-screening": {
      const recipe = outlierScreeningRecipe(result);
      return recipe && outlierQuestion(recipe);
    }
    case "multivariate-analysis": {
      const recipe = multivariateRecipe(result);
      return recipe && multivariateQuestion(recipe);
    }
    default: return null;
  }
}

/** The key a SAVED result occupies, or null when it cannot block a new save: a
 *  result already marked stale, one without a source or fingerprint, or one
 *  whose stored recipe does not parse. */
export function savedSnapshotKey(result: AnalysisResult): string | null {
  const sourceId = result.sources[0]?.datasetId;
  if (result.stale || !sourceId || !result.sourceFingerprint) return null;
  const question = savedQuestion(result);
  return question ? snapshotResultKey(result.producer.id, sourceId, result.sourceFingerprint, question) : null;
}
