// "Open in <tool>" for a committed analysis output (lane RO): reopen the
// producing tool on the RECORDED source with the RECORDED settings, as an
// editing session (store/toolReopen.ts) whose commit replaces the old output
// in one undo step, or adds a new one. Lazy (reached from the result workspace
// and the Library's result menu only).
//
// Fail closed: the plan (lib/committedOutputReopen.ts) decides; a refused plan
// opens nothing and says why. A missing source still opens the tool, but with a
// notice and no settings, and never on a silently different worksheet's data.

import { planReopen } from "../lib/committedOutputReopen";
import { useAnalysisExtras, type AnalysisExtra } from "./analysisExtras";
import { useToolReopen } from "./toolReopen";
import { useApp } from "./useApp";

const EXTRAS: readonly string[] = ["surface-fit", "optical-gap", "ellipse-fit"] satisfies AnalysisExtra[];

/** True when the tool opened (with or without the recorded settings). */
export function openCommittedResultInTool(resultId: string): boolean {
  const app = useApp.getState();
  const result = app.analysisResults.find((item) => item.id === resultId);
  if (!result) {
    app.setStatus("that analysis result no longer exists", "danger");
    return false;
  }
  const plan = planReopen(result, app.datasets);
  if (!plan.ok) {
    app.setStatus(`${plan.label}: ${plan.reason}`, "danger");
    return false;
  }
  useToolReopen.getState().start(plan.tool, {
    resultId: result.id, resultName: result.name, sourceId: plan.sourceId, outputId: plan.outputId,
    outputName: plan.outputName, seed: plan.seed, extra: plan.extra, notice: plan.notice, replaceBlocked: plan.replaceBlocked,
  });
  if (plan.sourceId) app.setActive(plan.sourceId);
  if (plan.tool === "baseline-subtract") {
    // The estimate follows the plotted channels: plot the recorded ones.
    const binding = plan.seed?.["binding"];
    if (plan.sourceId && binding && typeof binding === "object" && !Array.isArray(binding) && typeof binding["yKey"] === "number") {
      app.setXKey(typeof binding["xKey"] === "number" ? binding["xKey"] : null);
      app.setYKeys([binding["yKey"]]);
    }
    app.setStageTab("plot");
    app.setBaselineOpen(true);
  } else if (plan.tool === "tabulate") {
    app.setTabulateOpen(true);
  } else if (EXTRAS.includes(plan.tool)) {
    useAnalysisExtras.getState().show(plan.tool as AnalysisExtra);
  }
  useApp.getState().setStatus(plan.notice ?? `opened ${plan.toolLabel} with the settings of “${result.name}”`, plan.notice ? "warn" : "ok");
  return true;
}
