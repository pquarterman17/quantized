// Fit Model "Save columns": commit the predicted / residual / interval columns
// as an output worksheet through the shared analysis-output contract
// (store/commitComputedOutput: one undo step, no duplicate on a repeat Save,
// recorded inputs, stale when the source changes). The commit key carries a
// digest of the written table (commitComputedOutput), so a different option set
// is a different output.

import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import { fitModelColumnsData, type FitModelColumnsInput, type SaveColumnOptions } from "../lib/fitModelColumns";
import type { FitModelRecipe } from "../lib/fitModelRecipe";
import { fitModelQuestion } from "../lib/snapshotResultKey";
import type { Dataset } from "../lib/types";
import { commitComputedOutput } from "./commitComputedOutput";

export const FIT_MODEL_COLUMNS_PRODUCER = { id: "fit-model-columns", label: "Fit Model columns", version: 1 } as const;

/** Returns the new output worksheet's id (an identical earlier save returns that one), or null when refused. */
export function commitFitModelColumns(
  source: Dataset,
  recipe: FitModelRecipe,
  input: FitModelColumnsInput,
  opts: SaveColumnOptions,
): string | null {
  const outcome = commitComputedOutput({
    producer: FIT_MODEL_COLUMNS_PRODUCER,
    sources: [{ id: source.id, computedOn: analysisDataFingerprint(source) }],
    settings: { ...fitModelQuestion(recipe), ...opts },
    name: `${source.name.replace(/\.[^.]+$/, "")} (${input.responseLabel} fit model columns)`,
    data: fitModelColumnsData(input, opts),
    status: `saved ${input.responseLabel} fit model columns`,
    quiet: true,
  });
  return outcome.kind === "refused" ? null : outcome.outputId;
}
