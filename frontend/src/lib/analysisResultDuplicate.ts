// Which saved results can be duplicated, and why not. ONE rule for the Library
// menu (components/Library/artifactContextActions.ts); it mirrors what the
// result workspace offers (AnalysisResultToolbar) and what
// store/analysisResultActions.duplicateAnalysisResult accepts:
//   - a snapshot result with saved tables (a copy of the record), or
//   - a linked result with exactly one output worksheet that exists (the copy
//     brings its own linked worksheet).
// Anything else fails closed with the reason. Fit, peak and reflectivity
// records live on their source worksheet; the workspace offers no Duplicate
// for them, so neither does the Library.

import type { AnalysisResult } from "./analysisResult";
import { isSnapshotResult } from "./analysisResultFreshness";
import type { Dataset } from "./types";

/** null when the result can be duplicated, else the reason it cannot. */
export function duplicateBlockedReason(result: AnalysisResult, datasets: readonly Dataset[]): string | null {
  if (isSnapshotResult(result)) return result.tables?.length ? null : "this result saved no tables to copy";
  const field = result.settingsRef?.field;
  if (field === "fitSpec" || field === "peakTable" || field === "reflFits") {
    return "a saved fit, peak or reflectivity record lives on its source worksheet and is not duplicated here";
  }
  if (result.outputs.length !== 1) {
    return result.producer.id === "signal-processing"
      ? "use Rerun as New from the result workspace"
      : "duplicating needs exactly one linked output worksheet";
  }
  const id = result.outputs[0].datasetId;
  return datasets.some((dataset) => dataset.id === id) ? null : "its output worksheet is missing";
}
