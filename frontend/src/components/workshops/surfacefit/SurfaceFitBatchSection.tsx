// Surface fit over the shared AnalysisSelection contract: the chosen model and
// bounds fitted to every selected worksheet's reviewed X / Y / Z, one summary
// table (parameters, R², RMSE, points) recorded. Summary-only: "Add fitted
// surface" still writes the active worksheet's surface. Start values are
// auto-guessed per worksheet (see ./surfaceFitRun).

import { useCallback, useMemo } from "react";

import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import AnalysisBatchControls, { type AnalysisBatchOutcome } from "../analysisselection/AnalysisBatchControls";
import AnalysisInputReview from "../analysisselection/AnalysisInputReview";
import { useToolAnalysisSelection } from "../analysisselection/useToolAnalysisSelection";
import { batchColumns, batchPicks } from "../analysisextras/batchColumns";
import { fitSurfaceColumns, parseBounds, surfaceSummaryHeaders } from "./surfaceFitRun";
import type { SurfaceFitState } from "./useSurfaceFit";

export default function SurfaceFitBatchSection({ f }: { f: Pick<SurfaceFitState, "model" | "lower" | "upper"> }) {
  useToolAnalysisSelection("surface-fit");
  const { model, lower, upper } = f;
  const bounds = useMemo(() => parseBounds(lower, upper), [lower, upper]);
  const runItem = useCallback(async (dataset: Dataset, selection: AnalysisSelectionItem): Promise<AnalysisBatchOutcome> => {
    if (!model || typeof bounds === "string") throw new Error("The surface model is not ready.");
    const cols = batchColumns(dataset, selection, batchPicks(dataset, selection, 2));
    const { values, warnings } = await fitSurfaceColumns(cols, model, bounds);
    return { values, warnings };
  }, [model, bounds]);
  const blocked = !model ? "Choose a surface model to run a batch." : typeof bounds === "string" ? bounds : null;
  const boundsJson = (k: "lower" | "upper"): string => JSON.stringify(typeof bounds === "string" ? [] : bounds[k]);
  return <>
    <AnalysisInputReview toolId="surface-fit" supportsBatch />
    <p className="qzk-ds-meta">
      The batch fits each worksheet's selected X, Y and Z columns with this model and these bounds; start values are
      estimated for each worksheet.
    </p>
    <AnalysisBatchControls
      toolId="surface-fit"
      label="Surface fit"
      summaryColumns={model ? surfaceSummaryHeaders(model) : []}
      resultParameters={{ model: model?.name ?? "", lower: boundsJson("lower"), upper: boundsJson("upper") }}
      blockedReason={blocked}
      runItem={runItem}
    />
  </>;
}
