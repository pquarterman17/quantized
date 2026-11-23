// What the Analysis window's buttons do (WORKSPACE_LAYOUT_PLAN P4): set the
// technique override on the dataset, open a tool through the SAME launch path
// as the Analysis Center (store/analysisCenterRun.ts), and reopen a guide
// step. Lazy (the Analysis window's own chunk). It imports nothing of the
// layout host: what it needs from the layout (open Data, bring a tool window
// forward) the window passes in, so this chunk shares no module with the host's.
// Each returns the one sentence to announce, or null when the action itself
// shows the result.

import type { AnalysisTool } from "../lib/analysisCenter";
import { TECHNIQUE_OVERRIDE_KEY } from "../lib/windowLayout/analysisGuide";
import type { StepId } from "../lib/windowLayout/analysisGuide";
import type { DataStruct, Technique } from "../lib/types";
import { useAnalysisCenter } from "./analysisCenter";
import { launchAnalysisCenterTool, openAnalysisResult } from "./analysisCenterRun";
import { resolvePendingEdit } from "./pendingEdit";
import { useApp } from "./useApp";

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
 *  as one undo step. A lazy Origin preview loads its full data first (its load
 *  replaces the data, which would drop a choice written into the preview). */
export function setTechniqueOverride(datasetId: string, technique: Technique | null): string {
  const s = useApp.getState();
  const ds = s.datasets.find((d) => d.id === datasetId);
  if (!ds) return "That dataset is no longer in the project.";
  if (resolvePendingEdit(useApp.getState, ds, "set the technique", () => void setTechniqueOverride(datasetId, technique))) {
    return "Loading the full worksheet; the technique is saved once it has loaded.";
  }
  if ((ds.data.metadata?.[TECHNIQUE_OVERRIDE_KEY] ?? null) === technique) return "No change.";
  s.recordHistory("set technique");
  useApp.setState((st) => ({
    datasets: st.datasets.map((d) =>
      d.id === datasetId ? { ...d, data: withMeta(d.data, technique), ...(d.raw ? { raw: withMeta(d.raw, technique) } : {}) } : d,
    ),
  }));
  return technique ? "Technique saved on the dataset." : "Technique reset to what the import recorded.";
}

/** Open a tool from the list for `datasetId`. `focusOpen` brings the tool's
 *  window forward when it is already open (one window per tool, D7) and returns
 *  its id; the launch resolves to that id, else null. */
export async function launchFromAnalysis(tool: AnalysisTool, datasetId: string | null, focusOpen: (actionId: string) => string | null): Promise<string | null> {
  if (datasetId !== null && tool.datasetRequired) {
    const refused = notActiveReason(datasetId);
    if (refused) {
      useApp.getState().setStatus(refused, "warn");
      return null;
    }
  }
  // D7: an open tool is only brought forward; running its launch again would re-seed its input.
  const open = focusOpen(tool.action.id);
  if (open) return open;
  await launchAnalysisCenterTool(
    tool,
    datasetId,
    () => useAnalysisCenter.getState().recordUse(tool.action.id),
    () => (useApp.getState().windowLayout?.placements.analysis?.open ? null : "the Analysis window was closed while data loaded"),
    // The window layout has no stage view to switch to (a map's tool would ask for the Map view).
    false,
  );
  return null;
}

/** What reopening a step did: moved on to the tool list, refused (the sentence), or opened it (null). */
export type StepOutcome = { tools: true } | string | null;

/** Reopen a guide step (`openData` opens the Data window). */
export function runStep(step: StepId, datasetId: string, openData: () => void): StepOutcome {
  const refused = notActiveReason(datasetId);
  const s = useApp.getState();
  if (step === "inspect") {
    openData();
    return null;
  }
  if (refused) return refused;
  const results = s.analysisResults.filter((r) => r.sources.some((src) => src.datasetId === datasetId));
  const latest = results.at(-1);
  if (step === "clean") {
    s.setDataFilterOpen(true);
    return null;
  }
  if (step === "plot") {
    const figure = s.editableFigures.filter((f) => f.bindings.datasetId === datasetId).at(-1);
    if (figure) s.openEditableFigure(figure.id);
    else if (!s.openQuickFigureBuilder(datasetId)) return "The figure setup could not open for this dataset.";
    return null;
  }
  if (step === "analyze") {
    if (!latest) return { tools: true };
    openAnalysisResult(latest.id);
    return null;
  }
  const report = s.reports.filter((r) => r.datasetId === datasetId).at(-1);
  if (report) s.setOpenReport(report.id);
  else if (latest) openAnalysisResult(latest.id);
  else return "Run an analysis first; a report is built from its result.";
  return null;
}
