// What the Analysis window's buttons do (WORKSPACE_LAYOUT_PLAN P4): set the
// technique override on the dataset, open a tool through the SAME launch path
// as the Analysis Center (store/analysisCenterRun.ts), and reopen a guide
// step. Lazy: only the layout host's subtree imports it. Each returns the one
// sentence to announce, or null when the action itself shows the result.

import type { AnalysisTool } from "../lib/analysisCenter";
import { TECHNIQUE_OVERRIDE_KEY } from "../lib/windowLayout/analysisGuide";
import { toolRef } from "../lib/windowLayout/refs";
import { toolWindowOf } from "../lib/windowLayout/toolCatalog";
import type { StepId } from "../lib/windowLayout/analysisGuide";
import type { DataStruct, Technique } from "../lib/types";
import { useAnalysisCenter } from "./analysisCenter";
import { launchAnalysisCenterTool, openAnalysisResult } from "./analysisCenterRun";
import { isToolMounted } from "./layoutTools";
import { runTechniqueWorkspaceAction } from "./techniqueWorkspaceRun";
import { useApp } from "./useApp";
import { reopenRef } from "./windowLayoutActions";

/** Why the guide's actions cannot run on `datasetId` now, or null. Tools act on
 *  the active worksheet, so a window pinned to another dataset says so instead
 *  of launching on the wrong one (fail closed). */
export function notActiveReason(datasetId: string): string | null {
  const s = useApp.getState();
  if (s.activeId === datasetId) return null;
  const name = s.datasets.find((d) => d.id === datasetId)?.name ?? "the pinned dataset";
  return `Tools run on the focused plot's dataset; focus a plot of ${name} to run them on it.`;
}

const withMeta = (data: DataStruct, technique: Technique | null): DataStruct => {
  const metadata = { ...data.metadata };
  if (technique) metadata[TECHNIQUE_OVERRIDE_KEY] = technique;
  else delete metadata[TECHNIQUE_OVERRIDE_KEY];
  return { ...data, metadata };
};

/** Save (or clear, with null) the guide's technique override on the dataset,
 *  as one undo step. A lazy Origin preview is refused: its full load replaces
 *  the data, which would drop the choice. */
export function setTechniqueOverride(datasetId: string, technique: Technique | null): string {
  const s = useApp.getState();
  const ds = s.datasets.find((d) => d.id === datasetId);
  if (!ds) return "That dataset is no longer in the project.";
  if (ds.pending) return "Load the full worksheet first; the preview is replaced when it loads, which would drop the choice.";
  if ((ds.data.metadata?.[TECHNIQUE_OVERRIDE_KEY] ?? null) === technique) return "No change.";
  s.recordHistory("set technique");
  useApp.setState((st) => ({
    datasets: st.datasets.map((d) =>
      d.id === datasetId ? { ...d, data: withMeta(d.data, technique), ...(d.raw ? { raw: withMeta(d.raw, technique) } : {}) } : d,
    ),
  }));
  return technique ? "Technique saved on the dataset." : "Technique reset to what the import recorded.";
}

/** Bring an open tool's window forward (D7: one window per tool). */
function focusToolWindow(actionId: string): string | null {
  const id = toolWindowOf(actionId);
  if (id === null || !isToolMounted(id)) return null;
  reopenRef(toolRef(id));
  return id;
}

/** Open a tool from the list for `datasetId`. Resolves to the tool window id
 *  to focus when it was already open, else null. */
export async function launchFromAnalysis(tool: AnalysisTool, datasetId: string | null): Promise<string | null> {
  if (datasetId !== null && tool.datasetRequired) {
    const refused = notActiveReason(datasetId);
    if (refused) {
      useApp.getState().setStatus(refused, "warn");
      return null;
    }
  }
  const open = focusToolWindow(tool.action.id);
  await launchAnalysisCenterTool(
    tool,
    datasetId,
    () => useAnalysisCenter.getState().recordUse(tool.action.id),
    () => (useApp.getState().windowLayout?.placements.analysis?.open ? null : "the Analysis window was closed while data loaded"),
  );
  return open;
}

/** Reopen a guide step. `"tools"` means: move to the tool list (no action). */
export function runStep(step: StepId, datasetId: string): "tools" | string | null {
  const refused = notActiveReason(datasetId);
  const s = useApp.getState();
  if (step === "inspect") {
    reopenRef("data");
    return null;
  }
  if (refused) return refused;
  const results = s.analysisResults.filter((r) => r.sources.some((src) => src.datasetId === datasetId));
  const latest = results.at(-1);
  if (step === "clean") {
    void runTechniqueWorkspaceAction("data-filter", datasetId);
    return null;
  }
  if (step === "plot") {
    const figure = s.editableFigures.filter((f) => f.bindings.datasetId === datasetId).at(-1);
    if (figure) s.openEditableFigure(figure.id);
    else void runTechniqueWorkspaceAction("configure-figure", datasetId);
    return null;
  }
  if (step === "analyze") {
    if (!latest) return "tools";
    openAnalysisResult(latest.id);
    return null;
  }
  const report = s.reports.filter((r) => r.datasetId === datasetId).at(-1);
  if (report) s.setOpenReport(report.id);
  else if (latest) openAnalysisResult(latest.id);
  else return "Run an analysis first; a report is built from its result.";
  return null;
}
