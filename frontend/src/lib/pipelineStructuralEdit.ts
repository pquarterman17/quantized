import { moveStep, type PipelineStep } from "./pipelineStep";

export type PipelineStructuralAction = "toggle" | "remove" | "move_up" | "move_down";

/** Return the exact list a structural edit would commit, without mutating the
 * caller's list. Preview and commit deliberately share this transition shape
 * so the confirmation cannot describe a different recipe from the one saved. */
export function pipelineStepsAfterEdit(
  steps: readonly PipelineStep[],
  stepId: string,
  action: PipelineStructuralAction,
): PipelineStep[] {
  const index = steps.findIndex((step) => step.id === stepId);
  if (index < 0) return [...steps];
  if (action === "remove") return steps.filter((step) => step.id !== stepId);
  if (action === "toggle") {
    return steps.map((step) => step.id === stepId ? { ...step, enabled: !step.enabled } : step);
  }
  return moveStep(steps, index, action === "move_up" ? -1 : 1);
}
