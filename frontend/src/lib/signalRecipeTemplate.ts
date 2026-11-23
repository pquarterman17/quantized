import { deriveExpectations } from "./recipeExpect";
import {
  signalTransformStepText,
  type SignalAnalysisRecipe,
} from "./signalTransform";
import { makeStep } from "./pipelineStep";
import type { SigopParams } from "./transformSigop";
import type { SpectrogramParams } from "./transformSpectrogram";
import { transformStepText } from "./transformStepText";
import { loadTemplates, saveTemplate, toTemplate, type AnalysisTemplate } from "./template";
import type { Dataset } from "./types";

/** One Signal Processing setup as a one-step recipe (not saved): what the
 *  Recipe Library stores, and what "Apply to selected sheets…" runs on each
 *  picked dataset (worksheet audit #15). */
export function buildSignalRecipeTemplate(
  name: string,
  source: Dataset,
  recipe: SignalAnalysisRecipe,
  revision = 1,
): AnalysisTemplate {
  if (recipe.kind === "spectral" && recipe.secondarySource) {
    throw new Error("Cross-worksheet correlation recipes cannot yet be saved because their second input is project-specific.");
  }
  const params = { op: "signal" as const, recipe };
  const text = signalTransformStepText(params);
  const step = makeStep("transform", text.label, text.code, params);
  return toTemplate(name, [step], [], {
    revision,
    description: `${text.label} from ${source.name}`,
    expects: deriveExpectations([step], source),
  });
}

/** A filter / spectrogram setup (a recorded `sigop` or `spectrogram` transform, X range included
 *  in its params) as a one-step recipe: the same step the Pipeline records, so the Recipe Library
 *  and "Apply to selected sheets…" replay it through the shared transform runner. */
export function buildTransformRecipeTemplate(
  name: string,
  source: Dataset,
  params: SigopParams | SpectrogramParams,
  revision = 1,
): AnalysisTemplate {
  const text = transformStepText(params, source.name);
  const step = makeStep("transform", text.label, text.code, { ...params });
  return toTemplate(name, [step], [], {
    revision,
    description: `${text.label} from ${source.name}`,
    expects: deriveExpectations([step], source),
  });
}

/** Save into the existing Recipe Library under `name`, one revision above any recipe of that name. */
export function saveRecipeTemplate(
  nameInput: string,
  build: (name: string, revision: number) => AnalysisTemplate,
): { name: string; revision: number } {
  const name = nameInput.trim();
  if (!name) throw new Error("Recipe name cannot be blank.");
  const prior = loadTemplates().find((template) => template.name === name);
  const revision = prior ? (prior.revision ?? 1) + 1 : 1;
  saveTemplate(build(name, revision));
  return { name, revision };
}

/** Save one Signal Processing setup into the existing Recipe Library. */
export function saveSignalRecipeTemplate(
  nameInput: string,
  source: Dataset,
  recipe: SignalAnalysisRecipe,
): { name: string; revision: number } {
  return saveRecipeTemplate(nameInput, (name, revision) => buildSignalRecipeTemplate(name, source, recipe, revision));
}
