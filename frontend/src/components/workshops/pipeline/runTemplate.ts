// Shared "run one analysis template against one LOADED dataset" core — the
// #3 file batch (useTemplates.runBatch) and the folder bulk ops (project-
// organization item 8) both drive it: execute the steps, extract the declared
// outputs into a BatchRow, and land a per-run #36 fit report when a fit ran.
// Module-level (not a hook); callers own the pipelineRunning flag and the
// summary worksheet.

import { executeSteps } from "./executeSteps";
import { reportEmit } from "../../../lib/api";
import { extractOutputs, type AnalysisTemplate, type BatchRow } from "../../../lib/template";
import { useApp } from "../../../store/useApp";

/** Run template `t` against the loaded dataset `targetId`. Step failures are
 *  isolated (a flagged row, never a throw); the report emission is best-effort
 *  and can't turn a successful analysis into a failed one. */
export async function runTemplateOnDataset(
  t: AnalysisTemplate,
  targetId: string,
  displayName: string,
): Promise<BatchRow> {
  const { fits, log } = await executeSteps(t.steps, targetId);
  const failedSteps = Object.values(log).filter((l) => l.status === "failed");
  const lastFit = fits[fits.length - 1];

  if (lastFit) {
    try {
      const nParams = ((lastFit.params as number[] | undefined) ?? []).length;
      const names = t.outputs.filter((o) => o !== "R2");
      const { report } = await reportEmit({
        kind: "curve_fit",
        result: lastFit as Record<string, unknown>,
        param_names:
          names.length === nParams
            ? names
            : Array.from({ length: nParams }, (_, k) => `p${k}`),
        title: `${t.name} — ${displayName}`,
        source_refs: [{ kind: "dataset", id: targetId, name: displayName }],
      });
      useApp.getState().addReport(`${t.name} — ${displayName}`, report, targetId);
    } catch {
      /* offline / report route down — the extracted row still lands */
    }
  }

  return {
    file: displayName,
    values: extractOutputs(t.outputs, lastFit),
    ...(failedSteps.length
      ? { failed: failedSteps.map((l) => l.note ?? "step failed").join("; ") }
      : {}),
  };
}
