// Several outputs of one batch, committed through the shared result contract in
// ONE undo step. Each goes through `commitAnalysisOutput` (a repeat adds
// nothing, stamped with its source's fingerprint, out of date on a source
// change, linked to its source); a refusal is returned with its reason, never
// skipped silently. Outputs are added quietly: the batch view keeps its place.

import { commitAnalysisOutput, type AnalysisOutputCommit } from "./analysisOutputCommit";
import { asOneEditStep } from "./undoStep";
import { useApp } from "./useApp";

export interface BatchOutputsReport {
  created: number;
  existing: number;
  /** One line per output that could not be written, with its reason. */
  refused: string[];
}

export function commitBatchOutputs(
  label: string,
  items: readonly { name: string; request: Omit<AnalysisOutputCommit, "quiet"> }[],
): BatchOutputsReport {
  const report: BatchOutputsReport = { created: 0, existing: 0, refused: [] };
  asOneEditStep(useApp.getState, label, () => {
    for (const { name, request } of items) {
      const outcome = commitAnalysisOutput({ ...request, quiet: true });
      if (outcome.kind === "refused") report.refused.push(`${name}: ${outcome.reason}`);
      else if (outcome.kind === "existing") report.existing += 1;
      else report.created += 1;
    }
  });
  const summary = `${label}: ${report.created} added, ${report.existing} already added`
    + `${report.refused.length ? `, ${report.refused.length} not written` : ""}${report.created ? ` (one Undo removes the ${report.created} added)` : ""}.`;
  useApp.getState().setStatus(summary, report.refused.length ? "danger" : undefined);
  return report;
}
