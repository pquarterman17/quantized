import { buildAnalysisCommands } from "../commands/analysisCommands";
import type { AnalysisTool } from "../lib/analysisCenter";
import { plotIntentStageTab } from "../lib/stagetab";
import type { Action } from "./commands";
import { runAction } from "./commands";
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
    await withResolved(useApp.getState, sourceId, name, (resolved) => {
      const state = useApp.getState();
      if (state.activeId !== resolved.id) {
        state.setStatus(`${name} skipped: the active worksheet changed while data loaded`);
        return;
      }
      state.setStageTab(plotIntentStageTab(resolved));
      beforeRun();
      runAction(tool.action);
    });
  } catch (error) {
    const message = `${name} failed: ${error instanceof Error ? error.message : "error"}`;
    useApp.getState().setStatus(message);
    toast(message, "danger");
  }
}
