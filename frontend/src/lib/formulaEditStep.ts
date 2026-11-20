// "Edit column" pipeline steps — the one rule every replay of them follows
// (the app's executeSteps, the exported script in lib/pipeline.ts, and
// quantized/recipe_run.py, which mirrors it). An edit is recorded by
// store/computedColumns.ts `updateFormula` as kind "expression" with
// `params.of` = the column's name BEFORE the edit, so a replay REPLACES the
// computed column of that name instead of appending another one. A step
// recorded before `of` existed carries only the new name (a rename lost the
// old one): it cannot be replayed faithfully and is refused, never appended.
// Pure (no React / store / fetch).

import type { PipelineStep } from "./pipelineStep";

/** Refusal text for an edit step recorded without the column's previous name. */
export const LEGACY_EDIT = "an edited formula column recorded before edits kept the column's previous name (re-record the pipeline)";

/** `step`'s edited column (its name before the edit): a string for an edit,
 *  null for a legacy edit with no `of`, undefined when it is not an edit. */
export function formulaEditOf(step: Pick<PipelineStep, "params" | "code" | "label">): string | null | undefined {
  if (typeof step.params.of === "string") return step.params.of;
  return step.code.startsWith("qz.editColumn(") || step.label.startsWith("Edit column") ? null : undefined;
}

/** The index of the ONE computed column named `of` among `names`, or why
 *  there is none to edit (missing, or ambiguous — never a guess). */
export function editTargetIndex(names: readonly string[], of: string): number | { error: string } {
  const hits = names.flatMap((n, i) => (n === of ? [i] : []));
  if (hits.length === 1) return hits[0]!;
  return { error: hits.length ? `${hits.length} computed columns are named "${of}", so the one to edit is ambiguous` : `there is no computed column named "${of}" to edit` };
}
