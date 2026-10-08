import { deriveExpectations } from "./recipeExpect";
import {
  signalTransformStepText,
  type SignalAnalysisRecipe,
} from "./signalTransform";
import { makeStep } from "./pipelineStep";
import { loadTemplates, saveTemplate, toTemplate } from "./template";
import type { Dataset } from "./types";

/** Save one Signal Processing setup into the existing Recipe Library. */
export function saveSignalRecipeTemplate(
  nameInput: string,
  source: Dataset,
  recipe: SignalAnalysisRecipe,
): { name: string; revision: number } {
  const name = nameInput.trim();
  if (!name) throw new Error("Recipe name cannot be blank.");
  const params = { op: "signal" as const, recipe };
  const text = signalTransformStepText(params);
  const step = makeStep("transform", text.label, text.code, params);
  const prior = loadTemplates().find((template) => template.name === name);
  const revision = prior ? (prior.revision ?? 1) + 1 : 1;
  saveTemplate(toTemplate(name, [step], [], {
    revision,
    description: `${text.label} from ${source.name}`,
    expects: deriveExpectations([step], source),
  }));
  return { name, revision };
}
