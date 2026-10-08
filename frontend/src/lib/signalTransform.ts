import { applyCorrections } from "./api";
import { runSpectralWorkbench } from "./api/spectralWorkbench";
import { lit } from "./macro";
import {
  bindSignalRecipe,
  signalRecipeLabel,
  type SignalAnalysisRecipe,
  type SignalBindOptions,
  type SignalTransformParams,
} from "./signalRecipe";
import type { DataStruct, Dataset } from "./types";

export {
  bindSignalRecipe,
  correctionNeedsXUnit,
  dataXUnit,
  sanitizeCorrectionRecipe,
  sanitizeSignalAnalysisRecipe,
  signalRecipeChannels,
  signalRecipeLabel,
  signalRecipeNeedsXUnit,
  signalTransformParamsOf,
} from "./signalRecipe";
export type {
  SignalAnalysisRecipe,
  SignalBindOptions,
  SignalChannelRef,
  SignalCorrectionRecipe,
  SignalTransformParams,
} from "./signalRecipe";

export interface SignalTransformResult {
  data: DataStruct;
  name: string;
  recipe: SignalAnalysisRecipe;
  datasetPatch: Partial<Dataset>;
}

export function signalTransformStepText(params: SignalTransformParams): { label: string; code: string } {
  const label = `${signalRecipeLabel(params.recipe)} · ${params.recipe.channels.map((channel) => channel.label).join(", ")}`;
  return { label, code: `qz.transform("signal", "<active>", ${lit({ recipe: params.recipe })})` };
}

/** One compute path for interactive commit and Pipeline Studio replay. */
export async function computeSignalTransform(
  params: SignalTransformParams,
  source: Dataset,
  signal?: AbortSignal,
  options?: SignalBindOptions,
): Promise<SignalTransformResult> {
  const recipe = bindSignalRecipe(params.recipe, source.data, options);
  const label = signalRecipeLabel(recipe);
  if (recipe.kind === "spectral") {
    const data = await runSpectralWorkbench(source.data, recipe, signal);
    return {
      data,
      name: `${source.name} (${recipe.operation})`,
      recipe,
      datasetPatch: {
        raw: source.data,
        analysisRecipe: recipe,
        derivedFrom: { datasetId: source.id, pipeline: label },
        ...(source.workbookId ? { workbookId: source.workbookId } : {}),
        ...(source.folderId ? { folderId: source.folderId } : {}),
      },
    };
  }
  const data = await applyCorrections({
    dataset: source.data,
    params: recipe.params,
    ...(source.errorRoles ? { error_bindings: source.errorRoles } : {}),
  }, signal);
  return {
    data,
    name: `${source.name} (${recipe.operation})`,
    recipe,
    datasetPatch: {
      raw: source.data,
      corrections: recipe.params,
      analysisRecipe: recipe,
      derivedFrom: { datasetId: source.id, pipeline: label },
      ...(source.errorRoles ? { errorRoles: [...source.errorRoles] } : {}),
      ...(source.workbookId ? { workbookId: source.workbookId } : {}),
      ...(source.folderId ? { folderId: source.folderId } : {}),
    },
  };
}
