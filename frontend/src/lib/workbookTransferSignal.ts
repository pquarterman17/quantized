import type { SignalAnalysisRecipe } from "./signalRecipe";
import type { Dataset } from "./types";

/** Rewrite the only dataset reference nested inside a signal recipe. */
export function rewriteTransferredSignalRecipe(
  recipe: SignalAnalysisRecipe | undefined,
  rewrite: (datasetId: string) => string | undefined,
): SignalAnalysisRecipe | undefined {
  if (recipe?.kind !== "spectral" || !recipe.secondarySource) return recipe;
  const datasetId = rewrite(recipe.secondarySource.datasetId);
  return datasetId
    ? { ...recipe, secondarySource: { ...recipe.secondarySource, datasetId } }
    : undefined;
}

/** Rewrite all dataset-to-dataset links while copying one worksheet. */
export function rewriteTransferredDatasetRefs(
  next: Dataset,
  source: Dataset,
  rewrite: (datasetId: string | undefined, isBackground?: boolean) => string | undefined,
): void {
  const background = rewrite(source.bgRef?.datasetId, true);
  next.bgRef = source.bgRef && background ? { ...source.bgRef, datasetId: background } : undefined;
  const derived = rewrite(source.derivedFrom?.datasetId);
  next.derivedFrom = source.derivedFrom && derived ? { ...source.derivedFrom, datasetId: derived } : undefined;
  next.analysisRecipe = next.derivedFrom
    ? rewriteTransferredSignalRecipe(source.analysisRecipe, (id) => rewrite(id))
    : undefined;
  const lostPrimary = Boolean(source.derivedFrom && !next.derivedFrom);
  const lostRecipeInput = Boolean(source.analysisRecipe && next.derivedFrom && !next.analysisRecipe);
  if (lostPrimary || lostRecipeInput) {
    next.derivedFrom = undefined;
    next.analysisRecipe = undefined;
    next.raw = undefined;
    next.corrections = undefined;
  }
  next.versionOf = rewrite(source.versionOf);
  // sheet("Name", L) links (lib/sheetRefs.ts) follow the copy like every other
  // reference: a link to a worksheet that was copied too points at the COPY;
  // one to a worksheet outside the copy is cut (`id: null` — the formula
  // errors) and counted by `rewrite`, never left reading the original.
  if (source.formulas?.some((f) => f.sheets?.length)) {
    next.formulas = source.formulas.map((f) =>
      f.sheets?.length ? { ...f, sheets: f.sheets.map((b) => ({ ...b, id: b.id === null ? null : (rewrite(b.id) ?? null) })) } : f,
    );
  }
}
