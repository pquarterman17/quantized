import { deriveExpectations } from "./recipeExpect";
import {
  signalTransformStepText,
  type SignalAnalysisRecipe,
} from "./signalTransform";
import { makeStep } from "./pipelineStep";
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

/** Save one Signal Processing setup into the existing Recipe Library. */
export function saveSignalRecipeTemplate(
  nameInput: string,
  source: Dataset,
  recipe: SignalAnalysisRecipe,
): { name: string; revision: number } {
  const name = nameInput.trim();
  if (!name) throw new Error("Recipe name cannot be blank.");
  const prior = loadTemplates().find((template) => template.name === name);
  const revision = prior ? (prior.revision ?? 1) + 1 : 1;
  saveTemplate(buildSignalRecipeTemplate(name, source, recipe, revision));
  return { name, revision };
}
