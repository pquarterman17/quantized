import type { SpectralAnalysisRecipe } from "../lib/spectralWorkbench";
import { createSpectralWorksheet } from "./spectralWorksheetsRun";
import { useApp } from "./useApp";

/** Imperative bridge used by the lazy Signal Processing panel. Keeping the
 * store read here avoids a render-body snapshot and keeps the store slice
 * free of analysis-specific actions. */
export function createSpectralWorksheetFromApp(
  sourceId: string,
  recipe: SpectralAnalysisRecipe,
  pipelineLabel: string,
): Promise<string | null> {
  return createSpectralWorksheet(useApp.getState, sourceId, recipe, pipelineLabel);
}
