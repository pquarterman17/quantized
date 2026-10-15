import { applyCorrections } from "./api";
import { runSpectralWorkbench } from "./api/spectralWorkbench";
import { lit } from "./macro";
import {
  bindSignalRecipe,
  dataXUnit,
  signalRecipeLabel,
  type SignalAnalysisRecipe,
  type SignalBindOptions,
  type SignalTransformParams,
} from "./signalRecipe";
import { rebindSpectralSecondarySource } from "./spectralWorkbench";
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
  const labels = [
    ...params.recipe.channels.map((channel) => channel.label),
    ...(params.recipe.kind === "spectral" && params.recipe.secondarySource
      ? [params.recipe.secondarySource.channel.label]
      : []),
  ];
  const label = `${signalRecipeLabel(params.recipe)} · ${labels.join(", ")}`;
  return { label, code: `qz.transform("signal", "<active>", ${lit({ recipe: params.recipe })})` };
}

/** One compute path for interactive commit and Pipeline Studio replay. */
export async function computeSignalTransform(
  params: SignalTransformParams,
  source: Dataset,
  signal?: AbortSignal,
  options?: SignalBindOptions,
  secondary?: Dataset,
): Promise<SignalTransformResult> {
  let recipe = bindSignalRecipe(params.recipe, source.data, options);
  if (recipe.kind === "spectral" && recipe.secondarySource) {
    if (!secondary || secondary.id !== recipe.secondarySource.datasetId) {
      throw new Error(`the recorded second input "${recipe.secondarySource.datasetName}" is unavailable`);
    }
    if (secondary.id === source.id) {
      throw new Error("cross-worksheet correlation requires two different worksheets");
    }
    recipe = rebindSpectralSecondarySource(
      recipe,
      secondary.data.labels,
      secondary.data.units,
      dataXUnit(secondary.data),
    );
  }
  const label = signalRecipeLabel(recipe);
  if (recipe.kind === "spectral") {
    const data = secondary
      ? await runSpectralWorkbench(source.data, recipe, signal, false, secondary.data)
      : await runSpectralWorkbench(source.data, recipe, signal);
    const sourceName = secondary ? `${source.name} vs ${secondary.name}` : source.name;
    return {
      data,
      name: `${sourceName} (${recipe.operation})`,
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
