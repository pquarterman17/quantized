import { runSpectralWorkbench } from "../lib/api/spectralWorkbench";
import { recomputeFromBaseOrEmpty } from "../lib/formulaInputs";
import { lit } from "../lib/macro";
import { recalcNodes, wouldCreateCycle } from "../lib/recalc";
import {
  rebindSpectralRecipe,
  type SpectralAnalysisRecipe,
} from "../lib/spectralWorkbench";
import type { Dataset } from "../lib/types";
import { nextDatasetId } from "./idSeq";
import type { AppState } from "./useApp";

type SliceGet = () => AppState;

/** Lazy implementation for linked spectral outputs; keeps the analysis
 * client and recipe machinery out of the startup bundle. */
export async function recomputeSpectralWorksheet(
  source: Dataset,
  sheet: Dataset,
  recipeInput: SpectralAnalysisRecipe,
): Promise<{ sheet: Dataset; shift: null }> {
  const recipe = rebindSpectralRecipe(recipeInput, source.data.labels);
  const analyzed = await runSpectralWorkbench(source.data, recipe);
  const { data, formulaErrors } = recomputeFromBaseOrEmpty(analyzed, sheet.formulas);
  return {
    sheet: {
      ...sheet,
      data,
      raw: source.data,
      analysisRecipe: recipe,
      formulaErrors,
      errorRoles: undefined,
    },
    shift: null,
  };
}

export async function createSpectralWorksheet(
  get: SliceGet,
  sourceId: string,
  recipe: SpectralAnalysisRecipe,
  pipelineLabel: string,
): Promise<string | null> {
  const source = get().datasets.find((dataset) => dataset.id === sourceId);
  if (!source || source.pending) {
    get().setStatus(!source
      ? "Can't create a spectral worksheet: source dataset not found."
      : "Can't create a spectral worksheet: source data hasn't fully loaded yet.");
    return null;
  }
  const newId = nextDatasetId();
  const reason = wouldCreateCycle(get().datasets, {
    from: recalcNodes.dataset(sourceId),
    to: recalcNodes.dataset(newId),
  });
  if (reason) {
    get().setStatus(`Can't create a spectral worksheet: ${reason}`);
    return null;
  }
  try {
    const rebound = rebindSpectralRecipe(recipe, source.data.labels);
    const data = await runSpectralWorkbench(source.data, rebound);
    const created: Dataset = {
      id: newId,
      name: `${source.name} (${rebound.operation})`,
      data,
      raw: source.data,
      analysisRecipe: rebound,
      derivedFrom: { datasetId: sourceId, pipeline: pipelineLabel },
      ...(source.workbookId ? { workbookId: source.workbookId } : {}),
      ...(source.folderId ? { folderId: source.folderId } : {}),
    };
    get().addDataset(created);
    get().recordMacro(
      `Create ${pipelineLabel} worksheet from ${source.name}`,
      `qz.createSpectralWorksheet(${lit(source.name)}, ${lit(rebound)})`,
      { kind: "expression", params: { sourceId, recipe: rebound } },
    );
    return created.id;
  } catch (error) {
    get().setStatus(`create spectral worksheet failed: ${error instanceof Error ? error.message : "error"}`);
    return null;
  }
}
