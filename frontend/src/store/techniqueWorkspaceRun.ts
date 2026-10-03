// Imperative launch seam for the lazy technique workspace. Keeping store reads
// here (outside React render modules) makes the async target guard explicit and
// preserves the components/ getState-in-render architecture ratchet.

import { buildAppActions } from "../appCommands";
import { plotIntentStageTab } from "../lib/stagetab";
import type { TechniqueActionId } from "../lib/techniqueWorkflow";
import { runAction, type Action } from "./commands";
import { withResolved } from "./pendingEdit";
import { runQuickPlot } from "./quickPlotRun";
import { openSimsDialog, type SimsTab } from "./simsDialog";
import { useApp } from "./useApp";
import { toast } from "./toasts";

const SPECIAL: Record<"quick-plot" | "configure-figure" | "sims-process" | "sims-compare" | "sims-region", Pick<Action, "label" | "description">> = {
  "quick-plot": { label: "Quick Plot", description: "Create the recognized default plot as an editable figure." },
  "configure-figure": { label: "Configure figure…", description: "Assign columns and preview the editable figure before creating it." },
  "sims-process": { label: "Process profile…", description: "Calibrate depth and apply traceable SIMS corrections." },
  "sims-compare": { label: "Compare profiles…", description: "Compare selected species across several depth profiles." },
  "sims-region": { label: "Measure region…", description: "Calculate dose, peak, mean, or junction depth over a chosen interval." },
};

const commands = new Map(buildAppActions(useApp.getState).map((action) => [action.id, action]));

export function techniqueActionDefinition(id: TechniqueActionId): Pick<Action, "label" | "description"> | undefined {
  return SPECIAL[id as keyof typeof SPECIAL] ?? commands.get(id);
}

/** Resolve lazy Origin data, then act only if the intended worksheet is still
 * active. Selection can change during the await; applying a command to the
 * replacement would be silent cross-dataset corruption. */
export async function runTechniqueWorkspaceAction(id: TechniqueActionId, datasetId: string, onClose?: () => void): Promise<void> {
  const name = techniqueActionDefinition(id)?.label ?? id;
  const source = useApp.getState().datasets.find((dataset) => dataset.id === datasetId);
  const loadingMessage = source?.pending
    ? `Loading full data for "${source.name}" — ${name.replace(/…$/, "")} will continue automatically`
    : null;
  if (loadingMessage) useApp.getState().setStatus(loadingMessage);
  try {
    const outcome = await withResolved(useApp.getState, datasetId, name.replace(/…$/, ""), (resolved) => {
      const state = useApp.getState();
      if (state.activeId !== resolved.id) {
        state.setStatus(`${name.replace(/…$/, "")} skipped: the active worksheet changed while data loaded`);
        return;
      }
      if (id === "quick-plot") {
        runQuickPlot(resolved.id, onClose);
        return;
      }
      // The Workflow page is a launcher, not a canvas. Every launched tool
      // must reveal the plot/map it operates on; otherwise marker, range, and
      // figure-producing tools open over an unrelated full-stage page.
      state.setStageTab(plotIntentStageTab(resolved));
      if (id === "configure-figure") {
        state.openQuickFigureBuilder(resolved.id);
        return;
      }
      if (id.startsWith("sims-")) {
        openSimsDialog(resolved.id, id.slice(5) as SimsTab);
        return;
      }
      const action = commands.get(id);
      if (action) runAction(action);
      else state.setStatus(`${name.replace(/…$/, "")} is unavailable`);
    });
    if (outcome.ok && loadingMessage && useApp.getState().status === loadingMessage) {
      useApp.getState().setStatus(`Full data loaded — continued ${name.replace(/…$/, "")}`);
    }
  } catch (error) {
    const message = `${name.replace(/…$/, "")} failed: ${error instanceof Error ? error.message : "error"}`;
    useApp.getState().setStatus(message);
    toast(message, "danger");
  }
}
