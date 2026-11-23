import { buildAnalysisCommands } from "../commands/analysisCommands";
import { analysisTools, type AnalysisTool } from "../lib/analysisCenter";
import { withAnalysisRequirements } from "../lib/analysisRequirements";
import { ensureMapGate } from "../lib/mapdata";
import { plotIntentStageTab } from "../lib/stagetab";
import type { Action } from "./commands";
import { runAction } from "./commands";
import { seedAnalysisSelection, useAnalysisSelection } from "./analysisSelection";
import { withResolved } from "./pendingEdit";
import { toast } from "./toasts";
import { useApp } from "./useApp";

/** Canonical commands for the lazy Analysis Center. This indirection keeps
 * imperative store reads out of React render modules without creating a
 * second command implementation. */
export function analysisCenterActions(): Action[] {
  // Same requirement predicate the Analyze menu and palette use (worksheet
  // count, 2θ axis), so the three surfaces cannot disagree about a tool.
  return withAnalysisRequirements(buildAnalysisCommands(useApp.getState), () => {
    const { datasets, activeId } = useApp.getState();
    return { datasets, dataset: datasets.find((d) => d.id === activeId) };
  });
}

export function openAnalysisResult(id: string): void {
  useApp.setState({ openAnalysisResultId: id });
}

/** Resolve a lazy Origin preview and re-check the active id before launching.
 * `beforeRun` owns session-only recents/navigation; it runs only when the
 * scientific target is still the worksheet the user chose. */
export async function launchAnalysisCenterTool(
  tool: AnalysisTool,
  sourceId: string | null,
  beforeRun: () => void,
  /** Why the launching surface is gone after the load, or null while it is
   *  still there. Default: the classic Analysis Center stage view. */
  closedReason: () => string | null = () => (useApp.getState().stageTab !== "analysis" ? "the Analysis Center was closed while data loaded" : null),
): Promise<void> {
  if (!tool.available) return;
  if (!tool.datasetRequired) {
    beforeRun();
    runAction(tool.action);
    return;
  }
  if (!sourceId) return;

  const name = tool.action.label.replace(/…$/, "");
  try {
    const outcome = await withResolved(useApp.getState, sourceId, name, (resolved) => resolved);
    if (outcome.ok) {
      const resolved = outcome.value;
      // A full-resolution load is a NEW DataStruct the lazy Map grid gate
      // (lib/mapdata.ts) has never classified: resolve it before the re-check
      // below, or a map tool would fail closed on a perfectly good grid.
      await ensureMapGate(resolved.data);
      const state = useApp.getState();
      if (state.activeId !== resolved.id) {
        state.setStatus(`${name} skipped: the active worksheet changed while data loaded`);
        return;
      }
      const closed = closedReason();
      if (closed) {
        state.setStatus(`${name} skipped: ${closed}`);
        return;
      }
      const refreshed = analysisTools([tool.action], resolved, state.datasets)[0];
      if (!refreshed?.available) {
        const message = `${name} was not opened: ${refreshed?.unavailableReason ?? "the loaded worksheet is not compatible"}`;
        state.setStatus(message);
        toast(message, "info");
        return;
      }
      state.setStageTab(plotIntentStageTab(resolved));
      const handoff = useAnalysisSelection.getState();
      if (handoff.toolId === "analysis-center" && handoff.selection?.source === "worksheet") {
        handoff.setSelection(tool.action.id, handoff.selection);
      } else {
        seedAnalysisSelection(tool.action.id, "analysis-center");
      }
      beforeRun();
      runAction(tool.action);
    }
    if (!outcome.ok && useApp.getState().status !== outcome.error) {
      // `withResolved` reports fetch/replacement failures itself. The only
      // silent outcome is an id removed before it starts; cover that without
      // double-toasting the detailed load failure path.
      const message = `${name} was not opened: ${outcome.error}.`;
      useApp.getState().setStatus(message);
      toast(message, "danger");
    }
  } catch (error) {
    const message = `${name} failed: ${error instanceof Error ? error.message : "error"}`;
    useApp.getState().setStatus(message);
    toast(message, "danger");
  }
}
