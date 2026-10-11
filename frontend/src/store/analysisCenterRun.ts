import { buildAnalysisCommands } from "../commands/analysisCommands";
import { analysisTools, type AnalysisTool } from "../lib/analysisCenter";
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
  return buildAnalysisCommands(useApp.getState);
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
    const outcome = await withResolved(useApp.getState, sourceId, name, (resolved) => {
      const state = useApp.getState();
      if (state.activeId !== resolved.id) {
        state.setStatus(`${name} skipped: the active worksheet changed while data loaded`);
        return;
      }
      if (state.stageTab !== "analysis") {
        state.setStatus(`${name} skipped: the Analysis Center was closed while data loaded`);
        return;
      }
      const refreshed = analysisTools([tool.action], resolved)[0];
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
    });
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
